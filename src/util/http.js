const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export async function fetchWithRetry(url, options = {}, { retries = 2, baseDelayMs = 700 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastError = err;
      if (attempt < retries) {
        await delay(baseDelayMs * 2 ** attempt, options.signal);
        continue;
      }
      throw new Error(`network error contacting ${url}: ${err.message}`);
    }
    if (response.ok || !RETRYABLE.has(response.status) || attempt === retries) {
      return response;
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * 2 ** attempt;
    try {
      await response.arrayBuffer();
    } catch {
      /* ignore */
    }
    await delay(wait, options.signal);
  }
  throw lastError || new Error('request failed');
}

export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function abortError() {
  const err = new Error('request aborted');
  err.name = 'AbortError';
  return err;
}

export async function ensureOk(response, label) {
  if (response.ok) return response;
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  const snippet = body.replace(/\s+/g, ' ').slice(0, 600);
  const hints = {
    401: ' (invalid API key — check your provider config or environment variable)',
    403: ' (access denied — the key may lack permission for this model)',
    404: ' (endpoint or model not found — check baseUrl and model name)',
    429: ' (rate limited — retry later or switch providers)',
  };
  const hint = hints[response.status] || '';
  throw new Error(`${label} request failed: HTTP ${response.status}${hint}${snippet ? `: ${snippet}` : ''}`);
}

export function mergeSignals(signals) {
  const list = signals.filter(Boolean);
  if (list.length === 1) return list[0];
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(list);
  }
  return list[0];
}
