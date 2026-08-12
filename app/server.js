import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = resolve(directory, 'public');
const sourceDirectory = resolve(directory, 'src');
const host = process.env.HOST || '0.0.0.0';
const displayHost = host === '0.0.0.0' ? 'localhost' : host;
const port = Number.parseInt(process.env.PORT || '4173', 10);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method || '')) {
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
    if (request.method === 'HEAD') {
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
