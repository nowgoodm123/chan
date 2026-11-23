import { mergeSignals } from '../util/http.js';
import { htmlToText, truncate } from '../util/text.js';

const MAX_BYTES = 2 * 1024 * 1024;

export const webfetchTool = {
  name: 'webfetch',
  description:
    'Fetch a URL and return its content as text. HTML is converted to plain text. Useful for reading documentation, issues and API references.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'http(s) URL to fetch.' },
      format: { type: 'string', enum: ['text', 'html'], description: 'Return plain text (default) or raw HTML.' },
      timeoutMs: { type: 'number', description: 'Request timeout in milliseconds (default 30000).' },
    },
    required: ['url'],
  },
  async run(args, ctx) {
    let url;
    try {
      url = new URL(args.url);
    } catch {
      throw new Error(`invalid URL: ${args.url}`);
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('only http and https URLs are supported');
    }
    const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 30000, 1000), 120000);
    const signal = mergeSignals([ctx.signal, AbortSignal.timeout(timeoutMs)]);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; chan_code/0.1; +https://github.com/nowgoodm123/chan_code)',
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5',
      },
      redirect: 'follow',
      signal,
    });
    if (!response.ok) throw new Error(`fetch failed: HTTP ${response.status} ${response.statusText}`);

    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error(`response too large (${buffer.length} bytes, limit ${MAX_BYTES})`);
    const raw = buffer.toString('utf8');

    let body = raw;
    if (args.format !== 'html') {
      if (contentType.includes('json')) {
        try {
          body = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          body = raw;
        }
      } else if (contentType.includes('html') || /^\s*<!doctype html/i.test(raw)) {
        body = htmlToText(raw);
      }
    }
    const out = truncate(body, ctx.maxOutputChars || 20000);
    return `URL: ${response.url || url.href}\nStatus: ${response.status}\nContent-Type: ${contentType || 'unknown'}\n\n${out.text}`;
  },
};

export default webfetchTool;
export const name = webfetchTool.name;
export const description = webfetchTool.description;
export const parameters = webfetchTool.parameters;
export const run = webfetchTool.run;
