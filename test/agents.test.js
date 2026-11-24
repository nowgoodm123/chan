import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { formatAgentsForPrompt, loadAgents, visibleSubagents } from '../src/agents.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { createRuntime } from '../src/runtime.js';

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chan-agents-'));
}

function fakeProvider(text = 'subagent answer') {
  return {
    name: 'fake',
    model: 'fake-1',
    type: 'openai',
    async *stream() {
      yield { type: 'text-delta', text };
      yield { type: 'done', stopReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    },
  };
}

function runtimeOptions(cwd, overrides = {}) {
  return {
    cwd,
    config: structuredClone(DEFAULT_CONFIG),
    session: { messages: [], todos: [], agent: 'build' },
    provider: fakeProvider(),
    providerName: 'deepseek',
    approvalMode: 'auto',
    ...overrides,
  };
}

test('loadAgents includes built-ins and custom agent files', () => {
  const cwd = workspace();
  const dir = path.join(cwd, '.chan', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'reviewer.md'),
    '---\ndescription: Reviews changes\nmode: subagent\ntools: [read, grep]\nsteps: 5\n---\nReview only. Do not edit.\n',
  );
  fs.writeFileSync(path.join(dir, 'hidden.md'), '---\nhidden: true\nmode: subagent\n---\nHidden agent');
  fs.mkdirSync(path.join(dir, 'team'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'team', 'release.md'), '---\ndescription: Release helper\n---\nShip it.');

  const agents = loadAgents({ cwd, config: {} });
  for (const name of ['build', 'plan', 'explore', 'general']) assert.ok(agents.has(name));
  const reviewer = agents.get('reviewer');
  assert.equal(reviewer.mode, 'subagent');
  assert.equal(reviewer.description, 'Reviews changes');
  assert.deepEqual(reviewer.tools, ['read', 'grep']);
  assert.equal(reviewer.steps, 5);
  assert.equal(agents.get('team/release').mode, 'all');
  assert.equal(agents.get('hidden').hidden, true);

  const visible = visibleSubagents(agents).map((agent) => agent.name);
  assert.ok(visible.includes('explore'));
  assert.ok(visible.includes('reviewer'));
  assert.ok(!visible.includes('hidden'));
  assert.match(formatAgentsForPrompt(agents), /explore:/);
});

test('runtime exposes skill and subagent tools and restricts plan tools', async () => {
  const cwd = workspace();
  const build = await createRuntime(runtimeOptions(cwd));
  const names = build.tools.map((tool) => tool.name);
  assert.ok(names.includes('write'));
  assert.ok(names.includes('subagent'));

  const plan = await createRuntime(runtimeOptions(cwd, { agentName: 'plan' }));
  const planNames = plan.tools.map((tool) => tool.name);
  assert.ok(planNames.includes('read'));
  assert.ok(planNames.includes('grep'));
  assert.ok(!planNames.includes('write'));
  assert.ok(!planNames.includes('edit'));
  assert.ok(!planNames.includes('bash'));
  assert.match(plan.system, /plan mode/i);
});

test('subagent runner returns the child report and blocks nested subagents', async () => {
  const cwd = workspace();
  const runtime = await createRuntime(runtimeOptions(cwd, { provider: fakeProvider('child says hi') }));
  assert.equal(typeof runtime.runSubagent, 'function');
  const report = await runtime.runSubagent({ agent: 'explore', prompt: 'Find the entry point' });
  assert.match(report, /Subagent "explore" finished/);
  assert.match(report, /child says hi/);
  await assert.rejects(runtime.runSubagent({ agent: 'nope', prompt: 'x' }), /unknown subagent/);

  const nested = await createRuntime(runtimeOptions(cwd, { depth: 1 }));
  assert.equal(nested.runSubagent, null);
  assert.ok(!nested.tools.some((tool) => tool.name === 'subagent'));
});

test('custom subagent files are usable through the runner', async () => {
  const cwd = workspace();
  const dir = path.join(cwd, '.chan', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'reviewer.md'), '---\ndescription: Review changes\nmode: subagent\n---\nReview carefully.');
  const runtime = await createRuntime(runtimeOptions(cwd, { provider: fakeProvider('review done') }));
  const report = await runtime.runSubagent({ agent: 'reviewer', prompt: 'Check this diff' });
  assert.match(report, /Subagent "reviewer" finished/);
  assert.match(report, /review done/);
});
