export const MAX_POSTS = 5000;

export const DEFAULT_OPTIONS = Object.freeze({
  approximate: true,
  threshold: 0.8,
  ignoreUrls: true,
  ignoreMentions: true,
});

export class InputValidationError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'InputValidationError';
    this.errors = errors;
  }
}

function createInputError(message) {
  return new InputValidationError([message]);
}

function requiredText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidIsoDate(value) {
  if (!requiredText(value)) return false;
  const hasTimezone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return hasTimezone && !Number.isNaN(Date.parse(value));
}

function isValidHttpsUrl(value) {
  if (!requiredText(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizePost(raw, index) {
  const row = index + 1;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: [`入力行 ${row}: 投稿はオブジェクトである必要があります。`] };
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const account = typeof raw.account === 'string' ? raw.account.trim().replace(/^@+/, '') : '';
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  const postedAt = typeof raw.postedAt === 'string' ? raw.postedAt.trim() : '';
  const text = typeof raw.text === 'string' ? raw.text : '';
  const errors = [];

  if (!requiredText(id)) errors.push(`入力行 ${row}: id は空でない文字列にしてください。`);
  if (!requiredText(account)) errors.push(`入力行 ${row}: account は空でない文字列にしてください。`);
  if (account.length > 30) errors.push(`入力行 ${row}: account は30文字以内にしてください。`);
  if (!isValidHttpsUrl(url)) errors.push(`入力行 ${row}: url は https:// で始まる有効なURLにしてください。`);
  if (!isValidIsoDate(postedAt)) errors.push(`入力行 ${row}: postedAt はタイムゾーン付きのISO 8601形式にしてください。`);
  if (!requiredText(text)) errors.push(`入力行 ${row}: text は空白以外を含む文字列にしてください。`);

  if (errors.length > 0) return { errors };
  return { post: { id, account, url, postedAt, text } };
}

export function validatePosts(rawPosts) {
  if (!Array.isArray(rawPosts)) {
    throw createInputError('投稿データは配列である必要があります。');
  }
  if (rawPosts.length === 0) {
    throw createInputError('投稿データが0件です。少なくとも1件を入力してください。');
  }
  if (rawPosts.length > MAX_POSTS) {
    throw createInputError(`投稿データは最大${MAX_POSTS.toLocaleString('ja-JP')}件までです。`);
  }

  const errors = [];
  const posts = [];
  const ids = new Set();
  rawPosts.forEach((raw, index) => {
    const result = normalizePost(raw, index);
    if (result.errors) {
      errors.push(...result.errors);
      return;
    }
    if (ids.has(result.post.id)) {
      errors.push(`入力行 ${index + 1}: id "${result.post.id}" が重複しています。`);
      return;
    }
    ids.add(result.post.id);
    posts.push(result.post);
  });

  if (errors.length > 0) throw new InputValidationError(errors);
  return posts;
}

export function parseCsv(content) {
  if (typeof content !== 'string' || content.length === 0) {
    throw createInputError('CSVファイルが空です。');
  }

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];

    if (quoted) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length !== 0) {
        throw createInputError(`CSV ${rows.length + 1}行目: 引用符の開始位置が不正です。`);
      }
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }

  if (quoted) throw createInputError('CSV: 引用符が閉じられていません。');
  row.push(field);
  if (row.length > 1 || row[0] !== '' || rows.length === 0) rows.push(row);

  const [headers, ...dataRows] = rows;
  const requiredHeaders = ['id', 'account', 'url', 'postedAt', 'text'];
  if (!headers || !requiredHeaders.every((header) => headers.includes(header))) {
    throw createInputError(`CSVヘッダには ${requiredHeaders.join(', ')} がすべて必要です。`);
  }

  return dataRows
    .filter((dataRow) => dataRow.some((value) => value.trim() !== ''))
    .map((dataRow, rowIndex) => {
      if (dataRow.length !== headers.length) {
        throw createInputError(`CSV ${rowIndex + 2}行目: 列数がヘッダと一致しません。`);
      }
      return Object.fromEntries(headers.map((header, index) => [header, dataRow[index]]));
    });
}

export function parseXApiSearchResponse(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createInputError('X API JSON: ルートはオブジェクトである必要があります。');
  }

  if (!Array.isArray(payload.data)) {
    throw createInputError('X API JSON: data は投稿オブジェクトの配列である必要があります。');
  }

  if (!Array.isArray(payload.includes?.users)) {
    throw createInputError('X API JSON: includes.users は author_id と username を結合するための配列である必要があります。');
  }

  const usernameByUserId = new Map();
  payload.includes.users.forEach((user) => {
    if (!user || typeof user !== 'object' || Array.isArray(user)) return;
    const id = typeof user.id === 'string' ? user.id.trim() : '';
    const username = typeof user.username === 'string' ? user.username.trim().replace(/^@+/, '') : '';
    if (requiredText(id) && requiredText(username)) usernameByUserId.set(id, username);
  });

  const errors = [];
  const posts = [];
  payload.data.forEach((raw, index) => {
    const item = index + 1;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`X API data[${item}]: 投稿はオブジェクトである必要があります。`);
      return;
    }

    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const authorId = typeof raw.author_id === 'string' ? raw.author_id.trim() : '';
    const text = typeof raw.text === 'string' ? raw.text : '';
    const postedAt = typeof raw.created_at === 'string' ? raw.created_at.trim() : '';
    const account = usernameByUserId.get(authorId) || '';

    if (!requiredText(id)) errors.push(`X API data[${item}]: id は空でない文字列にしてください。`);
    if (!requiredText(authorId)) errors.push(`X API data[${item}]: author_id は空でない文字列にしてください。`);
    if (requiredText(authorId) && !requiredText(account)) {
      errors.push(`X API data[${item}]: author_id "${authorId}" に対応する includes.users の username が見つかりません。`);
    }
    if (!requiredText(postedAt)) errors.push(`X API data[${item}]: created_at は空でない文字列にしてください。`);
    if (!requiredText(text)) errors.push(`X API data[${item}]: text は空白以外を含む文字列にしてください。`);

    if (requiredText(id) && requiredText(account)) {
      posts.push({
        id,
        account,
        url: `https://x.com/${encodeURIComponent(account)}/status/${encodeURIComponent(id)}`,
        postedAt,
        text,
      });
    }
  });

  if (errors.length > 0) throw new InputValidationError(errors);
  return posts;
}

export function parseInput(content, fileName) {
  const normalizedName = String(fileName || '').toLowerCase();
  let rawPosts;

  if (normalizedName.endsWith('.json')) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        rawPosts = parsed;
      } else if (Array.isArray(parsed?.posts)) {
        rawPosts = parsed.posts;
      } else if (Object.hasOwn(parsed || {}, 'data')) {
        rawPosts = parseXApiSearchResponse(parsed);
      } else {
        rawPosts = undefined;
      }
    } catch (error) {
      if (error instanceof InputValidationError) throw error;
      throw createInputError('JSONの形式が正しくありません。');
    }
  } else if (normalizedName.endsWith('.csv')) {
    rawPosts = parseCsv(content);
  } else {
    throw createInputError('入力できるファイル形式は .csv または .json だけです。');
  }

  return validatePosts(rawPosts);
}

export function normalizeText(text, options = DEFAULT_OPTIONS) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  let normalized = String(text).normalize('NFKC').toLocaleLowerCase('en-US');
  if (settings.ignoreUrls) normalized = normalized.replace(/https?:\/\/\S+/giu, ' ');
  if (settings.ignoreMentions) normalized = normalized.replace(/@[a-z0-9_]+/giu, ' ');
  return normalized.replace(/\s+/gu, ' ').trim();
}

export function tokenize(normalizedText) {
  const tokens = [];
  const matches = normalizedText.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+|[\p{Letter}\p{Number}_]+/gu);
  for (const match of matches) {
    const token = match[0];
    const isJapaneseScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token);
    if (!isJapaneseScript) {
      tokens.push(token);
    } else if (token.length === 1) {
      tokens.push(token);
    } else {
      for (let index = 0; index < token.length - 1; index += 1) {
        tokens.push(token.slice(index, index + 2));
      }
    }
  }
  return new Set(tokens);
}

export function jaccardSimilarity(leftText, rightText) {
  const left = tokenize(leftText);
  const right = tokenize(rightText);
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index) {
    if (this.parent[index] !== index) this.parent[index] = this.find(this.parent[index]);
    return this.parent[index];
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent[rightRoot] = leftRoot;
  }
}

function uniqueAccountCount(posts) {
  return new Set(posts.map((post) => post.account.toLocaleLowerCase('en-US'))).size;
}

function sortPosts(posts) {
  return [...posts].sort((left, right) => (
    Date.parse(left.postedAt) - Date.parse(right.postedAt)
    || left.account.localeCompare(right.account, 'ja')
    || left.id.localeCompare(right.id, 'ja')
  ));
}

function createCluster(matchType, similarity, posts) {
  const sortedPosts = sortPosts(posts);
  return {
    matchType,
    similarity: Number(similarity.toFixed(2)),
    posts: sortedPosts,
    accountCount: uniqueAccountCount(sortedPosts),
    postCount: sortedPosts.length,
  };
}

function validateOptions(options) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  if (typeof settings.approximate !== 'boolean' || typeof settings.ignoreUrls !== 'boolean' || typeof settings.ignoreMentions !== 'boolean') {
    throw new TypeError('判定設定の真偽値が不正です。');
  }
  if (!Number.isFinite(settings.threshold) || settings.threshold < 0.5 || settings.threshold > 1) {
    throw new RangeError('近似一致の閾値は0.50から1.00の範囲にしてください。');
  }
  return settings;
}

function jaccardTokenSets(left, right) {
  if (left.size === 0 || right.size === 0) return 0;

  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let intersection = 0;
  for (const token of smaller) {
    if (larger.has(token)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function createPrefixIndexedTokenSets(posts, threshold) {
  const tokenSets = posts.map((post) => tokenize(post.normalizedText));
  const frequencies = new Map();
  tokenSets.forEach((tokens) => {
    tokens.forEach((token) => frequencies.set(token, (frequencies.get(token) || 0) + 1));
  });

  return tokenSets.map((tokens) => {
    const orderedTokens = [...tokens].sort((left, right) => (
      frequencies.get(left) - frequencies.get(right)
      || left.localeCompare(right, 'en')
    ));
    const prefixLength = Math.max(0, orderedTokens.length - Math.ceil(threshold * orderedTokens.length) + 1);
    return { tokens, prefixTokens: orderedTokens.slice(0, prefixLength) };
  });
}

function clusterApproximate(posts, settings) {
  const unionFind = new UnionFind(posts.length);
  const pairSimilarities = new Map();
  const normalizedAccounts = posts.map((post) => post.account.toLocaleLowerCase('en-US'));
  const indexedTokenSets = createPrefixIndexedTokenSets(posts, settings.threshold);
  const prefixIndex = new Map();

  indexedTokenSets.forEach(({ tokens, prefixTokens }, index) => {
    const candidateIndices = new Set();
    prefixTokens.forEach((token) => {
      prefixIndex.get(token)?.forEach((candidateIndex) => candidateIndices.add(candidateIndex));
    });

    candidateIndices.forEach((candidateIndex) => {
      if (normalizedAccounts[candidateIndex] === normalizedAccounts[index]) return;

      const candidateTokens = indexedTokenSets[candidateIndex].tokens;
      const smallerSize = Math.min(tokens.size, candidateTokens.size);
      const largerSize = Math.max(tokens.size, candidateTokens.size);
      if (smallerSize === 0 || smallerSize / largerSize < settings.threshold) return;

      const similarity = jaccardTokenSets(candidateTokens, tokens);
      if (similarity >= settings.threshold) {
        unionFind.union(candidateIndex, index);
        pairSimilarities.set(`${candidateIndex}:${index}`, similarity);
      }
    });

    prefixTokens.forEach((token) => {
      const indices = prefixIndex.get(token) || [];
      indices.push(index);
      prefixIndex.set(token, indices);
    });
  });

  const grouped = new Map();
  posts.forEach((post, index) => {
    const root = unionFind.find(index);
    const group = grouped.get(root) || [];
    group.push({ post, index });
    grouped.set(root, group);
  });

  return [...grouped.values()]
    .filter((group) => uniqueAccountCount(group.map(({ post }) => post)) >= 2)
    .map((group) => {
      let maximumSimilarity = 0;
      for (let left = 0; left < group.length; left += 1) {
        for (let right = left + 1; right < group.length; right += 1) {
          const first = Math.min(group[left].index, group[right].index);
          const second = Math.max(group[left].index, group[right].index);
          maximumSimilarity = Math.max(maximumSimilarity, pairSimilarities.get(`${first}:${second}`) || 0);
        }
      }
      return createCluster('approximate', maximumSimilarity, group.map(({ post }) => post));
    });
}

export function findDuplicateClusters(posts, options = DEFAULT_OPTIONS) {
  const settings = validateOptions(options);
  const validatedPosts = validatePosts(posts);
  const preparedPosts = validatedPosts.map((post) => ({
    ...post,
    normalizedText: normalizeText(post.text, settings),
  }));

  const exactGroups = new Map();
  for (const post of preparedPosts) {
    if (post.normalizedText === '') continue;
    const group = exactGroups.get(post.normalizedText) || [];
    group.push(post);
    exactGroups.set(post.normalizedText, group);
  }

  const exactClusters = [];
  const exactIds = new Set();
  for (const group of exactGroups.values()) {
    if (uniqueAccountCount(group) >= 2) {
      exactClusters.push(createCluster('exact', 1, group));
      group.forEach((post) => exactIds.add(post.id));
    }
  }

  const approximateClusters = settings.approximate
    ? clusterApproximate(preparedPosts.filter((post) => !exactIds.has(post.id) && post.normalizedText !== ''), settings)
    : [];

  const clusters = [...exactClusters, ...approximateClusters].sort((left, right) => (
    (left.matchType === 'exact' ? 0 : 1) - (right.matchType === 'exact' ? 0 : 1)
    || right.similarity - left.similarity
    || right.accountCount - left.accountCount
    || Date.parse(left.posts[0].postedAt) - Date.parse(right.posts[0].postedAt)
  ));

  return clusters.map((cluster, index) => ({
    id: `C-${String(index + 1).padStart(3, '0')}`,
    ...cluster,
  }));
}

function csvSafe(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function clustersToCsv(clusters) {
  const headers = ['clusterId', 'matchType', 'similarity', 'accountCount', 'postCount', 'account', 'url', 'postedAt', 'text'];
  const rows = [headers.map(csvSafe).join(',')];

  for (const cluster of clusters) {
    for (const post of cluster.posts) {
      rows.push([
        cluster.id,
        cluster.matchType,
        cluster.similarity.toFixed(2),
        cluster.accountCount,
        cluster.postCount,
        post.account,
        post.url,
        post.postedAt,
        post.text,
      ].map(csvSafe).join(','));
    }
  }
  return `${rows.join('\r\n')}\r\n`;
}
