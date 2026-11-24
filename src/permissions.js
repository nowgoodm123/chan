import path from 'node:path';
import { normalizeSlashes } from './util/paths.js';

const SPECIAL = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

export const DEFAULT_PERMISSION_RULES = [
  { action: 'read', resource: '*.env', effect: 'ask' },
  { action: 'read', resource: '*.env.*', effect: 'ask' },
  { action: 'read', resource: '*.env.example', effect: 'allow' },
];

export function wildcardToRegExp(pattern, { caseInsensitive = process.platform === 'win32' } = {}) {
  let source = '';
  for (const char of String(pattern ?? '*')) {
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
    else if (SPECIAL.has(char)) source += `\\${char}`;
    else source += char;
  }
  return new RegExp(`^${source}$`, caseInsensitive ? 'i' : '');
}

export function matchPermission(pattern, value, options = {}) {
  const text = String(value ?? '');
  const source = String(pattern ?? '*');
  if (source.endsWith(' *') && source.slice(0, -2) === text) return true;
  return wildcardToRegExp(source, options).test(text);
}

export function evaluatePermissions(rules, action, resource) {
  let decision = null;
  for (const rule of rules || []) {
    if (!rule || !rule.action || !rule.effect) continue;
    if (!['allow', 'ask', 'deny'].includes(rule.effect)) continue;
    if (!matchPermission(rule.action, action)) continue;
    if (!matchPermission(rule.resource ?? '*', resource)) continue;
    decision = rule;
  }
  return decision;
}

export function normalizeResourcePath(cwd, value) {
  if (!value || typeof value !== 'string') return '.';
  const cleaned = value.trim();
  const absolute = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(cwd, cleaned);
  const relative = path.relative(cwd, absolute);
  if (relative === '') return '.';
  if (relative.startsWith('..') || path.isAbsolute(relative)) return normalizeSlashes(absolute);
  return normalizeSlashes(relative);
}

export function permissionRequestForTool(name, args = {}, cwd = process.cwd()) {
  switch (name) {
    case 'read':
    case 'list':
    case 'glob':
    case 'grep':
      return { action: 'read', resource: normalizeResourcePath(cwd, args.path || '.') };
    case 'write':
    case 'edit':
      return { action: 'edit', resource: normalizeResourcePath(cwd, args.path || '.') };
    case 'bash':
      return { action: 'shell', resource: String(args.command || '') };
    case 'webfetch':
      return { action: 'webfetch', resource: String(args.url || '') };
    case 'skill':
      return { action: 'skill', resource: String(args.id || '') };
    case 'subagent':
      return { action: 'subagent', resource: String(args.agent || '') };
    default:
      return { action: name, resource: '*' };
  }
}

export function addPermissionRule(config, rule) {
  if (!rule || !rule.action || !rule.effect) return false;
  if (!Array.isArray(config.permissions)) config.permissions = [];
  const exists = config.permissions.some(
    (item) => item.action === rule.action && item.resource === rule.resource && item.effect === rule.effect,
  );
  if (exists) return false;
  config.permissions.push({
    action: rule.action,
    resource: rule.resource ?? '*',
    effect: rule.effect,
  });
  return true;
}

export function describeRule(rule) {
  return `${rule.action} ${rule.resource ?? '*'} -> ${rule.effect}`;
}
