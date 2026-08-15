function normalizedAccount(post) {
  return post.account.toLocaleLowerCase('en-US');
}

function pairKey(left, right) {
  return [left.id, right.id].sort((a, b) => a.localeCompare(b, 'ja')).join(':');
}

function sortPosts(posts) {
  return [...posts].sort((left, right) => (
    Date.parse(left.postedAt) - Date.parse(right.postedAt)
    || left.account.localeCompare(right.account, 'ja')
    || left.id.localeCompare(right.id, 'ja')
  ));
}

function accountCount(posts) {
  return new Set(posts.map(normalizedAccount)).size;
}

class UnionFind {
  constructor(values) {
    this.parent = new Map(values.map((value) => [value, value]));
  }

  find(value) {
    const root = this.parent.get(value);
    if (root === value) return value;
    const resolved = this.find(root);
    this.parent.set(value, resolved);
    return resolved;
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent.set(rightRoot, leftRoot);
  }
}

function compareCandidatePriority(left, right) {
  const leftLexical = left.sources.has('lexical');
  const rightLexical = right.sources.has('lexical');
  if (leftLexical !== rightLexical) return leftLexical ? -1 : 1;
  return left.timeDifferenceMs - right.timeDifferenceMs
    || left.left.id.localeCompare(right.left.id, 'ja')
    || left.right.id.localeCompare(right.right.id, 'ja');
}

function summarizeClusterJudgments(cluster, candidates, judgments) {
  const postIds = new Set(cluster.posts.map((post) => post.id));
  const summary = {
    completed: 0,
    matches: 0,
    nonMatches: 0,
    abstained: 0,
    unavailable: 0,
    highestScore: null,
    resolvedModels: [],
  };

  candidates.forEach((candidate) => {
    if (!postIds.has(candidate.left.id) || !postIds.has(candidate.right.id)) return;
    const result = judgments.get(candidate.candidateId);
    if (!result) return;
    if (result.status === 'completed') {
      summary.completed += 1;
      if (result.label === 'match') summary.matches += 1;
      else if (result.label === 'non_match') summary.nonMatches += 1;
      else summary.abstained += 1;
      if (Number.isFinite(result.score)) summary.highestScore = Math.max(summary.highestScore ?? 0, result.score);
      if (typeof result.resolvedModel === 'string' && result.resolvedModel !== '' && !summary.resolvedModels.includes(result.resolvedModel)) {
        summary.resolvedModels.push(result.resolvedModel);
      }
    } else {
      summary.unavailable += 1;
    }
  });

  return summary.completed + summary.unavailable > 0 ? summary : null;
}

function reindexClusters(clusters) {
  const sorted = [...clusters].sort((left, right) => (
    (left.matchType === 'exact' ? 0 : 1) - (right.matchType === 'exact' ? 0 : 1)
    || right.similarity - left.similarity
    || right.accountCount - left.accountCount
    || Date.parse(left.posts[0].postedAt) - Date.parse(right.posts[0].postedAt)
  ));
  return sorted.map((cluster, index) => ({ ...cluster, id: `C-${String(index + 1).padStart(3, '0')}` }));
}

/**
 * Creates up to one candidate per cross-account post pair. Lexical candidates
 * are retained first; remaining pairs are prioritized by temporal proximity as
 * a bounded semantic-discovery pass. Exact-match posts never become candidates.
 */
export function createSemanticCandidates(posts, baselineClusters, discoveryNeighborWindow = 1) {
  const exactPostIds = new Set(
    baselineClusters
      .filter((cluster) => cluster.matchType === 'exact')
      .flatMap((cluster) => cluster.posts.map((post) => post.id)),
  );
  const candidates = new Map();

  function addCandidate(left, right, source, lexicalSimilarity = null) {
    if (left.id === right.id || normalizedAccount(left) === normalizedAccount(right)) return;
    if (exactPostIds.has(left.id) || exactPostIds.has(right.id)) return;
    const [first, second] = left.id.localeCompare(right.id, 'ja') <= 0 ? [left, right] : [right, left];
    const key = pairKey(first, second);
    const existing = candidates.get(key) || {
      candidateId: `semantic:${key}`,
      left: first,
      right: second,
      sources: new Set(),
      lexicalSimilarity: null,
      timeDifferenceMs: Math.abs(Date.parse(first.postedAt) - Date.parse(second.postedAt)),
    };
    existing.sources.add(source);
    if (Number.isFinite(lexicalSimilarity)) {
      existing.lexicalSimilarity = Math.max(existing.lexicalSimilarity ?? 0, lexicalSimilarity);
    }
    candidates.set(key, existing);
  }

  baselineClusters
    .filter((cluster) => cluster.matchType === 'approximate')
    .forEach((cluster) => {
      for (let leftIndex = 0; leftIndex < cluster.posts.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < cluster.posts.length; rightIndex += 1) {
          addCandidate(cluster.posts[leftIndex], cluster.posts[rightIndex], 'lexical', cluster.similarity);
        }
      }
    });

  const nonExactPosts = sortPosts(posts.filter((post) => !exactPostIds.has(post.id)));
  for (let leftIndex = 0; leftIndex < nonExactPosts.length; leftIndex += 1) {
    const lastIndex = Math.min(nonExactPosts.length, leftIndex + 1 + discoveryNeighborWindow);
    for (let rightIndex = leftIndex + 1; rightIndex < lastIndex; rightIndex += 1) {
      addCandidate(nonExactPosts[leftIndex], nonExactPosts[rightIndex], 'discovery');
    }
  }

  return [...candidates.values()].sort(compareCandidatePriority);
}

/**
 * Applies completed LLM judgments to the final approximate graph. A completed
 * non_match removes a lexical edge; a completed match adds both lexical and
 * discovery-only edges. Unreviewed, abstained, and unavailable lexical edges
 * remain visible, while discovery-only pairs require an LLM match.
 */
export function reconcileSemanticClusters({ posts, baselineClusters, candidates, judgments }) {
  const exactClusters = baselineClusters
    .filter((cluster) => cluster.matchType === 'exact')
    .map((cluster) => ({ ...cluster, posts: sortPosts(cluster.posts), semantic: null }));
  const exactPostIds = new Set(exactClusters.flatMap((cluster) => cluster.posts.map((post) => post.id)));
  const eligiblePosts = posts.filter((post) => !exactPostIds.has(post.id));
  const unionFind = new UnionFind(eligiblePosts.map((post) => post.id));
  const edgeScores = new Map();
  let addedBySemantic = 0;
  let excludedBySemantic = 0;

  candidates.forEach((candidate) => {
    const judgment = judgments.get(candidate.candidateId);
    const lexical = candidate.sources.has('lexical');
    const completedMatch = judgment?.status === 'completed' && judgment.label === 'match';
    const completedNonMatch = judgment?.status === 'completed' && judgment.label === 'non_match';
    const include = completedMatch || (!completedNonMatch && lexical);
    if (completedNonMatch && lexical) excludedBySemantic += 1;
    if (completedMatch && !lexical) addedBySemantic += 1;
    if (!include) return;

    unionFind.union(candidate.left.id, candidate.right.id);
    edgeScores.set(pairKey(candidate.left, candidate.right), Math.max(
      candidate.lexicalSimilarity ?? 0,
      Number.isFinite(judgment?.score) ? judgment.score : 0,
    ));
  });

  const grouped = new Map();
  eligiblePosts.forEach((post) => {
    const root = unionFind.find(post.id);
    const group = grouped.get(root) || [];
    group.push(post);
    grouped.set(root, group);
  });

  const approximateClusters = [...grouped.values()]
    .filter((group) => accountCount(group) >= 2)
    .map((group) => {
      const sortedPosts = sortPosts(group);
      let similarity = 0;
      for (let leftIndex = 0; leftIndex < sortedPosts.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < sortedPosts.length; rightIndex += 1) {
          similarity = Math.max(similarity, edgeScores.get(pairKey(sortedPosts[leftIndex], sortedPosts[rightIndex])) ?? 0);
        }
      }
      return {
        id: '',
        matchType: 'approximate',
        similarity: Number(similarity.toFixed(2)),
        posts: sortedPosts,
        accountCount: accountCount(sortedPosts),
        postCount: sortedPosts.length,
      };
    });

  let clusters = reindexClusters([...exactClusters, ...approximateClusters]);
  clusters = clusters.map((cluster) => ({
    ...cluster,
    semantic: cluster.matchType === 'approximate' ? summarizeClusterJudgments(cluster, candidates, judgments) : null,
  }));

  return { clusters, addedBySemantic, excludedBySemantic };
}
