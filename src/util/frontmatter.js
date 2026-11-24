export function parseFrontmatter(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!source.startsWith('---\n')) return { data: {}, body: source };
  const end = source.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: source };
  const after = source.slice(end + 4);
  if (after && !after.startsWith('\n')) return { data: {}, body: source };
  const body = after.startsWith('\n') ? after.slice(1) : after;
  const data = {};
  for (const rawLine of source.slice(4, end).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    if (!key) continue;
    let value = line.slice(index + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    } else if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      value = Number(value);
    }
    data[key] = value;
  }
  return { data, body };
}

export function firstMeaningfulLine(text, max = 160) {
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.replace(/^#+\s*/, '').trim();
    if (trimmed) return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
  }
  return '';
}
