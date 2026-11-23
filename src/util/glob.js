export function expandBraces(pattern) {
  const match = /\{([^{}]*)\}/.exec(pattern);
  if (!match) return [pattern];
  const [whole, body] = match;
  const options = body.split(',');
  const results = [];
  for (const option of options) {
    results.push(...expandBraces(pattern.replace(whole, option)));
  }
  return results;
}

export function globToRegExp(pattern, { dot = false } = {}) {
  const normalized = String(pattern).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  let source = '';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === '*') {
      if (normalized[i + 1] === '*') {
        i += 1;
        if (normalized[i + 1] === '/') {
          i += 1;
          source += '(?:[^/]+/)*';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '[') {
      const end = normalized.indexOf(']', i + 1);
      if (end > i) {
        let cls = normalized.slice(i + 1, end);
        if (cls.startsWith('!')) cls = `^${cls.slice(1)}`;
        source += `[${cls}]`;
        i = end;
      } else {
        source += '\\[';
      }
    } else if ('.+^$()|{}\\'.includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  const prefix = dot ? '' : '(?!\\.)';
  return new RegExp(`^${prefix}${source}$`);
}

export function createGlobMatcher(patterns, options = {}) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  const regexps = list.flatMap((p) => expandBraces(p)).map((p) => globToRegExp(p, options));
  return (filePath) => {
    const normalized = String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
    return regexps.some((re) => re.test(normalized));
  };
}
