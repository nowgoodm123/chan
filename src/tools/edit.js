import fs from 'node:fs/promises';
import { resolveWorkspacePath, toWorkspaceRelative } from '../util/paths.js';

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = 0;
  while (true) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    index = found + needle.length;
  }
  return count;
}

export const editTool = {
  name: 'edit',
  description:
    'Replace an exact string in a file. oldString must match exactly (including whitespace) and be unique unless replaceAll is true. Read the file first with the "read" tool.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, relative to the workspace root.' },
      oldString: { type: 'string', description: 'Exact text to replace. Include enough context to be unique.' },
      newString: { type: 'string', description: 'Replacement text.' },
      replaceAll: { type: 'boolean', description: 'Replace every occurrence (default false).' },
    },
    required: ['path', 'oldString', 'newString'],
  },
  async run(args, ctx) {
    if (typeof args.oldString !== 'string' || !args.oldString.length) {
      throw new Error('oldString must be a non-empty string');
    }
    if (typeof args.newString !== 'string') throw new Error('newString must be a string');
    if (args.oldString === args.newString) throw new Error('oldString and newString are identical');
    const target = resolveWorkspacePath(ctx.cwd, args.path, { allowOutside: ctx.allowOutsideWorkspace });
    const original = await fs.readFile(target, 'utf8').catch(() => {
      throw new Error(`file not found: ${args.path}`);
    });
    const occurrences = countOccurrences(original, args.oldString);
    if (occurrences === 0) {
      throw new Error(`oldString not found in ${args.path}. Read the file again and copy the exact text.`);
    }
    if (occurrences > 1 && !args.replaceAll) {
      throw new Error(
        `oldString appears ${occurrences} times in ${args.path}. Add more surrounding context or set replaceAll=true.`,
      );
    }
    const updated = args.replaceAll
      ? original.split(args.oldString).join(args.newString)
      : original.replace(args.oldString, () => args.newString);
    await fs.writeFile(target, updated, 'utf8');
    return `Edited ${toWorkspaceRelative(ctx.cwd, target)}: ${args.replaceAll ? occurrences : 1} replacement(s).`;
  },
};

export default editTool;
export const name = editTool.name;
export const description = editTool.description;
export const parameters = editTool.parameters;
export const run = editTool.run;
