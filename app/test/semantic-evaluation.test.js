import assert from 'node:assert/strict';
import test from 'node:test';
import fixture from '../evaluation/semantic-similarity-cases.json' with { type: 'json' };

import {
  estimateSemanticJudgmentCost,
  evaluateSemanticPredictions,
} from '../src/semantic-evaluation.js';

const cases = [
  { id: 'case-1', expectedLabel: 'match' },
  { id: 'case-2', expectedLabel: 'non_match' },
  { id: 'case-3', expectedLabel: 'non_match' },
  { id: 'case-4', expectedLabel: 'match' },
  { id: 'case-5', expectedLabel: 'match' },
];

test('意味的類似の評価でTP・FP・TN・FN・F1・棄権率を計算する', () => {
  const result = evaluateSemanticPredictions(cases, [
    { id: 'case-1', label: 'match' },
    { id: 'case-2', label: 'match' },
    { id: 'case-3', label: 'non_match' },
    { id: 'case-4', label: 'non_match' },
    { id: 'case-5', label: 'abstain' },
  ]);

  assert.deepEqual(result, {
    total: 5,
    decided: 4,
    abstained: 1,
    abstentionRate: 0.2,
    truePositive: 1,
    falsePositive: 1,
    trueNegative: 1,
    falseNegative: 1,
    precision: 0.5,
    recall: 0.5,
    f1: 0.5,
    accuracy: 0.5,
    falsePositiveRate: 0.5,
  });
});

test('陽性予測がない場合も評価値を安全に0へ定義する', () => {
  const result = evaluateSemanticPredictions([
    { id: 'positive', expectedLabel: 'match' },
    { id: 'negative', expectedLabel: 'non_match' },
  ], [
    { id: 'positive', label: 'non_match' },
    { id: 'negative', label: 'non_match' },
  ]);

  assert.equal(result.precision, 0);
  assert.equal(result.recall, 0);
  assert.equal(result.f1, 0);
  assert.equal(result.accuracy, 0.5);
});

test('評価対象と予測のIDが一致しない場合は失敗する', () => {
  assert.throws(
    () => evaluateSemanticPredictions(cases, [
      { id: 'case-1', label: 'match' },
    ]),
    (error) => error instanceof TypeError && error.message.includes('すべての評価ケース'),
  );

  assert.throws(
    () => evaluateSemanticPredictions(cases, cases.map((item) => ({
      id: item.id,
      label: 'unknown',
    }))),
    (error) => error instanceof TypeError && error.message.includes('match、non_match、abstain'),
  );
});

test('架空評価セットは8件の二値ラベルを持ち、完全予測ではF1が1になる', () => {
  assert.equal(fixture.cases.length, 8);
  assert.deepEqual([...new Set(fixture.cases.map((item) => item.expectedLabel))].sort(), ['match', 'non_match']);

  const result = evaluateSemanticPredictions(fixture.cases, fixture.cases.map((item) => ({
    id: item.id,
    label: item.expectedLabel,
  })));

  assert.equal(result.f1, 1);
  assert.equal(result.abstentionRate, 0);
});

test('空の評価ケースは明示的に拒否する', () => {
  assert.throws(
    () => evaluateSemanticPredictions([], []),
    (error) => error instanceof TypeError && error.message.includes('1件以上'),
  );
});

test('入力・出力トークン単価とルーター追加費用から1判定の原価を計算する', () => {
  const cost = estimateSemanticJudgmentCost({
    inputTokens: 2_500,
    outputTokens: 250,
    inputPricePerMToken: 0.4,
    outputPricePerMToken: 1.6,
    routerSurcharge: 0.003,
  });

  assert.equal(cost, 0.0044);
});

test('原価計算は負数・無限大・欠落単価を拒否する', () => {
  assert.throws(
    () => estimateSemanticJudgmentCost({
      inputTokens: -1,
      outputTokens: 0,
      inputPricePerMToken: 1,
      outputPricePerMToken: 1,
    }),
    (error) => error instanceof TypeError && error.message.includes('inputTokens'),
  );
  assert.throws(
    () => estimateSemanticJudgmentCost({
      inputTokens: 1,
      outputTokens: 1,
      inputPricePerMToken: Infinity,
      outputPricePerMToken: 1,
    }),
    (error) => error instanceof TypeError && error.message.includes('inputPricePerMToken'),
  );
});
