import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveWorkspacePath, toWorkspaceRelative } from '../util/paths.js';
import { isBinaryPath, isProbablyBinary, walkFiles } from '../util/fs.js';
import { createGlobMatcher } from '../util/glob.js';
import { truncate } from '../util/text.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export const grepTool = {
  name: 'grep',
  description:
    'Search file contents with a regular expression (JavaScript syntax). Returns matching lines with file paths and line numbers. Use the include option to limit to certain files, e.g. "*.ts".',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression to search for.' },
      path: { type: 'string', description: 'File or directory to search (default: workspace root).' },
      include: { type: 'string', description: 'Glob filter for files, e.g. "*.js" or "src/**/*.ts".' },
      ignoreCase: { type: 'boolean', description: 'Case-insensitive search.' },
      limit: { type: 'number', description: 'Maximum matching lines (default 100).' },
    },
    required: ['pattern'],
  },
  async run(args, ctx) {
    let regex;
    try {
      regex = new RegExp(args.pattern, args.ignoreCase ? 'i' : '');
    } catch (err) {
      throw new Error(`invalid regular expression: ${err.message}`);
    }
    const base = resolveWorkspacePath(ctx.cwd, args.path || '.', { allowOutside: ctx.allowOutsideWorkspace });
    const includeMatcher = args.include ? createGlobMatcher(args.include) : null;
    const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 1000);
    const results = [];
    let filesScanned = 0;

    const stat = await fs.stat(base).catch(() => null);
    if (!stat) throw new Error(`path not found: ${args.path || '.'}`);

    const files = stat.isDirectory()
      ? walkFiles(base, { signal: ctx.signal })
      : (async function* () { yield base; })();

    for await (const file of files) {
      if (results.length >= limit) break;
      const rel = toWorkspaceRelative(ctx.cwd, file);
      if (includeMatcher && !includeMatcher(toWorkspaceRelative(base, file))) continue;
      if (isBinaryPath(file)) continue;
      const fileStat = await fs.stat(file).catch(() => null);
      if (!fileStat || fileStat.size > MAX_FILE_BYTES) continue;
      const buffer = await fs.readFile(file).catch(() => null);
      if (!buffer || isProbablyBinary(buffer)) continue;
      filesScanned += 1;
      const lines = buffer.toString('utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length && results.length < limit; i++) {
        if (regex.test(lines[i])) {
          const line = lines[i].length > 400 ? `${lines[i].slice(0, 400)}…` : lines[i];
          results.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    if (!results.length) {
      return `No matches for /${args.pattern}/ in ${toWorkspaceRelative(ctx.cwd, base)} (${filesScanned} files scanned).`;
    }
    return truncate(
      `${results.length} match(es) for /${args.pattern}/ (${filesScanned} files scanned):\n${results.join('\n')}`,
      ctx.maxOutputChars || 20000,
    ).text;
  },
};

export default grepTool;
export const name = grepTool.name;
export const description = grepTool.description;
export const parameters = grepTool.parameters;
export const run = grepTool.run;
