const ORCAROUTER_BASE_URL = 'https://api.orcarouter.ai/v1';
const MAX_TEXT_LENGTH = 4_000;
const VALID_LABELS = new Set(['match', 'non_match', 'abstain']);

export class SemanticRequestValidationError extends Error {}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SemanticRequestValidationError(`${name} は空でない文字列にしてください。`);
  }
  return value.trim();
}

function validateText(value, name) {
  const text = requireNonEmptyString(value, name);
  if (text.length > MAX_TEXT_LENGTH) {
    throw new SemanticRequestValidationError(`${name} は${MAX_TEXT_LENGTH.toLocaleString('ja-JP')}文字以下にしてください。`);
  }
  return text;
}

function validateProviderRequest({ requestId, candidateId, left, right }) {
  return {
    requestId: requireNonEmptyString(requestId, 'requestId'),
    candidateId: requireNonEmptyString(candidateId, 'candidateId'),
    left: { text: validateText(left?.text, 'left.text') },
    right: { text: validateText(right?.text, 'right.text') },
  };
}

function isFixedProviderModel(model) {
  return typeof model === 'string'
    && /^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9._:-]+$/.test(model)
    && model !== 'orcarouter/auto';
}

function createUnavailableResult({ requestId, candidateId, reason, retryAfterSeconds = null }) {
  return {
    requestId,
    candidateId,
    status: 'unavailable',
    label: 'abstain',
    score: 0,
    provider: 'orcarouter',
    resolvedModel: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    reason,
    retryAfterSeconds,
  };
}

function responseErrorReason(status) {
  if (status === 401) return 'provider_auth_failed';
  if (status === 402) return 'provider_quota_exceeded';
  if (status === 429) return 'provider_rate_limited';
  if (status === 502) return 'provider_unavailable';
  return 'provider_request_failed';
}

function parseRetryAfter(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseUsage(usage) {
  const inputTokens = Number.isInteger(usage?.prompt_tokens) && usage.prompt_tokens >= 0 ? usage.prompt_tokens : 0;
  const outputTokens = Number.isInteger(usage?.completion_tokens) && usage.completion_tokens >= 0 ? usage.completion_tokens : 0;
  return { inputTokens, outputTokens };
}

function parseVerdict(content) {
  if (typeof content !== 'string') throw new TypeError('モデル応答が文字列ではありません。');
  const parsed = JSON.parse(content);
  if (!VALID_LABELS.has(parsed?.label)) throw new TypeError('モデル応答の label が不正です。');
  if (!Number.isFinite(parsed?.score) || parsed.score < 0 || parsed.score > 1) {
    throw new TypeError('モデル応答の score が不正です。');
  }
  return { label: parsed.label, score: parsed.score };
}

function createRequestBody({ model, left, right }) {
  return {
    model,
    temperature: 0,
    max_tokens: 80,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'semantic_judgment',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'score'],
          properties: {
            label: { type: 'string', enum: ['match', 'non_match', 'abstain'] },
            score: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
    messages: [
      {
        role: 'system',
        content: '比較対象の二つの投稿本文を評価し、JSONだけを返してください。matchは実質的に同じ投稿、non_matchは無関係、abstainは判断不能です。違反・侵害・通報対象は断定しません。',
      },
      {
        role: 'user',
        content: JSON.stringify({ left: left.text, right: right.text }),
      },
    ],
  };
}

/**
 * OrcaRouterを呼ぶサーバー側専用の最小アダプターを生成する。
 * APIキー、モデル、上流の詳細エラー本文は呼び出し元へ返さない。
 */
export function createOrcaRouterSemanticProvider({
  apiKey = process.env.ORCAROUTER_API_KEY,
  model = process.env.ORCAROUTER_MODEL,
  baseUrl = process.env.ORCAROUTER_BASE_URL || ORCAROUTER_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  const normalizedBaseUrl = typeof baseUrl === 'string' ? baseUrl.replace(/\/+$/, '') : '';
  const configured = typeof apiKey === 'string'
    && apiKey.trim() !== ''
    && isFixedProviderModel(model)
    && normalizedBaseUrl.startsWith('https://')
    && typeof fetchImpl === 'function'
    && Number.isSafeInteger(timeoutMs)
    && timeoutMs > 0;

  return {
    isConfigured() {
      return configured;
    },

    async judge(request) {
      const validated = validateProviderRequest(request);
      if (!configured) {
        return createUnavailableResult({
          ...validated,
          reason: 'provider_not_configured',
        });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${normalizedBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(createRequestBody({ model, left: validated.left, right: validated.right })),
          signal: controller.signal,
        });

        if (!response?.ok) {
          return createUnavailableResult({
            ...validated,
            reason: responseErrorReason(response?.status),
            retryAfterSeconds: parseRetryAfter(response?.headers?.get?.('retry-after')),
          });
        }

        let payload;
        try {
          payload = await response.json();
        } catch {
          return createUnavailableResult({ ...validated, reason: 'provider_invalid_response' });
        }

        try {
          const verdict = parseVerdict(payload?.choices?.[0]?.message?.content);
          const resolvedModel = typeof response.headers?.get === 'function'
            ? response.headers.get('x-orca-resolved-model') || payload?.model || model
            : payload?.model || model;
          return {
            requestId: validated.requestId,
            candidateId: validated.candidateId,
            status: 'completed',
            ...verdict,
            provider: 'orcarouter',
            resolvedModel: typeof resolvedModel === 'string' ? resolvedModel : model,
            usage: parseUsage(payload?.usage),
            reason: null,
            retryAfterSeconds: null,
          };
        } catch {
          return createUnavailableResult({ ...validated, reason: 'provider_invalid_response' });
        }
      } catch {
        return createUnavailableResult({
          ...validated,
          reason: controller.signal.aborted ? 'provider_timeout' : 'provider_request_failed',
        });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
