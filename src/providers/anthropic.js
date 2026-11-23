import { iterateSSE } from '../util/sse.js';
import { ensureOk, fetchWithRetry } from '../util/http.js';
import { safeJsonParse } from '../util/text.js';

function imageBlock(image) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(image.dataUrl || '');
  if (!match) return null;
  return {
    type: 'image',
    source: { type: 'base64', media_type: image.mediaType || match[1], data: match[2] },
  };
}

function parseToolInput(raw) {
  const parsed = safeJsonParse(raw, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  return {};
}

export function toAnthropicMessages(messages) {
  const out = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role && role === 'user') {
      last.content.push(...blocks);
    } else {
      out.push({ role, content: blocks });
    }
  };

  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'user') {
      const blocks = [];
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const image of message.images || []) {
        const block = imageBlock(image);
        if (block) blocks.push(block);
      }
      push('user', blocks);
    } else if (message.role === 'assistant') {
      const blocks = [];
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls || []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: parseToolInput(call.arguments) });
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
    } else if (message.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: message.content || '',
        },
      ]);
    }
  }
  return out;
}

export function toAnthropicTools(tools) {
  return (tools || []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters || { type: 'object', properties: {} },
  }));
}

export function createAnthropicProvider(provider) {
  const baseUrl = String(provider.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  const endpoint = `${baseUrl}/messages`;

  return {
    name: provider.name,
    model: provider.model,
    type: 'anthropic',
    async *stream({ messages, system, tools, signal, temperature, maxTokens }) {
      const body = {
        model: provider.model,
        messages: toAnthropicMessages(messages),
        max_tokens: Number.isFinite(maxTokens) ? maxTokens : provider.maxTokens || 8192,
        stream: true,
      };
      if (system) body.system = system;
      if (Number.isFinite(temperature)) body.temperature = temperature;
      if (tools?.length) body.tools = toAnthropicTools(tools);

      const headers = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'anthropic-version': '2023-06-01',
        'User-Agent': 'chan-code/0.1',
        ...provider.extraHeaders,
      };
      if (provider.apiKey) headers['x-api-key'] = provider.apiKey;

      const response = await fetchWithRetry(
        endpoint,
        { method: 'POST', headers, body: JSON.stringify(body), signal },
        { retries: 2 },
      );
      await ensureOk(response, `provider "${provider.name}"`);

      const blocks = new Map();
      const toolCalls = [];
      let stopReason = null;
      let inputTokens = 0;
      let outputTokens = 0;
      let blockIndex = 0;

      for await (const raw of iterateSSE(response.body)) {
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          continue;
        }
        if (event.type === 'error') {
          throw new Error(`provider "${provider.name}" stream error: ${event.error?.message || 'unknown error'}`);
        }
        if (event.type === 'message_start') {
          inputTokens = event.message?.usage?.input_tokens ?? inputTokens;
          outputTokens = event.message?.usage?.output_tokens ?? outputTokens;
        } else if (event.type === 'content_block_start') {
          blockIndex = event.index ?? blockIndex;
          const block = event.content_block || {};
          if (block.type === 'tool_use') {
            blocks.set(blockIndex, { id: block.id, name: block.name, json: '', input: block.input });
          } else {
            blocks.set(blockIndex, { type: 'text', text: block.text || '' });
          }
        } else if (event.type === 'content_block_delta') {
          const index = event.index ?? blockIndex;
          const delta = event.delta || {};
          if (delta.type === 'text_delta' && delta.text) {
            yield { type: 'text-delta', text: delta.text };
          } else if (delta.type === 'thinking_delta' && delta.thinking) {
            yield { type: 'reasoning-delta', text: delta.thinking };
          } else if (delta.type === 'input_json_delta') {
            const current = blocks.get(index);
            if (current) current.json += delta.partial_json || '';
          }
        } else if (event.type === 'content_block_stop') {
          const index = event.index ?? blockIndex;
          const current = blocks.get(index);
          if (current && current.name) {
            toolCalls.push({
              id: current.id,
              name: current.name,
              arguments: JSON.stringify(current.json ? parseToolInput(current.json) : current.input || {}),
            });
          }
        } else if (event.type === 'message_delta') {
          stopReason = event.delta?.stop_reason ?? stopReason;
          outputTokens = event.usage?.output_tokens ?? outputTokens;
        } else if (event.type === 'message_stop') {
          break;
        }
      }

      for (const call of toolCalls) {
        yield { type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments };
      }

      yield {
        type: 'done',
        stopReason: stopReason || (toolCalls.length ? 'tool_use' : 'end_turn'),
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      };
    },
  };
}
