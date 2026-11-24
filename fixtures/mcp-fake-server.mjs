let buffer = '';

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function fail(id, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } })}\n`);
}

function handle(message) {
  if (message.method === 'initialize') {
    reply(message.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-mcp', version: '1.0.0' },
    });
    return;
  }
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'tools/list') {
    reply(message.id, {
      tools: [
        {
          name: 'echo',
          description: 'Echo the provided text',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
        {
          name: 'fail',
          description: 'Always returns an error result',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    });
    return;
  }
  if (message.method === 'tools/call') {
    if (message.params?.name === 'echo') {
      reply(message.id, {
        content: [{ type: 'text', text: `echo:${message.params.arguments?.text ?? ''}` }],
      });
      return;
    }
    if (message.params?.name === 'fail') {
      reply(message.id, { isError: true, content: [{ type: 'text', text: 'boom' }] });
      return;
    }
    fail(message.id, `unknown tool: ${message.params?.name}`);
    return;
  }
  if (message.id != null) fail(message.id, `unknown method: ${message.method}`);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      /* ignore malformed input */
    }
  }
});
