import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.CHAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'chan-server-home-'));
const mcpFixture = fileURLToPath(new URL('../fixtures/mcp-fake-server.mjs', import.meta.url));

const { ChanServer } = await import('../src/server/server.js');
const { DEFAULT_CONFIG } = await import('../src/config.js');

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chan-server-'));

function fakeProvider(reply = 'Hello from fake') {
  return {
    name: 'fake',
    model: 'fake-1',
    type: 'openai',
    async *stream({ messages }) {
      const last = messages[messages.length - 1];
      yield { type: 'text-delta', text: `${reply} (${last.role})` };
      yield { type: 'done', stopReason: 'stop', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } };
    },
  };
}

function toolProvider(command, reply = 'tool finished') {
  return {
    name: 'fake',
    model: 'fake-1',
    type: 'openai',
    async *stream({ messages }) {
      const hasToolResult = messages.some((message) => message.role === 'tool');
      if (!hasToolResult) {
        yield { type: 'text-delta', text: 'I need to run a command.' };
        yield { type: 'tool-call', id: 'call_bash', name: 'bash', arguments: JSON.stringify({ command }) };
        yield { type: 'done', stopReason: 'tool_calls' };
      } else {
        yield { type: 'text-delta', text: reply };
        yield { type: 'done', stopReason: 'stop' };
      }
    },
  };
}

async function withServer(t, { config = structuredClone(DEFAULT_CONFIG), provider = fakeProvider() } = {}) {
  const server = new ChanServer({
    cwd,
    config,
    providerFactory: () => provider,
  });
  const info = await server.listen({ port: 0, host: '127.0.0.1' });
  t.after(() => server.close());
  return { server, base: info.url };
}

async function postChat(base, sessionId, body) {
  const res = await fetch(`${base}/api/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { res, text };
}

test('health, config and tools endpoints respond', async (t) => {
  const { base } = await withServer(t);
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.name, 'chan_code');
  assert.equal(health.cwd, cwd);

  const config = await (await fetch(`${base}/api/config`)).json();
  assert.ok(config.providers.find((p) => p.name === 'deepseek'));
  assert.equal(config.config.server.token, '');

  const tools = await (await fetch(`${base}/api/tools`)).json();
  assert.ok(tools.tools.find((tool) => tool.name === 'bash'));

  const missing = await fetch(`${base}/api/nope`);
  assert.equal(missing.status, 404);
});

test('sessions can be created, listed, patched and deleted', async (t) => {
  const { base } = await withServer(t);
  const created = await (
    await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'fake' }),
    })
  ).json();
  const id = created.session.id;
  assert.ok(id);

  const list = await (await fetch(`${base}/api/sessions`)).json();
  assert.ok(list.sessions.find((session) => session.id === id));

  const patched = await (
    await fetch(`${base}/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed', approval: 'ask' }),
    })
  ).json();
  assert.equal(patched.session.title, 'Renamed');
  assert.equal(patched.session.approval, 'ask');

  const deleted = await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  const gone = await fetch(`${base}/api/sessions/${id}`);
  assert.equal(gone.status, 404);
});

test('chat streams SSE events and persists the conversation', async (t) => {
  const { base } = await withServer(t);
  const created = await (
    await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
  ).json();
  const id = created.session.id;

  const { res, text } = await postChat(base, id, { message: 'Say hello' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
  assert.match(text, /event: ready/);
  assert.match(text, /event: text-delta/);
  assert.match(text, /Hello from fake \(user\)/);
  assert.match(text, /event: done/);
  assert.match(text, /event: end/);

  const { session } = await (await fetch(`${base}/api/sessions/${id}`)).json();
  assert.equal(session.messages.length, 2);
  assert.equal(session.messages[0].role, 'user');
  assert.equal(session.messages[1].role, 'assistant');
  assert.equal(session.title, 'Say hello');
  assert.equal(session.usage.totalTokens, 5);
});

test('chat validates input and rejects unknown sessions', async (t) => {
  const { base } = await withServer(t);
  const unknown = await postChat(base, 'doesnotexist', { message: 'hi' });
  assert.equal(unknown.res.status, 404);

  const created = await (
    await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  ).json();
  const empty = await postChat(base, created.session.id, { message: '   ' });
  assert.equal(empty.res.status, 400);
});

test('upload writes files into the workspace and rejects bad types', async (t) => {
  const { base } = await withServer(t);
  const dataUrl = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;
  const res = await fetch(`${base}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'shot.png', dataUrl }),
  });
  const saved = await res.json();
  assert.equal(res.status, 200);
  assert.match(saved.path, /^\.chan\/uploads\//);
  assert.ok(fs.existsSync(path.join(cwd, saved.path)));

  const bad = await fetch(`${base}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'evil.exe', dataUrl: `data:application/octet-stream;base64,${Buffer.from('x').toString('base64')}` }),
  });
  assert.equal(bad.status, 400);
});

test('web app, assets and landing page are served', async (t) => {
  const { base } = await withServer(t);
  const html = await fetch(`${base}/`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /chan_code/);
  assert.match(html.headers.get('content-security-policy') || '', /default-src/);

  const script = await fetch(`${base}/assets/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') || '', /javascript/);
  await script.text();

  const about = await fetch(`${base}/about`);
  assert.equal(about.status, 200);
  assert.match(await about.text(), /chan_code/i);
});

test('server requires a bearer token when configured', async (t) => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.server = { host: '127.0.0.1', port: 0, token: 'secret-token' };
  const { base } = await withServer(t, { config });

  const denied = await fetch(`${base}/api/config`);
  assert.equal(denied.status, 401);
  const allowed = await fetch(`${base}/api/config`, { headers: { Authorization: 'Bearer secret-token' } });
  assert.equal(allowed.status, 200);
  const queryAllowed = await fetch(`${base}/api/health?token=secret-token`);
  assert.equal(queryAllowed.status, 200);
  const staticPage = await fetch(`${base}/`);
  assert.equal(staticPage.status, 200);
});

test('chat reports provider configuration errors as JSON instead of an empty stream', async (t) => {
  const server = new ChanServer({
    cwd,
    config: structuredClone(DEFAULT_CONFIG),
    providerFactory: () => {
      throw new Error('provider "mock" is missing an API key');
    },
  });
  const info = await server.listen({ port: 0, host: '127.0.0.1' });
  t.after(() => server.close());

  const created = await (
    await fetch(`${info.url}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  ).json();
  const res = await fetch(`${info.url}/api/sessions/${created.session.id}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hi' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /missing an API key/);
});

test('deny approval mode blocks bash commands', async (t) => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.agent = { ...config.agent, approval: 'deny' };
  const provider = toolProvider('node -e "console.log(\'denied-marker\')"');
  const { base } = await withServer(t, { config, provider });

  const created = await (
    await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  ).json();
  const { text } = await postChat(base, created.session.id, { message: 'run it' });
  assert.match(text, /Command refused/);
  assert.match(text, /approval mode is deny|did not approve/);
  assert.doesNotMatch(text, /status: success/);
});

test('ask approval mode pauses for approval and resumes the agent', async (t) => {
  const { base } = await withServer(t, { provider: toolProvider('node -e "console.log(\'approved-marker\')"') });
  const created = await (
    await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approval: 'ask' }),
    })
  ).json();

  const res = await fetch(`${base}/api/sessions/${created.session.id}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'run it' }),
  });
  assert.equal(res.status, 200);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let approved = false;
  let transcript = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    transcript += chunk;
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (block.includes('event: approval-request')) {
        const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
        const request = JSON.parse(dataLine.slice(6));
        const approval = await fetch(`${base}/api/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId: request.callId, approved: true }),
        });
        assert.equal(approval.status, 200);
        approved = true;
      }
    }
  }
  assert.equal(approved, true);
  assert.match(transcript, /approved-marker/);
  assert.match(transcript, /tool finished/);
});

test('extension endpoints expose skills, commands, agents and mcp status', async (t) => {
  const { base } = await withServer(t);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'chan-ext-'));
  fs.mkdirSync(path.join(workspace, '.chan', 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.chan', 'skills', 'demo', 'SKILL.md'), '---\ndescription: Demo skill\n---\nDemo body');
  fs.mkdirSync(path.join(workspace, '.chan', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.chan', 'commands', 'review.md'), '---\ndescription: Review\n---\nReview $ARGUMENTS');
  fs.mkdirSync(path.join(workspace, '.chan', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.chan', 'agents', 'reviewer.md'), '---\ndescription: Reviewer\nmode: subagent\n---\nReview only');

  const query = `cwd=${encodeURIComponent(workspace)}`;
  const skills = await (await fetch(`${base}/api/skills?${query}`)).json();
  assert.equal(skills.skills.length, 1);
  assert.equal(skills.skills[0].id, 'demo');

  const commands = await (await fetch(`${base}/api/commands?${query}`)).json();
  assert.equal(commands.commands[0].name, 'review');
  assert.equal(commands.commands[0].description, 'Review');

  const agents = await (await fetch(`${base}/api/agents?${query}`)).json();
  assert.ok(agents.agents.find((agent) => agent.name === 'build'));
  assert.ok(agents.agents.find((agent) => agent.name === 'reviewer'));
  assert.equal(agents.defaultAgent, 'build');

  const mcp = await (await fetch(`${base}/api/mcp`)).json();
  assert.deepEqual(mcp.servers, []);
  assert.deepEqual(mcp.tools, []);
});

test('chat can use MCP tools discovered from a local server', async (t) => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.mcp = {
    timeoutMs: 15000,
    servers: { fake: { type: 'local', command: [process.execPath, mcpFixture] } },
  };
  const provider = {
    name: 'fake',
    model: 'fake-1',
    type: 'openai',
    async *stream({ messages }) {
      const hasTool = messages.some((message) => message.role === 'tool');
      if (!hasTool) {
        yield { type: 'text-delta', text: 'calling mcp' };
        yield { type: 'tool-call', id: 'm1', name: 'fake_echo', arguments: JSON.stringify({ text: 'hello' }) };
        yield { type: 'done', stopReason: 'tool_calls' };
      } else {
        const toolMessages = messages.filter((message) => message.role === 'tool');
        const last = toolMessages[toolMessages.length - 1];
        yield { type: 'text-delta', text: `got ${last.content}` };
        yield { type: 'done', stopReason: 'stop' };
      }
    },
  };
  const server = new ChanServer({ cwd, config, providerFactory: () => provider });
  const info = await server.listen({ port: 0, host: '127.0.0.1' });
  t.after(() => server.close());

  const created = await (
    await fetch(`${info.url}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  ).json();
  const { text } = await postChat(info.url, created.session.id, { message: 'use mcp' });
  assert.match(text, /echo:hello/);
  assert.match(text, /got echo:hello/);
});

test('approval endpoint reports unknown requests', async (t) => {
  const { base } = await withServer(t);
  const res = await fetch(`${base}/api/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callId: 'missing', approved: true }),
  });
  assert.equal(res.status, 404);
});
