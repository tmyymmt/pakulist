import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import {
  createOrcaRouterSemanticProvider,
  SemanticRequestValidationError,
} from './src/orcarouter-semantic-provider.js';

const MAX_BODY_BYTES = 32 * 1024;

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function errorPayload(code, message) {
  return { error: { code, message } };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new SemanticRequestValidationError('リクエスト本文は32KB以下にしてください。');
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SemanticRequestValidationError('リクエスト本文はJSON形式にしてください。');
  }
}

function authorizationIsValid(request, requiredToken) {
  if (!requiredToken) return true;
  return request.headers.authorization === `Bearer ${requiredToken}`;
}

/**
 * 最小限のローカル試作API。
 * これは認証・課金・永続化を備えないため、公開インターネットへ公開してはならない。
 */
export function createSemanticApiServer({
  provider = createOrcaRouterSemanticProvider(),
  requiredToken = process.env.SEMANTIC_API_BEARER_TOKEN,
} = {}) {
  return createServer(async (request, response) => {
    const method = request.method || '';
    const url = new URL(request.url || '/', 'http://localhost');

    if (method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, {
        status: 'ok',
        provider: 'orcarouter',
        configured: provider.isConfigured(),
      });
      return;
    }

    if (url.pathname !== '/v1/semantic-judgments') {
      sendJson(response, 404, errorPayload('not_found', 'エンドポイントが見つかりません。'));
      return;
    }

    if (method !== 'POST') {
      sendJson(response, 405, errorPayload('method_not_allowed', 'POSTだけを受け付けます。'), { Allow: 'POST' });
      return;
    }

    if (!authorizationIsValid(request, requiredToken)) {
      sendJson(response, 401, errorPayload('unauthorized', '認証に失敗しました。'));
      return;
    }

    try {
      const result = await provider.judge(await readJson(request));
      sendJson(response, result.status === 'completed' ? 200 : 503, result);
    } catch (error) {
      if (error instanceof SemanticRequestValidationError) {
        sendJson(response, 400, errorPayload('invalid_request', error.message));
        return;
      }
      sendJson(response, 500, errorPayload('internal_error', 'リクエストを処理できませんでした。'));
    }
  });
}

function startServer() {
  const host = process.env.SEMANTIC_API_HOST || '127.0.0.1';
  const port = Number.parseInt(process.env.SEMANTIC_API_PORT || '4180', 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('SEMANTIC_API_PORT は1〜65535の整数にしてください。');
  }

  const server = createSemanticApiServer();
  server.listen(port, host, () => {
    console.log(`pakulist semantic API prototype: http://${host}:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
