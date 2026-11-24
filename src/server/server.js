import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runAgent } from '../agent.js';
import { loadAgents } from '../agents.js';
import { expandCommand, loadCommands } from '../commands.js';
import { deepMerge, listProviders, loadConfig, redactConfig, saveConfig } from '../config.js';
import { createMcpManager } from '../mcp/index.js';
import { createProvider } from '../providers/index.js';
import { createRuntime } from '../runtime.js';
import { SessionStore } from '../sessions.js';
import { loadSkills } from '../skills.js';
import { createTools } from '../tools/index.js';
import { sanitizeFilename } from '../util/paths.js';
import { titleFromPrompt } from '../util/text.js';
import { version } from '../version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, 'web');
const SITE_DIR = path.resolve(__dirname, '..', '..', 'site');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const MAX_BODY = 30 * 1024 * 1024;
const MAX_UPLOAD = 12 * 1024 * 1024;
const ALLOWED_UPLOAD_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf', '.txt', '.md', '.json', '.csv', '.log',
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h', '.html', '.css', '.yml', '.yaml', '.toml',
]);

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req, limit = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error(`request body too large (limit ${limit} bytes)`);
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const err = new Error('invalid JSON body');
    err.statusCode = 400;
    throw err;
  }
}

function isLocalAddress(address) {
  if (!address) return false;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function serveFile(res, filePath, { csp } = {}) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  };
  if (csp) headers['Content-Security-Policy'] = csp;
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/s.exec(String(dataUrl || ''));
  if (!match) return null;
  return { mediaType: match[1] || 'application/octet-stream', base64: match[2] };
}

export class ChanServer {
  constructor({ cwd = process.cwd(), config = null, providerFactory = createProvider, mcpManager = null } = {}) {
    this.cwd = path.resolve(cwd);
    this.config = config || loadConfig({ cwd: this.cwd });
    this.providerFactory = providerFactory;
    this.mcpManager = mcpManager;
    this.mcpInit = null;
    this.store = new SessionStore({ cwd: this.cwd });
    this.sessions = new Map();
    this.inFlight = new Set();
    this.pendingApprovals = new Map();
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        if (!res.headersSent) json(res, err.statusCode || 500, { error: err.message });
        else res.end();
      });
    });
  }

  get token() {
    return this.config.server?.token || process.env.CHAN_SERVER_TOKEN || '';
  }

  isAuthorized(req, url) {
    const token = this.token;
    if (!token) return isLocalAddress(req.socket.remoteAddress);
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (bearer && bearer === token) return true;
    const queryToken = url.searchParams.get('token');
    return Boolean(queryToken && queryToken === token);
  }

  getSession(id) {
    if (this.sessions.has(id)) return this.sessions.get(id);
    const loaded = this.store.get(id);
    if (loaded) this.sessions.set(id, loaded);
    return loaded || null;
  }

  ensureMcp() {
    if (!this.mcpManager) {
      this.mcpManager = createMcpManager({
        config: this.config,
        cwd: this.cwd,
        logger: process.env.CHAN_DEBUG ? (message) => console.error(`[mcp] ${message}`) : null,
      });
    }
    if (!this.mcpInit) this.mcpInit = this.mcpManager.ready();
    return this.mcpInit;
  }

  async resetMcp() {
    if (this.mcpManager) await this.mcpManager.close().catch(() => {});
    this.mcpManager = null;
    this.mcpInit = null;
  }

  requestCwd(url, body = null) {
    const candidate = body?.cwd || url.searchParams.get('cwd');
    if (candidate && fs.existsSync(String(candidate))) {
      const resolved = path.resolve(String(candidate));
      if (fs.statSync(resolved).isDirectory()) return resolved;
    }
    return this.cwd;
  }

  persist(session) {
    if (!session) return;
    try {
      this.store.save(session);
    } catch (err) {
      if (process.env.CHAN_DEBUG) console.error('failed to save session:', err.message);
    }
  }

  saveUpload(cwd, { name, dataUrl }) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) throw Object.assign(new Error('invalid data URL'), { statusCode: 400 });
    const buffer = Buffer.from(parsed.base64, 'base64');
    if (buffer.length > MAX_UPLOAD) {
      throw Object.assign(new Error(`file too large (limit ${MAX_UPLOAD} bytes)`), { statusCode: 413 });
    }
    const original = sanitizeFilename(name || 'upload');
    const ext = path.extname(original).toLowerCase();
    if (ext && !ALLOWED_UPLOAD_EXT.has(ext)) {
      throw Object.assign(new Error(`file type ${ext} is not allowed`), { statusCode: 400 });
    }
    const dir = path.join(cwd, '.chan', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}-${original}`;
    fs.writeFileSync(path.join(dir, filename), buffer);
    const relative = path.posix.join('.chan', 'uploads', filename);
    return { path: relative, absolute: path.join(dir, filename), size: buffer.length, mediaType: parsed.mediaType, name: original };
  }

  async handle(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) {
      if (!this.isAuthorized(req, url)) {
        return json(res, 401, { error: 'unauthorized: provide the server token (Authorization: Bearer ...)' });
      }
      return this.handleApi(req, res, url, pathname);
    }

    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }

    if (pathname === '/' || pathname === '/index.html' || pathname === '/app') {
      const ok = serveFile(res, path.join(WEB_DIR, 'index.html'), {
        csp: "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
      });
      if (!ok) json(res, 500, { error: 'web UI is missing' });
      return;
    }

    if (pathname === '/assets/app.js' || pathname === '/assets/style.css') {
      return void serveFile(res, path.join(WEB_DIR, path.basename(pathname)));
    }

    if (pathname === '/about' || pathname === '/about/' || pathname === '/site') {
      const ok = serveFile(res, path.join(SITE_DIR, 'index.html'), {
        csp: "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
      });
      if (!ok) json(res, 404, { error: 'landing page not found' });
      return;
    }

    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }

    json(res, 404, { error: `not found: ${pathname}` });
  }

  async handleApi(req, res, url, pathname) {
    const method = req.method || 'GET';

    if (pathname === '/api/health' && method === 'GET') {
      return json(res, 200, {
        ok: true,
        name: 'chan_code',
        version,
        cwd: this.cwd,
        provider: this.config.defaultProvider,
        providers: Object.keys(this.config.providers || {}),
        platform: process.platform,
        node: process.version,
      });
    }

    if (pathname === '/api/config' && method === 'GET') {
      return json(res, 200, {
        config: redactConfig(this.config),
        providers: listProviders(this.config),
        defaultProvider: this.config.defaultProvider,
      });
    }

    if (pathname === '/api/config' && method === 'PUT') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object') throw Object.assign(new Error('config must be an object'), { statusCode: 400 });
      this.config = deepMerge(this.config, body);
      saveConfig(this.config);
      await this.resetMcp();
      return json(res, 200, { ok: true, config: redactConfig(this.config) });
    }

    if (pathname === '/api/models' && method === 'GET') {
      return json(res, 200, { defaultProvider: this.config.defaultProvider, providers: listProviders(this.config) });
    }

    if (pathname === '/api/tools' && method === 'GET') {
      return json(res, 200, { tools: createTools({ cwd: this.cwd }).map(({ name, description, parameters }) => ({ name, description, parameters })) });
    }

    if (pathname === '/api/mcp' && method === 'GET') {
      await this.ensureMcp();
      return json(res, 200, { servers: this.mcpManager.statusesList(), tools: this.mcpManager.tools().map(({ name, description }) => ({ name, description })) });
    }

    if (pathname === '/api/mcp/refresh' && method === 'POST') {
      await this.ensureMcp();
      const servers = await this.mcpManager.refresh();
      return json(res, 200, { servers, tools: this.mcpManager.tools().map(({ name, description }) => ({ name, description })) });
    }

    if (pathname === '/api/skills' && method === 'GET') {
      const cwd = this.requestCwd(url);
      const skills = loadSkills({ cwd, config: this.config }).map(({ body, ...skill }) => ({ ...skill, bytes: body.length }));
      return json(res, 200, { cwd, skills });
    }

    if (pathname === '/api/commands' && method === 'GET') {
      const cwd = this.requestCwd(url);
      const commands = loadCommands({ cwd, config: this.config });
      return json(res, 200, { cwd, commands });
    }

    if (pathname === '/api/agents' && method === 'GET') {
      const cwd = this.requestCwd(url);
      const agents = [...loadAgents({ cwd, config: this.config }).values()].map(({ system, ...agent }) => agent);
      return json(res, 200, { cwd, agents, defaultAgent: this.config.agent.defaultAgent || 'build' });
    }

    if (pathname === '/api/sessions' && method === 'GET') {
      return json(res, 200, { sessions: this.store.list() });
    }

    if (pathname === '/api/sessions' && method === 'POST') {
      const body = await readBody(req);
      let sessionCwd = body.cwd ? path.resolve(String(body.cwd)) : this.cwd;
      if (!fs.existsSync(sessionCwd) || !fs.statSync(sessionCwd).isDirectory()) {
        throw Object.assign(new Error(`working directory not found: ${sessionCwd}`), { statusCode: 400 });
      }
      const session = this.store.create({
        cwd: sessionCwd,
        provider: body.provider || this.config.defaultProvider,
        model: body.model || null,
        approval: body.approval || this.config.agent.approval,
        agent: body.agent || this.config.agent.defaultAgent || 'build',
      });
      this.sessions.set(session.id, session);
      return json(res, 201, { session });
    }

    const sessionMatch = /^\/api\/sessions\/([a-zA-Z0-9_-]+)(\/[a-z]+)?$/.exec(pathname);
    if (sessionMatch) {
      const session = this.getSession(sessionMatch[1]);
      if (!session) return json(res, 404, { error: 'session not found' });
      const sub = sessionMatch[2] || '';

      if (!sub && method === 'GET') return json(res, 200, { session });

      if (!sub && method === 'DELETE') {
        this.sessions.delete(session.id);
        this.store.delete(session.id);
        return json(res, 200, { ok: true });
      }

      if (!sub && method === 'PATCH') {
        const body = await readBody(req);
        if (typeof body.title === 'string' && body.title.trim()) session.title = body.title.trim().slice(0, 200);
        if (typeof body.provider === 'string' && body.provider.trim()) session.provider = body.provider.trim();
        if (typeof body.model === 'string' && body.model.trim()) session.model = body.model.trim();
        if (typeof body.approval === 'string' && ['auto', 'ask', 'deny'].includes(body.approval)) session.approval = body.approval;
        if (typeof body.agent === 'string' && body.agent.trim()) session.agent = body.agent.trim();
        this.persist(session);
        return json(res, 200, { ok: true, session });
      }

      if (sub === '/chat' && method === 'POST') {
        return this.handleChat(req, res, session);
      }

      return json(res, 404, { error: `unknown session action ${sub}` });
    }

    if (pathname === '/api/upload' && method === 'POST') {
      const body = await readBody(req);
      const sessionCwd = body.cwd && fs.existsSync(String(body.cwd)) ? path.resolve(String(body.cwd)) : this.cwd;
      const saved = this.saveUpload(sessionCwd, body);
      return json(res, 200, saved);
    }

    if (pathname === '/api/approve' && method === 'POST') {
      const body = await readBody(req);
      const pending = this.pendingApprovals.get(body.callId);
      if (!pending) return json(res, 404, { error: 'approval request not found or expired' });
      this.pendingApprovals.delete(body.callId);
      pending.resolve({ approved: Boolean(body.approved) });
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: `not found: ${pathname}` });
  }

  async handleChat(req, res, session) {
    if (this.inFlight.has(session.id)) {
      return json(res, 409, { error: 'this session is already processing a message' });
    }
    const body = await readBody(req);
    let text = typeof body.message === 'string' ? body.message.trim() : '';
    const images = Array.isArray(body.images) ? body.images : [];
    if (text.length > 200000) {
      return json(res, 400, { error: 'message too long' });
    }

    let commandMeta = null;
    if (text.startsWith('/')) {
      const name = text.slice(1).split(/\s+/)[0].toLowerCase();
      const command = loadCommands({ cwd: session.cwd, config: this.config }).find((item) => item.name.toLowerCase() === name);
      if (command) {
        commandMeta = command;
        text = await expandCommand(command, text.slice(1 + name.length).trim(), { cwd: session.cwd });
      }
    }
    if (!text && !images.length) {
      return json(res, 400, { error: 'message or images are required' });
    }

    let providerName = body.provider || session.provider || this.config.defaultProvider;
    let modelOverride = body.model ? String(body.model) : commandMeta?.model || null;
    if (modelOverride && modelOverride.includes('/')) {
      const slash = modelOverride.indexOf('/');
      const prefix = modelOverride.slice(0, slash);
      if (this.config.providers?.[prefix]) {
        providerName = prefix;
        modelOverride = modelOverride.slice(slash + 1);
      }
    }

    let providerConfig = this.config;
    if (modelOverride) {
      providerConfig = structuredClone(this.config);
      providerConfig.providers[providerName] = {
        ...(providerConfig.providers[providerName] || {}),
        model: modelOverride,
      };
    }

    let provider;
    try {
      provider = this.providerFactory(providerConfig, providerName);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }

    const agentName = body.agent || commandMeta?.agent || session.agent || this.config.agent.defaultAgent || 'build';

    this.inFlight.add(session.id);
    const abort = new AbortController();
    let closed = false;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const send = (type, data) => {
      if (closed || res.writableEnded) return;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    res.on('close', () => {
      if (!res.writableEnded) {
        closed = true;
        abort.abort();
        for (const [callId, pending] of this.pendingApprovals) {
          if (pending.sessionId !== session.id) continue;
          this.pendingApprovals.delete(callId);
          pending.resolve({ approved: false, reason: 'client disconnected' });
        }
      }
    });

    const approvalMode = session.approval || this.config.agent.approval || 'auto';
    const approve = async (request) => {
      if (approvalMode === 'deny') return { approved: false, reason: 'approval mode is deny' };
      if (approvalMode === 'auto' && !request.requiresConfirmation) return { approved: true };
      const callId = crypto.randomUUID();
      send('approval-request', { callId, ...request });
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.pendingApprovals.delete(callId);
          resolve({ approved: false, reason: 'approval timed out' });
        }, 300000);
        this.pendingApprovals.set(callId, {
          sessionId: session.id,
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
        });
      });
    };

    session.provider = providerName;
    session.model = modelOverride || provider.model;
    if (body.agent) session.agent = agentName;
    else if (!session.agent) session.agent = agentName;

    const normalizedImages = [];
    for (const image of images.slice(0, 8)) {
      try {
        const saved = this.saveUpload(session.cwd, {
          name: image.name || 'image.png',
          dataUrl: image.dataUrl,
        });
        normalizedImages.push({
          name: saved.name,
          mediaType: image.mediaType || saved.mediaType,
          dataUrl: image.dataUrl,
          path: saved.path,
        });
      } catch (err) {
        send('warning', { message: `skipped attachment: ${err.message}` });
      }
    }

    const userMessage = { role: 'user', content: text };
    if (normalizedImages.length) userMessage.images = normalizedImages;
    session.messages.push(userMessage);
    if (session.title === 'New session' || !session.title) session.title = titleFromPrompt(text || normalizedImages[0]?.name || 'Images');
    this.persist(session);

    send('ready', {
      sessionId: session.id,
      title: session.title,
      provider: providerName,
      model: session.model,
      agent: agentName,
      approval: approvalMode,
      command: commandMeta?.name || null,
    });

    try {
      await this.ensureMcp();
      for (const status of this.mcpManager.statusesList()) {
        if (!status.connected) send('warning', { message: `MCP server "${status.name}" failed: ${status.error}` });
      }
      const runtime = await createRuntime({
        cwd: session.cwd,
        config: this.config,
        session,
        provider,
        providerName,
        approvalMode,
        approve,
        signal: abort.signal,
        mcpManager: this.mcpManager,
        agentName,
      });

      if (commandMeta?.subagent && runtime.runSubagent) {
        const output = await runtime.runSubagent({
          agent: commandMeta.agent || 'general',
          prompt: text,
          model: commandMeta.model || undefined,
        });
        const message = { role: 'assistant', content: output };
        session.messages.push(message);
        send('text-delta', { type: 'text-delta', text: output });
        send('assistant', { type: 'assistant', message, step: 1, usage: null, totalUsage: session.usage || {} });
      } else {
        const stream = runAgent({
          provider,
          messages: session.messages,
          system: runtime.system,
          tools: runtime.tools,
          maxSteps: body.maxSteps || this.config.agent.maxSteps,
          temperature: this.config.agent.temperature,
          signal: abort.signal,
          session,
          maxOutputChars: this.config.agent.maxOutputChars,
        });
        for await (const event of stream) {
          send(event.type, event);
          if (['assistant', 'tool-result', 'warning', 'done'].includes(event.type)) this.persist(session);
        }
      }
      this.persist(session);
      send('session', { session: this.publicSession(session) });
      send('end', { sessionId: session.id, usage: session.usage });
    } catch (err) {
      if (err.name === 'AbortError') {
        send('aborted', { message: 'generation aborted' });
      } else {
        send('error', { message: err.message });
      }
      this.persist(session);
    } finally {
      this.inFlight.delete(session.id);
      closed = true;
      if (!res.writableEnded) res.end();
    }
  }

  publicSession(session) {
    return session;
  }

  listen({ port = 4731, host = '127.0.0.1' } = {}) {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.removeListener('error', reject);
        const address = this.server.address();
        resolve({
          port: address.port,
          host,
          url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}`,
        });
      });
    });
  }

  async close() {
    for (const pending of this.pendingApprovals.values()) pending.resolve({ approved: false, reason: 'server closing' });
    this.pendingApprovals.clear();
    if (this.mcpManager) await this.mcpManager.close().catch(() => {});
    await new Promise((resolve) => this.server.close(resolve));
  }
}

export function createServer(options) {
  return new ChanServer(options);
}

export async function startServer({
  cwd = process.cwd(),
  config = null,
  port,
  host,
  open = false,
  providerFactory,
} = {}) {
  const resolvedConfig = config || loadConfig({ cwd });
  const server = new ChanServer({ cwd, config: resolvedConfig, providerFactory });
  const targetPort = port ?? resolvedConfig.server?.port ?? 4731;
  const targetHost = host ?? resolvedConfig.server?.host ?? '127.0.0.1';

  if (!server.token && targetHost !== '127.0.0.1' && targetHost !== 'localhost' && targetHost !== '::1') {
    throw new Error('refusing to listen on a non-local host without a server token. Set server.token (or CHAN_SERVER_TOKEN) first.');
  }

  const info = await server.listen({ port: targetPort, host: targetHost });
  const lan = targetHost === '0.0.0.0' ? getLanAddresses(info.port) : [];
  if (open) openBrowser(info.url);
  return { ...info, server, lan };
}

export function getLanAddresses(port) {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) addresses.push(`http://${iface.address}:${port}`);
    }
  }
  return addresses;
}

export function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* ignore */
  }
}

export { WEB_DIR, SITE_DIR };
