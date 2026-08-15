import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileSemanticClusters } from '../src/semantic-cluster-reconciliation.js';

function post(id, account, text, minute) {
  return {
    id,
    account,
    text,
    url: `https://x.com/${account}/status/${id}`,
    postedAt: `2026-08-13T00:${String(minute).padStart(2, '0')}:00Z`,
  };
}

function result(label, score = 0.9) {
  return {
    status: 'completed',
    label,
    score,
    resolvedModel: 'test-model',
  };
}

test('LLM non_match removes a lexical approximate edge from final clusters', () => {
  const left = post('a', 'alpha', '新機能は本日18時に公開します。', 0);
  const right = post('b', 'beta', '新機能は本日18時に公開しません。', 1);
  const lexicalCandidate = {
    candidateId: 'semantic:a:b',
    left,
    right,
    sources: new Set(['lexical']),
    lexicalSimilarity: 0.8,
  };
  const baselineClusters = [{
    id: 'C-001',
    matchType: 'approximate',
    similarity: 0.8,
    posts: [left, right],
    accountCount: 2,
    postCount: 2,
  }];

  const reconciled = reconcileSemanticClusters({
    posts: [left, right],
    baselineClusters,
    candidates: [lexicalCandidate],
    judgments: new Map([[lexicalCandidate.candidateId, result('non_match')]]),
  });

  assert.equal(reconciled.clusters.length, 0);
  assert.equal(reconciled.excludedBySemantic, 1);
  assert.equal(reconciled.addedBySemantic, 0);
});

test('LLM match adds a discovery-only semantic pair to final approximate clusters', () => {
  const left = post('c', 'gamma', '本日の集まりは取りやめになりました。', 2);
  const right = post('d', 'delta', '予定していたミーティングは中止です。', 3);
  const discoveryCandidate = {
    candidateId: 'semantic:c:d',
    left,
    right,
    sources: new Set(['discovery']),
    lexicalSimilarity: null,
  };

  const reconciled = reconcileSemanticClusters({
    posts: [left, right],
    baselineClusters: [],
    candidates: [discoveryCandidate],
    judgments: new Map([[discoveryCandidate.candidateId, result('match', 0.93)]]),
  });

  assert.equal(reconciled.clusters.length, 1);
  assert.equal(reconciled.clusters[0].matchType, 'approximate');
  assert.deepEqual(reconciled.clusters[0].posts.map((item) => item.id), ['c', 'd']);
  assert.equal(reconciled.clusters[0].semantic.matches, 1);
  assert.equal(reconciled.addedBySemantic, 1);
  assert.equal(reconciled.excludedBySemantic, 0);
});
