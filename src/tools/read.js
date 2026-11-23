import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveWorkspacePath, toWorkspaceRelative } from '../util/paths.js';
import { isBinaryPath, isProbablyBinary } from '../util/fs.js';
import { truncate } from '../util/text.js';

export const readTool = {
  name: 'read',
  description:
    'Read a text file from the workspace. Returns numbered lines. Use offset/limit for large files. Always read a file before editing it.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, relative to the workspace root.' },
      offset: { type: 'number', description: '1-based line number to start reading from.' },
      limit: { type: 'number', description: 'Maximum number of lines to return (default 2000).' },
    },
    required: ['path'],
  },
  async run(args, ctx) {
    const target = resolveWorkspacePath(ctx.cwd, args.path, { allowOutside: ctx.allowOutsideWorkspace });
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) throw new Error(`file not found: ${args.path}`);
    if (stat.isDirectory()) {
      throw new Error(`${args.path} is a directory — use the "list" tool instead`);
    }
    if (isBinaryPath(target)) {
      return `[binary file] ${toWorkspaceRelative(ctx.cwd, target)} (${stat.size} bytes). Binary contents are not readable as text. If this is an image, attach it in the browser UI so a vision-capable model can see it.`;
    }
    const buffer = await fs.readFile(target);
    if (isProbablyBinary(buffer)) {
      return `[binary file] ${toWorkspaceRelative(ctx.cwd, target)} (${stat.size} bytes).`;
    }
    const text = buffer.toString('utf8').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const offset = Math.max(1, Math.floor(Number(args.offset) || 1));
    const limit = Math.max(1, Math.floor(Number(args.limit) || 2000));
    const selected = lines.slice(offset - 1, offset - 1 + limit);
    if (!selected.length) {
      return `[${toWorkspaceRelative(ctx.cwd, target)}] no lines at offset ${offset} (file has ${lines.length} lines)`;
    }
    const width = String(offset + selected.length - 1).length;
    const body = selected
      .map((line, index) => `${String(offset + index).padStart(width, ' ')}: ${line}`)
      .join('\n');
    const header = `File: ${toWorkspaceRelative(ctx.cwd, target)} (${lines.length} lines total${lines.length > offset - 1 + selected.length ? `, showing ${offset}-${offset + selected.length - 1}` : ''})\n`;
    return truncate(header + body, ctx.maxOutputChars || 20000).text;
  },
};

export default readTool;
export const name = readTool.name;
export const description = readTool.description;
export const parameters = readTool.parameters;
export const run = readTool.run;
