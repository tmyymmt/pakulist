import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = resolve(directory, 'public');
const sourceDirectory = resolve(directory, 'src');
const host = process.env.HOST || '127.0.0.1';
const displayHost = host === '0.0.0.0' ? 'localhost' : host;
const port = Number.parseInt(process.env.PORT || '4173', 10);
const semanticApiHost = process.env.SEMANTIC_API_HOST || '127.0.0.1';
const semanticApiPort = Number.parseInt(process.env.SEMANTIC_API_PORT || '4180', 10);
const semanticApiOrigin = `http://${semanticApiHost}:${semanticApiPort}`;
const semanticApiToken = process.env.SEMANTIC_API_BEARER_TOKEN || '';
const SEMANTIC_PROXY_TIMEOUT_MS = 12_000;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function sendJson(response, status, payload) {
  send(response, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8' });
}

function resolveStaticPath(rootDirectory, relativePath) {
  const candidate = resolve(rootDirectory, normalize(relativePath));
  if (candidate !== rootDirectory && !candidate.startsWith(`${rootDirectory}/`)) return null;
  return candidate;
}

function filePathFromUrl(url) {
  const requestPath = new URL(url, `http://${host}`).pathname;
  const decoded = decodeURIComponent(requestPath);
  if (decoded.startsWith('/src/')) {
    return resolveStaticPath(sourceDirectory, decoded.slice('/src/'.length));
  }
  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  return resolveStaticPath(publicDirectory, relativePath);
}

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024) throw new RangeError('リクエスト本文は32KB以下にしてください。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxySemanticRequest(request, response, targetPath) {
  if (!isLoopbackAddress(request.socket.remoteAddress || '')) {
    sendJson(response, 403, { error: { code: 'local_only', message: '意味的類似判定はローカル接続からのみ利用できます。' } });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEMANTIC_PROXY_TIMEOUT_MS);
  try {
    const headers = { Accept: 'application/json' };
    if (request.method === 'POST') headers['Content-Type'] = 'application/json';
    if (semanticApiToken) headers.Authorization = `Bearer ${semanticApiToken}`;

    const upstream = await fetch(`${semanticApiOrigin}${targetPath}`, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? await readRequestBody(request) : undefined,
      signal: controller.signal,
    });
    const content = await upstream.text();
    send(response, upstream.status, content, { 'Content-Type': 'application/json; charset=utf-8' });
  } catch (error) {
    const message = error instanceof RangeError
      ? error.message
      : 'ローカルの意味的類似APIに接続できません。APIを起動してから再度お試しください。';
    sendJson(response, error instanceof RangeError ? 400 : 503, { error: { code: 'semantic_api_unavailable', message } });
  } finally {
    clearTimeout(timeout);
  }
}

const server = createServer(async (request, response) => {
  const method = request.method || '';
  const path = new URL(request.url || '/', `http://${host}`).pathname;

  if (path === '/api/semantic-status' && method === 'GET') {
    await proxySemanticRequest(request, response, '/healthz');
    return;
  }
  if (path === '/api/semantic-judgments' && method === 'POST') {
    await proxySemanticRequest(request, response, '/v1/semantic-judgments');
    return;
  }

  if (!['GET', 'HEAD'].includes(method)) {
    send(response, 405, 'Method Not Allowed', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  let filePath;
  try {
    filePath = filePathFromUrl(request.url || '/');
  } catch {
    send(response, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  if (!filePath) {
    send(response, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      send(response, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    const extension = extname(filePath).toLowerCase();
    const headers = { 'Content-Type': contentTypes[extension] || 'application/octet-stream' };
    if (method === 'HEAD') {
      send(response, 200, '', headers);
      return;
    }
    send(response, 200, await readFile(filePath), headers);
  } catch {
    send(response, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.listen(port, host, () => {
  console.log(`pakulist local web app: http://${displayHost}:${port}`);
});
