import path from 'node:path';
import { HttpMcpClient, StdioMcpClient } from './client.js';

function expandEnv(value) {
  if (typeof value === 'string') {
    return value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => process.env[name] ?? '');
  }
  if (Array.isArray(value)) return value.map((item) => expandEnv(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = expandEnv(item);
    return out;
  }
  return value;
}

export function normalizeMcpName(value) {
  const normalized = String(value || '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /[A-Za-z0-9]/.test(normalized) ? normalized : 'mcp';
}

function formatResult(result) {
  if (!result || !Array.isArray(result.content)) {
    return JSON.stringify(result ?? {}, null, 2);
  }
  const parts = [];
  for (const block of result.content) {
    if (block.type === 'text') {
      if (block.text) parts.push(block.text);
    } else if (block.type === 'image') {
      parts.push(`[image ${block.mimeType || 'unknown'} omitted]`);
    } else if (block.type === 'resource') {
      const resource = block.resource || {};
      parts.push(resource.text ? `[resource ${resource.uri || ''}]\n${resource.text}` : `[resource ${resource.uri || ''}]`);
    } else if (block.type === 'resource_link') {
      parts.push(`[resource_link ${block.uri || ''}]`);
    } else {
      parts.push(JSON.stringify(block));
    }
  }
  return parts.join('\n') || '(empty MCP result)';
}

export class McpManager {
  constructor({ config = {}, cwd = process.cwd(), logger = null } = {}) {
    this.config = config;
    this.cwd = cwd;
    this.logger = logger;
    this.servers = config.mcp?.servers || {};
    this.timeoutMs = Number(config.mcp?.timeoutMs) || 30000;
    this.clients = new Map();
    this.statuses = new Map();
    this.toolMap = new Map();
    this.readyPromise = null;
  }

  serverEntries() {
    const entries = [];
    for (const [name, raw] of Object.entries(this.servers || {})) {
      if (!raw || raw.disabled) continue;
      const def = expandEnv(raw);
      let type = def.type;
      if (!type) type = def.url ? 'remote' : 'local';
      if (type === 'local' || def.command) {
        if (!Array.isArray(def.command) || !def.command.length) {
          entries.push({ name, type: 'local', error: 'missing command array' });
          continue;
        }
        entries.push({
          name,
          type: 'local',
          client: new StdioMcpClient({
            name,
            command: def.command,
            cwd: def.cwd ? path.resolve(this.cwd, def.cwd) : this.cwd,
            environment: def.environment || def.env || {},
            timeoutMs: this.timeoutMs,
          }),
        });
      } else if (type === 'remote') {
        if (!def.url) {
          entries.push({ name, type: 'remote', error: 'missing url' });
          continue;
        }
        entries.push({
          name,
          type: 'remote',
          client: new HttpMcpClient({
            name,
            url: def.url,
            headers: def.headers || {},
            timeoutMs: this.timeoutMs,
          }),
        });
      } else {
        entries.push({ name, type, error: `unsupported MCP type "${type}"` });
      }
    }
    return entries;
  }

  async init() {
    const entries = this.serverEntries();
    if (!entries.length) return this.statusesList();
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.error) {
          this.statuses.set(entry.name, { name: entry.name, type: entry.type, connected: false, error: entry.error, tools: [] });
          this.logger?.(`mcp "${entry.name}" skipped: ${entry.error}`);
          return;
        }
        try {
          await entry.client.start();
          await entry.client.initialize();
          const tools = await entry.client.listTools();
          this.clients.set(entry.name, entry.client);
          this.statuses.set(entry.name, {
            name: entry.name,
            type: entry.type,
            connected: true,
            error: null,
            tools: tools.map((tool) => tool.name),
          });
          for (const tool of tools) {
            const exposedName = `${normalizeMcpName(entry.name)}_${normalizeMcpName(tool.name)}`;
            this.toolMap.set(exposedName, {
              name: exposedName,
              description: `[MCP ${entry.name}] ${tool.description || tool.name}`,
              parameters: tool.inputSchema || { type: 'object', properties: {} },
              run: async (args, ctx = {}) => {
                const result = await entry.client.callTool(tool.name, args, { signal: ctx.signal });
                const text = formatResult(result);
                if (result?.isError) throw new Error(text);
                return text;
              },
            });
          }
        } catch (err) {
          this.statuses.set(entry.name, { name: entry.name, type: entry.type, connected: false, error: err.message, tools: [] });
          this.logger?.(`mcp "${entry.name}" failed: ${err.message}`);
          try {
            entry.client.close();
          } catch {
            /* ignore */
          }
        }
      }),
    );
    return this.statusesList();
  }

  ensureReady() {
    if (!this.readyPromise) this.readyPromise = this.init();
    return this.readyPromise;
  }

  async ready() {
    await this.ensureReady();
    return this;
  }

  tools() {
    return [...this.toolMap.values()];
  }

  statusesList() {
    return [...this.statuses.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async refresh() {
    await this.close();
    this.clients.clear();
    this.statuses.clear();
    this.toolMap.clear();
    this.readyPromise = null;
    return this.ensureReady();
  }

  async close() {
    for (const client of this.clients.values()) {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }
}

export function createMcpManager(options) {
  return new McpManager(options);
}
