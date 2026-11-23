import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveWorkspacePath, toWorkspaceRelative } from '../util/paths.js';
import { formatBytes, truncate } from '../util/text.js';

export const listTool = {
  name: 'list',
  description: 'List the entries of a directory in the workspace, with type and size.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path (default: workspace root).' },
      limit: { type: 'number', description: 'Maximum entries (default 200).' },
    },
  },
  async run(args, ctx) {
    const target = resolveWorkspacePath(ctx.cwd, args.path || '.', { allowOutside: ctx.allowOutsideWorkspace });
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) throw new Error(`path not found: ${args.path || '.'}`);
    if (!stat.isDirectory()) {
      return `${toWorkspaceRelative(ctx.cwd, target)} is a file (${formatBytes(stat.size)}).`;
    }
    const entries = await fs.readdir(target, { withFileTypes: true });
    const limit = Math.min(Math.max(Number(args.limit) || 200, 1), 2000);
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const lines = [];
    for (const entry of entries.slice(0, limit)) {
      if (entry.isDirectory()) {
        lines.push(`${entry.name}/`);
      } else {
        const info = await fs.stat(path.join(target, entry.name)).catch(() => null);
        lines.push(`${entry.name}  ${info ? formatBytes(info.size) : ''}`.trimEnd());
      }
    }
    const header = `Directory: ${toWorkspaceRelative(ctx.cwd, target)} (${entries.length} entries)\n`;
    return truncate(header + lines.join('\n'), ctx.maxOutputChars || 20000).text;
  },
};

export default listTool;
export const name = listTool.name;
export const description = listTool.description;
export const parameters = listTool.parameters;
export const run = listTool.run;
