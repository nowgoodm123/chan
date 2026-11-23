export async function* iterateSSE(body) {
  if (!body) return;
  const decoder = new TextDecoder();
  let buffer = '';
  let data = [];

  const flush = () => {
    if (!data.length) return null;
    const payload = data.join('\n');
    data = [];
    return payload;
  };

  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      let line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') {
        const payload = flush();
        if (payload !== null) yield payload;
        continue;
      }
      if (line.startsWith(':')) continue;
      const match = /^data:(.*)$/.exec(line);
      if (match) data.push(match[1].startsWith(' ') ? match[1].slice(1) : match[1]);
    }
  }

  buffer += decoder.decode();
  if (buffer) {
    const match = /^data:(.*)$/.exec(buffer.replace(/\r$/, ''));
    if (match) data.push(match[1].startsWith(' ') ? match[1].slice(1) : match[1]);
  }
  const payload = flush();
  if (payload !== null) yield payload;
}

export async function readSSEJson(response, onEvent) {
  for await (const raw of iterateSSE(response.body)) {
    if (raw === '[DONE]') break;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (onEvent) onEvent(parsed);
  }
}
