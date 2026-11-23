import fs from 'node:fs/promises';
import { resolveWorkspacePath, toWorkspaceRelative } from '../util/paths.js';
import { walkFiles } from '../util/fs.js';
import { createGlobMatcher, expandBraces } from '../util/glob.js';
import { truncate } from '../util/text.js';

export const globTool = {
  name: 'glob',
  description:
    'Find files by glob pattern, e.g. "**/*.js", "src/**/*.{ts,tsx}", "test/*.test.js". Returns workspace-relative paths sorted by modification time.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern. Supports *, **, ?, [abc] and {a,b}.' },
      path: { type: 'string', description: 'Directory to search in (default: workspace root).' },
      limit: { type: 'number', description: 'Maximum number of matches (default 200).' },
    },
    required: ['pattern'],
  },
  async run(args, ctx) {
    if (!args.pattern) throw new Error('pattern is required');
    const base = resolveWorkspacePath(ctx.cwd, args.path || '.', { allowOutside: ctx.allowOutsideWorkspace });
    const matcher = createGlobMatcher(expandBraces(args.pattern), { dot: true });
    const limit = Math.min(Math.max(Number(args.limit) || 200, 1), 2000);
    const matches = [];
    for await (const file of walkFiles(base, { signal: ctx.signal })) {
      const rel = toWorkspaceRelative(base, file);
      if (!matcher(rel)) continue;
      const stat = await fs.stat(file).catch(() => null);
      matches.push({ rel: toWorkspaceRelative(ctx.cwd, file), mtime: stat ? stat.mtimeMs : 0 });
      if (matches.length >= limit) break;
    }
    matches.sort((a, b) => b.mtime - a.mtime);
    if (!matches.length) return `No files matched "${args.pattern}" under ${toWorkspaceRelative(ctx.cwd, base)}`;
    const list = matches.map((m) => m.rel).join('\n');
    return truncate(`${matches.length} match(es) for "${args.pattern}" in ${toWorkspaceRelative(ctx.cwd, base)}:\n${list}`, ctx.maxOutputChars || 20000).text;
  },
};

export default globTool;
export const name = globTool.name;
export const description = globTool.description;
export const parameters = globTool.parameters;
export const run = globTool.run;
