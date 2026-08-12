const VALID_LABELS = new Set(['match', 'non_match', 'abstain']);

function requireFiniteNonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} は0以上の有限な数値にしてください。`);
  }
}

function validateCase(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new TypeError(`評価ケース ${index + 1} はオブジェクトにしてください。`);
  }
  if (typeof item.id !== 'string' || item.id.trim() === '') {
    throw new TypeError(`評価ケース ${index + 1} の id は空でない文字列にしてください。`);
  }
  if (!VALID_LABELS.has(item.expectedLabel) || item.expectedLabel === 'abstain') {
    throw new TypeError(`評価ケース ${item.id} の expectedLabel は match または non_match にしてください。`);
  }
}

function validatePrediction(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new TypeError(`予測 ${index + 1} はオブジェクトにしてください。`);
  }
  if (typeof item.id !== 'string' || item.id.trim() === '') {
    throw new TypeError(`予測 ${index + 1} の id は空でない文字列にしてください。`);
  }
  if (!VALID_LABELS.has(item.label)) {
    throw new TypeError(`予測 ${item.id} の label は match、non_match、abstain のいずれかにしてください。`);
  }
}

/**
 * ラベル済み評価セットとモデルまたは決定的手法の予測を比較する。
 * `abstain`は正誤の分母から外し、棄権率として別に報告する。
 */
export function evaluateSemanticPredictions(cases, predictions) {
  if (!Array.isArray(cases) || !Array.isArray(predictions)) {
    throw new TypeError('評価ケースと予測は配列にしてください。');
  }

  if (cases.length === 0) {
    throw new TypeError('評価ケースは1件以上必要です。');
  }

  const expectedById = new Map();
  cases.forEach((item, index) => {
    validateCase(item, index);
    if (expectedById.has(item.id)) throw new TypeError(`評価ケース id "${item.id}" が重複しています。`);
    expectedById.set(item.id, item.expectedLabel);
  });

  const predictionById = new Map();
  predictions.forEach((item, index) => {
    validatePrediction(item, index);
    if (!expectedById.has(item.id)) throw new TypeError(`予測 id "${item.id}" は評価ケースにありません。`);
    if (predictionById.has(item.id)) throw new TypeError(`予測 id "${item.id}" が重複しています。`);
    predictionById.set(item.id, item.label);
  });

  if (predictionById.size !== expectedById.size) {
    throw new TypeError('すべての評価ケースに対する予測が必要です。');
  }

  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  let abstained = 0;

  expectedById.forEach((expectedLabel, id) => {
    const predictedLabel = predictionById.get(id);
    if (predictedLabel === 'abstain') {
      abstained += 1;
    } else if (expectedLabel === 'match' && predictedLabel === 'match') {
      truePositive += 1;
    } else if (expectedLabel === 'non_match' && predictedLabel === 'match') {
      falsePositive += 1;
    } else if (expectedLabel === 'non_match' && predictedLabel === 'non_match') {
      trueNegative += 1;
    } else {
      falseNegative += 1;
    }
  });

  const decided = cases.length - abstained;
  const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const accuracy = decided === 0 ? 0 : (truePositive + trueNegative) / decided;
  const falsePositiveRate = falsePositive + trueNegative === 0 ? 0 : falsePositive / (falsePositive + trueNegative);

  return {
    total: cases.length,
    decided,
    abstained,
    abstentionRate: abstained / cases.length,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    precision,
    recall,
    f1,
    accuracy,
    falsePositiveRate,
  };
}

/**
 * 実測トークン数と、運用開始時に確認したモデル単価から判定原価を算出する。
 * 料金は通貨単位を呼び出し側で統一し、固定値をここへ埋め込まない。
 */
export function estimateSemanticJudgmentCost({
  inputTokens,
  outputTokens,
  inputPricePerMToken,
  outputPricePerMToken,
  routerSurcharge = 0,
}) {
  requireFiniteNonNegative(inputTokens, 'inputTokens');
  requireFiniteNonNegative(outputTokens, 'outputTokens');
  requireFiniteNonNegative(inputPricePerMToken, 'inputPricePerMToken');
  requireFiniteNonNegative(outputPricePerMToken, 'outputPricePerMToken');
  requireFiniteNonNegative(routerSurcharge, 'routerSurcharge');

  return (inputTokens / 1_000_000 * inputPricePerMToken)
    + (outputTokens / 1_000_000 * outputPricePerMToken)
    + routerSurcharge;
}
