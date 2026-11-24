import { DEFAULT_PERMISSION_RULES, evaluatePermissions, permissionRequestForTool } from '../permissions.js';
import { bashTool } from './bash.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { listTool } from './list.js';
import { readTool } from './read.js';
import { createSkillTool } from './skill.js';
import { subagentTool } from './subagent.js';
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
  skills = null,
  runSubagent = null,
  extraTools = [],
} = {}) {
  const selected = enabled ? ALL_TOOLS.filter((tool) => enabled.includes(tool.name)) : ALL_TOOLS;
  const dynamic = [];
  if (skills?.length) dynamic.push(createSkillTool(skills));
  if (typeof runSubagent === 'function') dynamic.push(subagentTool);
  dynamic.push(...(extraTools || []));
  const all = [...selected, ...dynamic];
  const mode = approvalMode || config.approval || 'auto';
  return all.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    async run(args) {
      const input = args || {};
      const baseContext = {
        cwd,
        session,
        approve,
        signal,
        runSubagent,
        skills,
        approvalMode: mode,
        allowOutsideWorkspace: Boolean(config.allowOutsideWorkspace),
        allowDangerous: Boolean(config.allowDangerous),
        commandTimeoutMs: config.commandTimeoutMs,
        maxOutputChars: config.maxOutputChars,
        env: config.env,
        permissionApproved: false,
      };

      const request = permissionRequestForTool(tool.name, input, cwd);
      let permissionApproved = false;
      if (request) {
        const decision = evaluatePermissions([...DEFAULT_PERMISSION_RULES, ...(config.permissions || [])], request.action, request.resource);
        if (decision?.effect === 'deny') {
          throw new Error(`Permission denied by rule: ${request.action} ${request.resource}`);
        }
        if (decision?.effect === 'ask') {
          if (typeof approve !== 'function') {
            throw new Error(`Approval required for ${request.action} ${request.resource}, but no approval handler is available`);
          }
          const answer = await approve({
            tool: tool.name,
            action: request.action,
            resource: request.resource,
            mode,
            requiresConfirmation: true,
            reason: 'permission rule',
            permission: { action: request.action, resource: request.resource, effect: 'allow' },
          });
          if (!answer?.approved) {
            throw new Error(`Permission denied: ${request.action} ${request.resource}`);
          }
          permissionApproved = true;
        } else if (decision?.effect === 'allow') {
          permissionApproved = true;
        }
      }

      return tool.run(input, { ...baseContext, permissionApproved });
    },
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
