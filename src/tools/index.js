import { bashTool } from './bash.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { listTool } from './list.js';
import { readTool } from './read.js';
import { todoReadTool, todoWriteTool } from './todo.js';
import { webfetchTool } from './webfetch.js';
import { writeTool } from './write.js';

export const ALL_TOOLS = [
  readTool,
  writeTool,
  editTool,
  listTool,
  globTool,
  grepTool,
  bashTool,
  webfetchTool,
  todoWriteTool,
  todoReadTool,
];

export function createTools({
  cwd,
  config = {},
  session = null,
  approve = null,
  signal = null,
  enabled = null,
  approvalMode = null,
} = {}) {
  const selected = enabled ? ALL_TOOLS.filter((tool) => enabled.includes(tool.name)) : ALL_TOOLS;
  return selected.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    run: (args) =>
      tool.run(args || {}, {
        cwd,
        session,
        approve,
        signal,
        approvalMode: approvalMode || config.approval || 'auto',
        allowOutsideWorkspace: Boolean(config.allowOutsideWorkspace),
        allowDangerous: Boolean(config.allowDangerous),
        commandTimeoutMs: config.commandTimeoutMs,
        maxOutputChars: config.maxOutputChars,
        env: config.env,
      }),
  }));
}

export function toolDefinitions(tools) {
  return tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
}

export function describeTools() {
  return ALL_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

export { bashTool, editTool, globTool, grepTool, listTool, readTool, todoReadTool, todoWriteTool, webfetchTool, writeTool };
