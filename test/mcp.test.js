import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createMcpManager, normalizeMcpName } from '../src/mcp/manager.js';

const fixture = fileURLToPath(new URL('../fixtures/mcp-fake-server.mjs', import.meta.url));

test('normalizeMcpName produces stable tool prefixes', () => {
  assert.equal(normalizeMcpName('context 7'), 'context_7');
  assert.equal(normalizeMcpName('resolve.library/id'), 'resolve_library_id');
  assert.equal(normalizeMcpName('--'), 'mcp');
});

test('local MCP servers expose tools and return results', async () => {
  const manager = createMcpManager({
    cwd: process.cwd(),
    config: {
      mcp: {
        timeoutMs: 15000,
        servers: {
          fake: { type: 'local', command: [process.execPath, fixture] },
        },
      },
    },
  });
  try {
    const statuses = await manager.init();
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].connected, true);
    assert.deepEqual(statuses[0].tools.sort(), ['echo', 'fail']);

    const tools = manager.tools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ['fake_echo', 'fake_fail']);

    const echo = tools.find((tool) => tool.name === 'fake_echo');
    assert.equal(await echo.run({ text: 'hello' }, {}), 'echo:hello');

    const failing = tools.find((tool) => tool.name === 'fake_fail');
    await assert.rejects(failing.run({}, {}), /boom/);
  } finally {
    await manager.close();
  }
});

test('failed MCP servers are reported without breaking the manager', async () => {
  const manager = createMcpManager({
    cwd: process.cwd(),
    config: {
      mcp: {
        timeoutMs: 5000,
        servers: {
          broken: { type: 'local', command: [process.execPath, path.join(process.cwd(), 'does-not-exist.mjs')] },
          invalid: { type: 'remote' },
        },
      },
    },
  });
  try {
    const statuses = await manager.init();
    assert.equal(statuses.length, 2);
    for (const status of statuses) assert.equal(status.connected, false);
    assert.match(statuses.find((status) => status.name === 'invalid').error, /missing url/);
    assert.equal(manager.tools().length, 0);
  } finally {
    await manager.close();
  }
});

test('remote MCP servers work over JSON and SSE responses', async (t) => {
  const seenSessions = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    seenSessions.push(req.headers['mcp-session-id'] || null);
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    if (message.method === 'initialize') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'session-123' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'remote-fake' } } }));
      return;
    }
    if (message.method === 'tools/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } }] } }));
      return;
    }
    if (message.method === 'tools/call') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: message\n');
      res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'pong' }] } })}\n\n`);
      res.end();
      return;
    }
    res.writeHead(202);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const manager = createMcpManager({
    cwd: process.cwd(),
    config: {
      mcp: {
        timeoutMs: 10000,
        servers: { remote: { type: 'remote', url: `http://127.0.0.1:${port}/mcp` } },
      },
    },
  });
  try {
    const statuses = await manager.init();
    assert.equal(statuses[0].connected, true);
    const tool = manager.tools().find((item) => item.name === 'remote_ping');
    assert.ok(tool);
    assert.equal(await tool.run({}, {}), 'pong');
    assert.ok(seenSessions.includes('session-123'));
  } finally {
    await manager.close();
  }
});
