import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSystemPrompt, runAgent } from '../src/agent.js';

function makeProvider(steps) {
  let index = 0;
  return {
    name: 'fake',
    model: 'fake-1',
    async *stream() {
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      for (const event of step) yield event;
    },
  };
}

function echoTool(executions = { count: 0 }) {
  return {
    name: 'echo',
    description: 'echo text',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    async run(args) {
      executions.count += 1;
      if (args.text === 'fail') throw new Error('boom');
      return `echo:${args.text}`;
    },
  };
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

test('buildSystemPrompt includes workspace and platform', () => {
  const prompt = buildSystemPrompt({ cwd: 'C:/work/app', custom: 'Be terse.' });
  assert.match(prompt, /C:\/work\/app/);
  assert.match(prompt, /Be terse\./);
  assert.match(prompt, /chan_code/);
});

test('agent streams text and finishes without tools', async () => {
  const provider = makeProvider([
    [
      { type: 'text-delta', text: 'Hello' },
      { type: 'text-delta', text: ' there' },
      { type: 'done', stopReason: 'stop', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
    ],
  ]);
  const messages = [{ role: 'user', content: 'hi' }];
  const events = await collect(runAgent({ provider, messages, tools: [], maxSteps: 5 }));

  const text = events.filter((e) => e.type === 'text-delta').map((e) => e.text).join('');
  assert.equal(text, 'Hello there');
  assert.equal(messages.length, 2);
  assert.equal(messages[1].content, 'Hello there');
  const done = events.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.reason, 'completed');
  assert.equal(done.usage.totalTokens, 5);
});

test('agent executes tools and feeds results back', async () => {
  const provider = makeProvider([
    [
      { type: 'text-delta', text: 'let me check' },
      { type: 'tool-call', id: 'c1', name: 'echo', arguments: '{"text":"hi"}' },
      { type: 'done', stopReason: 'tool_calls' },
    ],
    [
      { type: 'text-delta', text: 'done!' },
      { type: 'done', stopReason: 'stop' },
    ],
  ]);
  const messages = [{ role: 'user', content: 'go' }];
  const events = await collect(
    runAgent({ provider, messages, tools: [echoTool()], maxSteps: 5, session: null }),
  );

  const toolResult = events.find((e) => e.type === 'tool-result');
  assert.equal(toolResult.ok, true);
  assert.equal(toolResult.output, 'echo:hi');
  assert.equal(messages.length, 4);
  assert.equal(messages[2].role, 'tool');
  assert.equal(messages[2].toolCallId, 'c1');
  assert.equal(events.at(-1).reason, 'completed');
  assert.equal(events.at(-1).steps, 2);
});

test('agent reports failing and unknown tools without crashing', async () => {
  const provider = makeProvider([
    [
      { type: 'tool-call', id: 'c1', name: 'echo', arguments: '{"text":"fail"}' },
      { type: 'tool-call', id: 'c2', name: 'missing', arguments: '{}' },
      { type: 'tool-call', id: 'c3', name: 'echo', arguments: 'not json' },
      { type: 'done', stopReason: 'tool_calls' },
    ],
    [{ type: 'done', stopReason: 'stop' }],
  ]);
  const events = await collect(runAgent({ provider, messages: [{ role: 'user', content: 'go' }], tools: [echoTool()] }));
  const results = events.filter((e) => e.type === 'tool-result');
  assert.equal(results.length, 3);
  assert.match(results[0].output, /Error: boom/);
  assert.match(results[1].output, /unknown tool "missing"/);
  assert.match(results[2].output, /invalid JSON arguments/);
  assert.equal(events.at(-1).reason, 'completed');
});

test('agent detects repeated identical tool calls', async () => {
  const executions = { count: 0 };
  const provider = makeProvider([
    [
      { type: 'tool-call', id: 'a', name: 'echo', arguments: '{"text":"again"}' },
      { type: 'done', stopReason: 'tool_calls' },
    ],
  ]);
  const events = await collect(
    runAgent({ provider, messages: [{ role: 'user', content: 'loop' }], tools: [echoTool(executions)], maxSteps: 10 }),
  );
  assert.equal(events.at(-1).reason, 'loop-detected');
  assert.equal(executions.count, 2);
  const failures = events.filter((e) => e.type === 'tool-result' && !e.ok);
  assert.equal(failures.length, 1);
  assert.match(failures[0].output, /repeated 3 times/);
});

test('agent stops at max steps with a warning', async () => {
  let step = 0;
  const provider = {
    name: 'fake',
    model: 'fake-1',
    async *stream() {
      step += 1;
      yield { type: 'tool-call', id: `c${step}`, name: 'echo', arguments: JSON.stringify({ text: `n${step}` }) };
      yield { type: 'done', stopReason: 'tool_calls' };
    },
  };
  const messages = [{ role: 'user', content: 'keep going' }];
  const events = await collect(runAgent({ provider, messages, tools: [echoTool()], maxSteps: 2 }));
  assert.equal(events.at(-1).reason, 'max-steps');
  assert.equal(events.at(-1).steps, 2);
  const warning = events.find((e) => e.type === 'warning');
  assert.match(warning.message, /step limit/);
});

test('agent propagates provider errors as error events then throws', async () => {
  const provider = {
    name: 'fake',
    model: 'fake-1',
    async *stream() {
      throw new Error('provider exploded');
    },
  };
  const events = [];
  await assert.rejects(async () => {
    for await (const event of runAgent({ provider, messages: [{ role: 'user', content: 'hi' }], tools: [] })) {
      events.push(event);
    }
  }, /provider exploded/);
  assert.ok(events.find((e) => e.type === 'error'));
});
