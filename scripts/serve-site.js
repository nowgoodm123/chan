#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(root, 'site');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'";

function parseArgs(argv) {
  const options = { port: 8080, host: '127.0.0.1', open: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--port' || arg === '-p') && argv[i + 1]) options.port = Number(argv[++i]);
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice(7));
    else if ((arg === '--host' || arg === '-H') && argv[i + 1]) options.host = argv[++i];
    else if (arg.startsWith('--host=')) options.host = arg.slice(7);
    else if (arg === '--open' || arg === '-o') options.open = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('serve-site — serve the chan_code landing page\n\nUsage: node scripts/serve-site.js [--port 8080] [--host 127.0.0.1] [--open]');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(options.port) || options.port < 0 || options.port > 65535) {
    console.error('invalid --port');
    process.exit(2);
  }
  return options;
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* ignore */
  }
}

function sendFile(res, filePath, status = 200) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(status, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': CSP,
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const options = parseArgs(process.argv.slice(2));

if (!fs.existsSync(path.join(siteDir, 'index.html'))) {
  console.error(`landing page not found: ${path.join(siteDir, 'index.html')}`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end('bad request');
    return;
  }

  if (pathname === '/' || pathname === '/index.html' || pathname === '/about') {
    sendFile(res, path.join(siteDir, 'index.html'));
    return;
  }

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  const targets = [path.join(siteDir, pathname), path.join(siteDir, `${pathname}.html`)];
  for (const target of targets) {
    const resolved = path.resolve(target);
    if (resolved !== siteDir && !resolved.startsWith(`${siteDir}${path.sep}`)) break;
    if (sendFile(res, resolved)) return;
  }

  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>404</h1><p>Not found. <a href="/">Back to chan_code</a></p>');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`port ${options.port} is already in use. Try: node scripts/serve-site.js --port 8787`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

server.listen(options.port, options.host, () => {
  const address = server.address();
  const url = `http://${options.host === '0.0.0.0' ? '127.0.0.1' : options.host}:${address.port}`;
  console.log('chan_code landing page');
  console.log(`  url:   ${url}`);
  console.log(`  file:  ${path.join(siteDir, 'index.html')}`);
  console.log('  press Ctrl+C to stop');
  if (options.open) openBrowser(url);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
