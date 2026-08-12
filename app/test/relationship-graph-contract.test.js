import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const contractUrl = new URL('../../doc/contracts/relationship-graph.schema.json', import.meta.url);
const exampleUrl = new URL('../../doc/contracts/examples/relationship-graph-response.json', import.meta.url);

async function loadJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

test('関係性グラフ契約は本文を含まず、ノード・エッジ・ページングを定義する', async () => {
  const schema = await loadJson(contractUrl);
  assert.equal(schema.properties.schemaVersion.const, '1.0');
  assert.deepEqual(schema.required, ['schemaVersion', 'caseId', 'generatedAt', 'filters', 'nodes', 'edges', 'page']);
  assert.equal(JSON.stringify(schema).includes('contentText'), false);
  assert.deepEqual(
    schema.properties.filters.properties.edgeTypes.items.enum,
    ['duplicate_text', 'approximate_text', 'later_copy_candidate'],
  );
});

test('関係性グラフの契約例はエッジ根拠の集約と時系列を整合させる', async () => {
  const response = await loadJson(exampleUrl);
  const accountIds = new Set(response.nodes.map((node) => node.accountId));

  assert.equal(response.schemaVersion, '1.0');
  assert.equal(JSON.stringify(response).includes('"contentText"'), false);
  assert.equal(JSON.stringify(response).includes('"postText"'), false);
  assert.ok(response.filters.minEvidenceCount >= 1);
  assert.ok(Date.parse(response.filters.from) <= Date.parse(response.filters.to));

  response.edges.forEach((edge) => {
    assert.ok(accountIds.has(edge.sourceAccountId));
    assert.ok(accountIds.has(edge.targetAccountId));
    assert.notEqual(edge.sourceAccountId, edge.targetAccountId);
    assert.ok(response.filters.edgeTypes.includes(edge.edgeType));
    assert.ok(edge.evidenceCount >= response.filters.minEvidenceCount);
    assert.ok(Date.parse(edge.firstObservedAt) <= Date.parse(edge.lastObservedAt));
  });
});
