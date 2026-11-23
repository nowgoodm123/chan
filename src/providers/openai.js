import { iterateSSE } from '../util/sse.js';
import { ensureOk, fetchWithRetry } from '../util/http.js';

export function toOpenAIMessages(messages, system) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const message of messages) {
    if (message.role === 'system') {
      out.push({ role: 'system', content: message.content });
    } else if (message.role === 'user') {
      if (message.images?.length) {
        const parts = [];
        if (message.content) parts.push({ type: 'text', text: message.content });
        for (const image of message.images) {
          parts.push({ type: 'image_url', image_url: { url: image.dataUrl } });
        }
        out.push({ role: 'user', content: parts });
      } else {
        out.push({ role: 'user', content: message.content || '' });
      }
    } else if (message.role === 'assistant') {
      const entry = { role: 'assistant', content: message.content || '' };
      if (message.toolCalls?.length) {
        entry.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments || '{}' },
        }));
        if (!entry.content) entry.content = null;
      }
      out.push(entry);
    } else if (message.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content || '' });
    }
  }
  return out;
}

export function toOpenAITools(tools) {
  return (tools || []).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || { type: 'object', properties: {} },
    },
  }));
}

export function normalizeOpenAIUsage(usage) {
  if (!usage) return null;
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.total_tokens ?? inputTokens + outputTokens,
  };
}

function parseToolName(current, incoming) {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  return current + incoming;
}

export function createOpenAIProvider(provider) {
  const baseUrl = String(provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const endpoint = `${baseUrl}/chat/completions`;

  return {
    name: provider.name,
    model: provider.model,
    type: 'openai',
    async *stream({ messages, system, tools, signal, temperature, maxTokens }) {
      const body = {
        model: provider.model,
        messages: toOpenAIMessages(messages, system),
        stream: true,
      };
      if (Number.isFinite(temperature)) body.temperature = temperature;
      if (Number.isFinite(maxTokens)) body.max_tokens = maxTokens;
      if (tools?.length) {
        body.tools = toOpenAITools(tools);
        body.tool_choice = 'auto';
      }
      if (provider.streamUsage !== false) body.stream_options = { include_usage: true };

      const headers = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'User-Agent': 'chan-code/0.1',
        ...provider.extraHeaders,
      };
      if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

      const response = await fetchWithRetry(
        endpoint,
        { method: 'POST', headers, body: JSON.stringify(body), signal },
        { retries: 2 },
      );
      await ensureOk(response, `provider "${provider.name}"`);

      const calls = new Map();
      let stopReason = null;
      let usage = null;

      for await (const raw of iterateSSE(response.body)) {
        if (raw === '[DONE]') break;
        let chunk;
        try {
          chunk = JSON.parse(raw);
        } catch {
          continue;
        }
        if (chunk.error) {
          const message = chunk.error.message || JSON.stringify(chunk.error);
          throw new Error(`provider "${provider.name}" stream error: ${message}`);
        }
        if (chunk.usage) usage = normalizeOpenAIUsage(chunk.usage);
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) stopReason = choice.finish_reason;
        const delta = choice.delta || {};
        if (typeof delta.content === 'string' && delta.content) {
          yield { type: 'text-delta', text: delta.content };
        }
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          yield { type: 'reasoning-delta', text: delta.reasoning_content };
        }
        if (typeof delta.reasoning === 'string' && delta.reasoning) {
          yield { type: 'reasoning-delta', text: delta.reasoning };
        }
        for (const toolCall of delta.tool_calls || []) {
          const index = toolCall.index ?? 0;
          const current = calls.get(index) || { id: '', name: '', arguments: '' };
          if (toolCall.id) current.id = toolCall.id;
          if (toolCall.function?.name) current.name = parseToolName(current.name, toolCall.function.name);
          if (toolCall.function?.arguments) current.arguments += toolCall.function.arguments;
          calls.set(index, current);
        }
      }

      let hasToolCalls = false;
      for (const [index, call] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
        if (!call.name) continue;
        hasToolCalls = true;
        yield {
          type: 'tool-call',
          id: call.id || `call_${index}_${Date.now()}`,
          name: call.name,
          arguments: call.arguments || '{}',
        };
      }

      yield {
        type: 'done',
        stopReason: stopReason || (hasToolCalls ? 'tool_calls' : 'stop'),
        usage,
      };
    },
  };
}
