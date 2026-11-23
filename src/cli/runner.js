import readline from 'node:readline';

export function createApprovalPrompt(rl = null) {
  return async (request) => {
    const question = `Approve ${request.tool}${request.command ? ` \`${request.command}\`` : ''}?${request.danger ? ` (${request.danger})` : ''} [y/N] `;
    const answer = await ask(rl, question);
    return { approved: /^y(es)?$/i.test(String(answer || '').trim()) };
  };
}

export function ask(rl, question) {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve) => rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }));
  }
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));
}

export async function runTurn({ provider, session, tools, system, ui, approve, signal, maxSteps, temperature, maxOutputChars, onEvent }) {
  const { runAgent } = await import('../agent.js');
  const stream = runAgent({
    provider,
    messages: session.messages,
    system,
    tools,
    approve,
    signal,
    session,
    maxSteps,
    temperature,
    maxOutputChars,
  });

  let wroteText = false;
  let lastUsage = null;
  let error = null;

  for await (const event of stream) {
    if (onEvent) onEvent(event);
    switch (event.type) {
      case 'text-delta':
        wroteText = true;
        ui.write(event.text);
        break;
      case 'reasoning-delta': {
        const previous = ui._reasoningShown || 0;
        if (!previous) ui.line(ui.dim('thinking…'));
        ui._reasoningShown = previous + event.text.length;
        break;
      }
      case 'tool-call':
        ui.toolStart(event.name, event.arguments);
        break;
      case 'tool-result':
        ui.toolResult(event.ok, event.output, event.durationMs);
        break;
      case 'assistant':
        if (event.usage) lastUsage = event.totalUsage || event.usage;
        ui._reasoningShown = 0;
        break;
      case 'warning':
        ui.warn(event.message);
        break;
      case 'error':
        error = event.message;
        ui.error(event.message);
        break;
      case 'done':
        ui.stop();
        lastUsage = event.usage || lastUsage;
        break;
      default:
        break;
    }
  }

  if (wroteText) ui.line();
  if (lastUsage) ui.usage(lastUsage);
  return { usage: lastUsage, error };
}

export function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}
