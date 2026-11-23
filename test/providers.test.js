import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAnthropicProvider, toAnthropicMessages } from '../src/providers/anthropic.js';
import { createOpenAIProvider, toOpenAIMessages } from '../src/providers/openai.js';
import { createProvider } from '../src/providers/index.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { ensureOk } from '../src/util/http.js';

const encoder = new TextEncoder();

function sseResponse(chunks, { status = 200, contentType = 'text/event-stream' } = {}) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': contentType } });
}

function withFetch(t, handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: options?.body ? JSON.parse(options.body) : null });
    return handler(url, options);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

test('openai provider streams text, tool calls and usage', async (t) => {
  const chunks = [
    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Hel',
    'lo "}}]}\n\ndata: {"choices":[{"delta":{"content":"world"}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read","arguments":"{\\"pa"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.js\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
    'data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
    'data: [DONE]\n\n',
  ];
  const calls = withFetch(t, () => sseResponse(chunks));
  const provider = createOpenAIProvider({
    name: 'demo',
    type: 'openai',
    baseUrl: 'https://example.test/v1/',
    apiKey: 'sk-test',
    model: 'demo-model',
  });

  const events = [];
  for await (const event of provider.stream({
    system: 'be helpful',
    messages: [{ role: 'user', content: 'hi', images: [{ dataUrl: 'data:image/png;base64,AAA', mediaType: 'image/png' }] }],
    tools: [{ name: 'read', description: 'read', parameters: { type: 'object', properties: {} } }],
    temperature: 0.1,
  })) {
    events.push(event);
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-test');
  assert.equal(calls[0].body.model, 'demo-model');
  assert.equal(calls[0].body.messages[0].role, 'system');
  assert.equal(calls[0].body.messages[1].content[1].type, 'image_url');
  assert.equal(calls[0].body.tools[0].function.name, 'read');

  const text = events.filter((e) => e.type === 'text-delta').map((e) => e.text).join('');
  assert.equal(text, 'Hello world');
  const toolCall = events.find((e) => e.type === 'tool-call');
  assert.equal(toolCall.name, 'read');
  assert.deepEqual(JSON.parse(toolCall.arguments), { path: 'a.js' });
  const done = events.find((e) => e.type === 'done');
  assert.equal(done.stopReason, 'tool_calls');
  assert.deepEqual(done.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

test('openai provider surfaces HTTP errors with hints', async (t) => {
  withFetch(t, () => new Response('{"error":"invalid key"}', { status: 401 }));
  const provider = createOpenAIProvider({ name: 'demo', baseUrl: 'https://example.test/v1', apiKey: 'bad', model: 'm' });
  await assert.rejects(async () => {
    for await (const _event of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      void _event;
    }
  }, /HTTP 401.*invalid API key/);
});

test('anthropic provider streams text and tool use', async (t) => {
  const chunks = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"bash","input":{}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"ls\\"}"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
  const calls = withFetch(t, () => sseResponse(chunks));
  const provider = createAnthropicProvider({
    name: 'claude',
    type: 'anthropic',
    baseUrl: 'https://example.test/v1',
    apiKey: 'sk-ant',
    model: 'claude-test',
  });

  const events = [];
  for await (const event of provider.stream({
    system: 'system prompt',
    messages: [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'read', arguments: '{"path":"x"}' }] },
      { role: 'tool', toolCallId: 'a', name: 'read', content: 'file content' },
    ],
    tools: [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: { command: { type: 'string' } } } }],
  })) {
    events.push(event);
  }

  assert.equal(calls[0].url, 'https://example.test/v1/messages');
  assert.equal(calls[0].options.headers['x-api-key'], 'sk-ant');
  assert.equal(calls[0].body.system, 'system prompt');
  assert.equal(calls[0].body.max_tokens, 8192);
  assert.equal(calls[0].body.messages[1].content[0].type, 'tool_use');
  assert.equal(calls[0].body.messages[2].content[0].type, 'tool_result');
  assert.equal(events.filter((e) => e.type === 'text-delta').map((e) => e.text).join(''), 'Hi');
  const toolCall = events.find((e) => e.type === 'tool-call');
  assert.equal(toolCall.name, 'bash');
  assert.deepEqual(JSON.parse(toolCall.arguments), { command: 'ls' });
  const done = events.find((e) => e.type === 'done');
  assert.equal(done.stopReason, 'tool_use');
  assert.deepEqual(done.usage, { inputTokens: 12, outputTokens: 7, totalTokens: 19 });
});

test('anthropic message conversion merges tool results and images', () => {
  const converted = toAnthropicMessages([
    { role: 'user', content: 'look', images: [{ dataUrl: 'data:image/jpeg;base64,QUJD', mediaType: 'image/jpeg' }] },
    { role: 'assistant', content: 'ok', toolCalls: [{ id: 't1', name: 'read', arguments: '{"path":"a"}' }] },
    { role: 'tool', toolCallId: 't1', name: 'read', content: 'abc' },
    { role: 'tool', toolCallId: 't2', name: 'read', content: 'def' },
  ]);
  assert.equal(converted.length, 3);
  assert.equal(converted[0].content[1].type, 'image');
  assert.equal(converted[0].content[1].source.media_type, 'image/jpeg');
  assert.equal(converted[1].content[1].type, 'tool_use');
  assert.equal(converted[2].role, 'user');
  assert.equal(converted[2].content.length, 2);
  assert.equal(converted[2].content[0].tool_use_id, 't1');
});

test('openai message conversion keeps assistant tool calls and tool results', () => {
  const converted = toOpenAIMessages(
    [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c1', name: 'read', content: 'data' },
    ],
    'sys',
  );
  assert.equal(converted[0].role, 'system');
  assert.equal(converted[1].role, 'user');
  assert.equal(converted[2].tool_calls[0].id, 'c1');
  assert.equal(converted[3].role, 'tool');
});

test('createProvider validates configuration', () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.providers.broken = { type: 'openai', baseUrl: 'https://example.test', model: 'm' };
  assert.throws(() => createProvider(config, 'broken'), /missing an API key/);
  config.providers.local = { type: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: 'm' };
  assert.equal(createProvider(config, 'local').type, 'openai');
  config.providers.weird = { type: 'unknown', baseUrl: 'http://127.0.0.1:1', model: 'm' };
  assert.throws(() => createProvider(config, 'weird'), /unsupported provider type/);
});

test('ensureOk includes status hints', async () => {
  await assert.rejects(ensureOk(new Response('nope', { status: 404 }), 'demo'), /endpoint or model not found/);
  const ok = await ensureOk(new Response('fine', { status: 200 }), 'demo');
  assert.equal(ok.status, 200);
});
