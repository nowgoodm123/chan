import { spawn } from 'node:child_process';
import { iterateSSE } from '../util/sse.js';
import { mergeSignals } from '../util/http.js';
import { version } from '../version.js';

const PROTOCOL_VERSION = '2024-11-05';

class PendingRequests {
  constructor() {
    this.map = new Map();
    this.nextId = 1;
  }

  create(method, timeoutMs, signal) {
    const id = this.nextId++;
    let timer = null;
    let cleanup = null;
    const promise = new Promise((resolve, reject) => {
      const onAbort = () => {
        this.map.delete(id);
        reject(Object.assign(new Error(`MCP request aborted: ${method}`), { name: 'AbortError' }));
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        this.map.delete(id);
        signal?.removeEventListener('abort', onAbort);
        reject(new Error(`MCP request timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      this.map.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
    });
    return { id, promise };
  }

  settle(message) {
    const pending = this.map.get(message.id);
    if (!pending) return false;
    this.map.delete(message.id);
    if (message.error) {
      const error = new Error(message.error.message || 'MCP error');
      error.code = message.error.code;
      error.data = message.error.data;
      pending.reject(error);
    } else {
      pending.resolve(message.result);
    }
    return true;
  }

  failAll(error) {
    for (const pending of [...this.map.values()]) pending.reject(error);
    this.map.clear();
  }
}

export class StdioMcpClient {
  constructor({ name, command, cwd, environment, timeoutMs = 30000 }) {
    this.name = name;
    this.command = command;
    this.cwd = cwd;
    this.environment = environment || {};
    this.timeoutMs = timeoutMs;
    this.pending = new PendingRequests();
    this.child = null;
    this.buffer = '';
    this.stderr = '';
    this.closed = false;
    this.initialized = false;
  }

  async start() {
    if (this.child) return;
    const [file, ...args] = this.command;
    if (!file) throw new Error(`MCP server "${this.name}" has an empty command`);
    this.child = spawn(file, args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.onData(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      if (this.stderr.length < 8000) this.stderr += chunk;
    });
    this.child.once('error', (err) => this.pending.failAll(new Error(`MCP server "${this.name}" failed: ${err.message}`)));
    this.child.once('exit', (code) => {
      this.closed = true;
      const detail = this.stderr.trim() ? `: ${this.stderr.trim().slice(-500)}` : '';
      this.pending.failAll(new Error(`MCP server "${this.name}" exited with code ${code}${detail}`));
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id != null && this.pending.settle(message)) continue;
      if (message.method && message.id != null) {
        this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not supported by chan_code' } });
      }
    }
  }

  write(message) {
    if (!this.child || this.closed || !this.child.stdin.writable) {
      throw new Error(`MCP server "${this.name}" is not writable`);
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async request(method, params = {}, { signal } = {}) {
    if (!this.child) await this.start();
    const { id, promise } = this.pending.create(method, this.timeoutMs, signal);
    this.write({ jsonrpc: '2.0', id, method, params });
    return promise;
  }

  notify(method, params = {}) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'chan_code', version },
    });
    this.notify('notifications/initialized', {});
    this.initialized = true;
    return result;
  }

  async listTools({ signal } = {}) {
    const result = await this.request('tools/list', {}, { signal });
    return result?.tools || [];
  }

  async callTool(name, args, { signal } = {}) {
    return this.request('tools/call', { name, arguments: args || {} }, { signal });
  }

  close() {
    this.closed = true;
    this.pending.failAll(new Error(`MCP server "${this.name}" closed`));
    try {
      this.child?.kill();
    } catch {
      /* ignore */
    }
  }
}

export class HttpMcpClient {
  constructor({ name, url, headers = {}, timeoutMs = 30000 }) {
    this.name = name;
    this.url = url;
    this.headers = headers;
    this.timeoutMs = timeoutMs;
    this.pending = new PendingRequests();
    this.sessionId = null;
    this.initialized = false;
  }

  async start() {}

  baseHeaders() {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': `chan-code/${version}`,
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      ...this.headers,
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
    };
  }

  async post(body, { expectResponse = true, signal } = {}) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = mergeSignals([signal, timeout]);
    const response = await fetch(this.url, {
      method: 'POST',
      headers: this.baseHeaders(),
      body: JSON.stringify(body),
      signal: combined,
    });
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) this.sessionId = sessionId;
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`MCP server "${this.name}" HTTP ${response.status}${detail ? `: ${detail.replace(/\s+/g, ' ').slice(0, 400)}` : ''}`);
    }
    if (!expectResponse || response.status === 202 || response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      let found = null;
      const controller = new AbortController();
      try {
        for await (const raw of iterateSSE(response.body)) {
          let message;
          try {
            message = JSON.parse(raw);
          } catch {
            continue;
          }
          if (message.id != null && message.id === body.id) {
            found = message;
            controller.abort();
            break;
          }
        }
      } catch (err) {
        if (!found && err.name !== 'AbortError') throw err;
      }
      if (!found) throw new Error(`MCP server "${this.name}" returned an empty event stream`);
      if (found.error) throw new Error(found.error.message || 'MCP error');
      return found.result;
    }
    const text = await response.text();
    if (!text.trim()) return null;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      throw new Error(`MCP server "${this.name}" returned invalid JSON`);
    }
    if (message.error) throw new Error(message.error.message || 'MCP error');
    return message.result;
  }

  async request(method, params = {}, { signal } = {}) {
    const id = this.pending.nextId++;
    return this.post({ jsonrpc: '2.0', id, method, params }, { signal });
  }

  async notify(method, params = {}) {
    await this.post({ jsonrpc: '2.0', method, params }, { expectResponse: false });
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'chan_code', version },
    });
    await this.notify('notifications/initialized', {});
    this.initialized = true;
    return result;
  }

  async listTools({ signal } = {}) {
    const result = await this.request('tools/list', {}, { signal });
    return result?.tools || [];
  }

  async callTool(name, args, { signal } = {}) {
    return this.request('tools/call', { name, arguments: args || {} }, { signal });
  }

  close() {}
}
