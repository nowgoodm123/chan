import os from 'node:os';
import { toolDefinitions } from './tools/index.js';
import { safeJsonParse, truncate } from './util/text.js';

export function buildSystemPrompt({ cwd, custom = '', platform = process.platform } = {}) {
  const shell = platform === 'win32' ? 'PowerShell' : 'bash';
  const date = new Date().toISOString().slice(0, 10);
  const base = [
    'You are chan_code, a capable, careful AI coding agent working directly inside the user\'s project.',
    '',
    `Workspace directory: ${cwd}`,
    `Platform: ${platform} (${os.release()}); shell: ${shell}`,
    `Date: ${date}`,
    '',
    'How to work:',
    '- Inspect before acting: use list/glob/grep/read to understand the code before changing it.',
    '- Read a file before editing it, and use edit with exact strings for small changes.',
    '- Match the existing code style. Make focused changes, avoid unrelated rewrites.',
    '- For multi-step work, maintain a short todo list with todo_write and update statuses as you go.',
    '- Run relevant tests, builds, or linters with bash and report the true result. Never claim success without evidence.',
    '- Use webfetch for documentation or error research when helpful.',
    '- Never print or commit secrets. Treat files outside the workspace carefully.',
    '- Keep prose short. Reference code as path:line. Do not add comments unless they add real value.',
  ].join('\n');
  return custom && custom.trim() ? `${custom.trim()}\n\n---\n\n${base}` : base;
}

function toolSignature(name, args) {
  return `${name}:${JSON.stringify(args)}`;
}

function addUsage(total, usage) {
  if (!usage) return;
  total.inputTokens += usage.inputTokens || 0;
  total.outputTokens += usage.outputTokens || 0;
  total.totalTokens += usage.totalTokens || (usage.inputTokens || 0) + (usage.outputTokens || 0);
}

export async function* runAgent({
  provider,
  messages,
  system,
  tools = [],
  maxSteps = 40,
  temperature,
  signal,
  approve,
  session = null,
  maxOutputChars = 20000,
}) {
  if (!provider || typeof provider.stream !== 'function') {
    throw new Error('runAgent requires a provider with a stream() method');
  }
  const toolDefs = toolDefinitions(tools);
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const seen = new Map();
  let steps = 0;
  let endReason = 'completed';

  while (steps < maxSteps) {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    steps += 1;
    yield { type: 'step', step: steps, maxSteps };

    let text = '';
    let reasoning = '';
    const toolCalls = [];
    let stopReason = null;
    let usage = null;

    try {
      for await (const event of provider.stream({
        messages,
        system,
        tools: toolDefs,
        temperature,
        signal,
      })) {
        if (event.type === 'text-delta') {
          text += event.text;
          yield { type: 'text-delta', text: event.text };
        } else if (event.type === 'reasoning-delta') {
          reasoning += event.text;
          yield { type: 'reasoning-delta', text: event.text };
        } else if (event.type === 'tool-call') {
          toolCalls.push(event);
        } else if (event.type === 'done') {
          stopReason = event.stopReason;
          usage = event.usage;
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      yield { type: 'error', message: err.message };
      throw err;
    }

    if (usage) addUsage(totalUsage, usage);

    const assistantMessage = { role: 'assistant', content: text };
    if (reasoning) assistantMessage.reasoning = reasoning;
    if (toolCalls.length) {
      assistantMessage.toolCalls = toolCalls.map((call) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments || '{}',
      }));
    }
    messages.push(assistantMessage);
    yield {
      type: 'assistant',
      message: assistantMessage,
      step: steps,
      usage: usage || null,
      totalUsage: { ...totalUsage },
      stopReason,
    };

    if (!toolCalls.length) {
      endReason = 'completed';
      break;
    }

    let repeated = false;
    for (const call of toolCalls) {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const args = safeJsonParse(call.arguments, null);
      yield { type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments };

      const signature = toolSignature(call.name, args ?? call.arguments);
      const count = (seen.get(signature) || 0) + 1;
      seen.set(signature, count);
      if (count >= 3) {
        repeated = true;
        const output = `Stopped: the tool call ${call.name}(${truncate(call.arguments, 200).text}) was repeated ${count} times with the same arguments. Try a different approach.`;
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: output });
        yield { type: 'tool-result', id: call.id, name: call.name, ok: false, output, durationMs: 0 };
        continue;
      }

      let output;
      let ok = true;
      const startedAt = Date.now();
      try {
        if (args === null) {
          throw new Error(`invalid JSON arguments for ${call.name}: ${call.arguments}`);
        }
        const tool = toolMap.get(call.name);
        if (!tool) {
          throw new Error(`unknown tool "${call.name}". Available tools: ${[...toolMap.keys()].join(', ')}`);
        }
        output = await tool.run(args);
        if (typeof output !== 'string') output = JSON.stringify(output, null, 2);
      } catch (err) {
        ok = false;
        output = `Error: ${err.message}`;
      }
      output = truncate(output, maxOutputChars).text;
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: output });
      yield {
        type: 'tool-result',
        id: call.id,
        name: call.name,
        ok,
        output,
        durationMs: Date.now() - startedAt,
      };
    }

    if (repeated) {
      endReason = 'loop-detected';
      break;
    }
    if (steps >= maxSteps) {
      endReason = 'max-steps';
    }
  }

  if (endReason === 'max-steps') {
    const note = {
      role: 'assistant',
      content: `Stopped: reached the step limit (${maxSteps}). Continue the conversation to keep going.`,
    };
    messages.push(note);
    yield { type: 'warning', message: note.content };
  }

  if (session) {
    session.usage = { ...totalUsage };
    session.updatedAt = new Date().toISOString();
  }

  yield {
    type: 'done',
    reason: endReason,
    steps,
    usage: { ...totalUsage },
    messages,
  };
}
