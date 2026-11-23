import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveWorkspacePath, toWorkspaceRelative } from '../util/paths.js';

export const writeTool = {
  name: 'write',
  description:
    'Create a new file or overwrite an existing file. Prefer the "edit" tool for small changes to existing files. Parent directories are created automatically.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, relative to the workspace root.' },
      content: { type: 'string', description: 'Full file content to write.' },
    },
    required: ['path', 'content'],
  },
  async run(args, ctx) {
    if (typeof args.content !== 'string') throw new Error('content must be a string');
    const target = resolveWorkspacePath(ctx.cwd, args.path, { allowOutside: ctx.allowOutsideWorkspace });
    await fs.mkdir(path.dirname(target), { recursive: true });
    const existed = await fs.stat(target).then((s) => s.isFile()).catch(() => false);
    await fs.writeFile(target, args.content, 'utf8');
    const bytes = Buffer.byteLength(args.content, 'utf8');
    return `${existed ? 'Overwrote' : 'Created'} ${toWorkspaceRelative(ctx.cwd, target)} (${bytes} bytes, ${args.content.split('\n').length} lines).`;
  },
};

export default writeTool;
export const name = writeTool.name;
export const description = writeTool.description;
export const parameters = writeTool.parameters;
export const run = writeTool.run;
