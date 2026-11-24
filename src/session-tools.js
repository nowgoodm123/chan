import { serializeSession } from './sessions.js';
import { truncate } from './util/text.js';

export function forkSession(store, session, { beforeIndex = null, title = null } = {}) {
  const fork = store.create({
    cwd: session.cwd,
    provider: session.provider,
    model: session.model,
    approval: session.approval,
    agent: session.agent,
    title: title || `${session.title || 'Session'} (fork)`,
  });
  const messages = session.messages || [];
  const index = Number.isFinite(Number(beforeIndex)) && beforeIndex !== null ? Number(beforeIndex) : messages.length;
  fork.messages = structuredClone(messages.slice(0, Math.max(0, Math.min(index, messages.length))));
  fork.todos = structuredClone(session.todos || []);
  fork.usage = { ...(session.usage || {}) };
  store.save(fork);
  return fork;
}

export function sessionToMarkdown(session) {
  const lines = [
    `# ${session.title || 'chan_code session'}`,
    '',
    `- id: ${session.id}`,
    `- cwd: ${session.cwd}`,
    `- provider: ${session.provider || '(default)'}`,
    `- model: ${session.model || '(default)'}`,
    `- agent: ${session.agent || 'build'}`,
    `- created: ${session.createdAt || ''}`,
    `- updated: ${session.updatedAt || ''}`,
    '',
    '---',
    '',
  ];
  for (const message of session.messages || []) {
    if (message.role === 'user') {
      lines.push('## User', '', message.content || '');
      if (message.images?.length) {
        lines.push('', `Attachments: ${message.images.map((image) => image.path || image.name || 'image').join(', ')}`);
      }
      lines.push('');
    } else if (message.role === 'assistant') {
      lines.push('## Assistant', '', message.content || '(no text)');
      if (message.reasoning) lines.push('', '> Reasoning:', '', message.reasoning);
      if (message.toolCalls?.length) {
        lines.push('', 'Tool calls:');
        for (const call of message.toolCalls) lines.push(`- \`${call.name}\` ${truncate(call.arguments || '{}', 500).text.replace(/\n/g, ' ')}`);
      }
      lines.push('');
    } else if (message.role === 'tool') {
      lines.push(`### Tool result: ${message.name || 'tool'}`, '', '```text', message.content || '', '```', '');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function sessionToJson(session) {
  return `${JSON.stringify(serializeSession(session), null, 2)}\n`;
}

function buildTranscript(messages, maxChars = 60000) {
  const lines = [];
  for (const message of messages || []) {
    if (message.role === 'user') {
      lines.push(`USER: ${message.content || ''}`);
      if (message.images?.length) lines.push(`[images: ${message.images.map((image) => image.name || image.path || 'image').join(', ')}]`);
    } else if (message.role === 'assistant') {
      lines.push(`ASSISTANT: ${message.content || ''}`);
      for (const call of message.toolCalls || []) {
        lines.push(`  TOOL CALL ${call.name} ${truncate(call.arguments || '{}', 300).text.replace(/\n/g, ' ')}`);
      }
    } else if (message.role === 'tool') {
      lines.push(`  TOOL RESULT ${message.name || ''}: ${truncate(message.content || '', 800).text.replace(/\n/g, '\n    ')}`);
    }
  }
  const text = lines.join('\n');
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.35);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n\n[... middle of conversation omitted ...]\n\n${text.slice(-tail)}`;
}

export async function compactSession({ provider, session, signal = null, maxChars = 60000 }) {
  if (!provider || typeof provider.stream !== 'function') throw new Error('compactSession requires a provider');
  const transcript = buildTranscript(session.messages, maxChars);
  if (!transcript.trim()) throw new Error('nothing to compact');
  const messages = [
    {
      role: 'user',
      content: [
        'Compact this coding-agent conversation for a future continuation.',
        'Preserve: the user goals, decisions and constraints, files created/modified with paths, commands and test results, open tasks, and any important errors.',
        'Be concise but specific. Output Markdown only.',
        '',
        transcript,
      ].join('\n'),
    },
  ];
  let summary = '';
  for await (const event of provider.stream({
    messages,
    system: 'You compress coding agent conversations. Preserve technical facts and file paths. Do not invent details.',
    tools: [],
    signal,
    temperature: 0.1,
  })) {
    if (event.type === 'text-delta') summary += event.text;
    else if (event.type === 'done') break;
  }
  summary = summary.trim();
  if (!summary) throw new Error('provider returned an empty summary');
  session.messages = [
    { role: 'user', content: `[Context compacted]\n\n${summary}` },
    { role: 'assistant', content: 'Context compacted. I will continue from the summary above.' },
  ];
  session.updatedAt = new Date().toISOString();
  return summary;
}
