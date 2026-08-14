import assert from 'node:assert/strict';
import test from 'node:test';

import { createSemanticApiServer } from '../semantic-api-server.js';
import {
  createOrcaRouterSemanticProvider,
  SemanticRequestValidationError,
} from '../src/orcarouter-semantic-provider.js';

const request = {
  requestId: 'request-1',
  candidateId: 'candidate-1',
  left: { text: '新製品を発売します。' },
  right: { text: '新商品をリリースします。' },
};

function configuredProvider(overrides = {}) {
  return createOrcaRouterSemanticProvider({
    apiKey: 'test-secret',
    model: 'openai/gpt-4o-mini',
    timeoutMs: 1_000,
    ...overrides,
  });
}

async function withServer(server, callback) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('APIキー又は固定モデルがない場合、OrcaRouterへ通信せず棄権する', async () => {
  let fetchCalls = 0;
  const provider = createOrcaRouterSemanticProvider({
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('呼ばれてはいけません');
    },
  });

  const result = await provider.judge(request);
  assert.equal(provider.isConfigured(), false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(result, {
    requestId: 'request-1',
    candidateId: 'candidate-1',
    status: 'unavailable',
    label: 'abstain',
    score: 0,
    provider: 'orcarouter',
    resolvedModel: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    reason: 'provider_not_configured',
    retryAfterSeconds: null,
  });
});

test('固定モデルを使い、最小化した候補ペアだけをOrcaRouterへ送って構造化応答を返す', async () => {
  let requestedUrl;
  let requestedOptions;
  const provider = configuredProvider({
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return new Response(JSON.stringify({
        model: 'openai/gpt-4o-mini',
        choices: [{ message: { content: JSON.stringify({ label: 'match', score: 0.91 }) } }],
        usage: { prompt_tokens: 47, completion_tokens: 12 },
      }), {
        status: 200,
        headers: { 'x-orca-resolved-model': 'openai/gpt-4o-mini' },
      });
    },
  });

  const result = await provider.judge(request);
  const body = JSON.parse(requestedOptions.body);
  assert.equal(requestedUrl, 'https://api.orcarouter.ai/v1/chat/completions');
  assert.equal(requestedOptions.headers.Authorization, 'Bearer test-secret');
  assert.equal(body.model, 'openai/gpt-4o-mini');
  assert.equal(body.temperature, 0);
  assert.equal(body.messages[1].content, JSON.stringify({ left: request.left.text, right: request.right.text }));
  assert.equal(body.response_format.type, 'json_schema');
  assert.deepEqual(result, {
    requestId: 'request-1',
    candidateId: 'candidate-1',
    status: 'completed',
    label: 'match',
    score: 0.91,
    provider: 'orcarouter',
    resolvedModel: 'openai/gpt-4o-mini',
    usage: { inputTokens: 47, outputTokens: 12 },
    reason: null,
    retryAfterSeconds: null,
  });
});

test('orcarouter/autoは再現性のため設定として拒否する', async () => {
  const provider = createOrcaRouterSemanticProvider({
    apiKey: 'test-secret',
    model: 'orcarouter/auto',
    fetchImpl: async () => {
      throw new Error('呼ばれてはいけません');
    },
  });
  const result = await provider.judge(request);
  assert.equal(provider.isConfigured(), false);
  assert.equal(result.reason, 'provider_not_configured');
});

test('レート制限と不正な上流応答は詳細を露出せず棄権する', async () => {
  const rateLimited = configuredProvider({
    fetchImpl: async () => new Response('provider secret error', {
      status: 429,
      headers: { 'retry-after': '7' },
    }),
  });
  const rateLimitedResult = await rateLimited.judge(request);
  assert.equal(rateLimitedResult.status, 'unavailable');
  assert.equal(rateLimitedResult.reason, 'provider_rate_limited');
  assert.equal(rateLimitedResult.retryAfterSeconds, 7);
  assert.equal(JSON.stringify(rateLimitedResult).includes('provider secret error'), false);

  const malformed = configuredProvider({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"label":"unexpected","score":2}' } }],
    }), { status: 200 }),
  });
  const malformedResult = await malformed.judge(request);
  assert.equal(malformedResult.reason, 'provider_invalid_response');
});

test('入力不正はネットワーク呼び出し前に拒否する', async () => {
  const provider = configuredProvider({
    fetchImpl: async () => {
      throw new Error('呼ばれてはいけません');
    },
  });
  await assert.rejects(
    () => provider.judge({ ...request, left: { text: '' } }),
    (error) => error instanceof SemanticRequestValidationError && error.message.includes('left.text'),
  );
});

test('最小HTTP APIはヘルス確認、ローカル認証、入力検証、未設定時の棄権を提供する', async () => {
  const provider = {
    isConfigured: () => false,
    judge: async (input) => ({
      requestId: input.requestId,
      candidateId: input.candidateId,
      status: 'unavailable',
      label: 'abstain',
      score: 0,
      provider: 'orcarouter',
      resolvedModel: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      reason: 'provider_not_configured',
      retryAfterSeconds: null,
    }),
  };
  const server = createSemanticApiServer({ provider, requiredToken: 'local-test-token' });

  await withServer(server, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', provider: 'orcarouter', configured: false });

    const unauthorized = await fetch(`${baseUrl}/v1/semantic-judgments`, {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).error.code, 'unauthorized');

    const invalid = await fetch(`${baseUrl}/v1/semantic-judgments`, {
      method: 'POST',
      body: '{bad json',
      headers: { authorization: 'Bearer local-test-token', 'content-type': 'application/json' },
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'invalid_request');

    const unavailable = await fetch(`${baseUrl}/v1/semantic-judgments`, {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { authorization: 'Bearer local-test-token', 'content-type': 'application/json' },
    });
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).reason, 'provider_not_configured');
  });
});
