import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_HOME } from './config.js';
import { firstMeaningfulLine, parseFrontmatter } from './util/frontmatter.js';
import { normalizeSlashes } from './util/paths.js';

const MAX_DEPTH = 4;

export const BUILTIN_AGENTS = [
  {
    name: 'build',
    mode: 'primary',
    description: 'Default coding agent with full tool access.',
    tools: null,
    system: '',
    builtin: true,
  },
  {
    name: 'plan',
    mode: 'primary',
    description: 'Analyze a codebase and propose a plan without editing files.',
    tools: ['read', 'list', 'glob', 'grep', 'webfetch', 'todo_write', 'todo_read'],
    system:
      'You are in plan mode. Investigate the codebase and produce a concrete plan. You cannot edit files or run shell commands in this mode; use read/search tools and report findings with file references.',
    builtin: true,
  },
  {
    name: 'explore',
    mode: 'subagent',
    description: 'Read-only codebase exploration and search. Good for finding code and answering questions.',
    tools: ['read', 'list', 'glob', 'grep', 'webfetch'],
    system: 'You are an exploration subagent. Search and read code, then report concise findings with file:line references. Do not modify files.',
    builtin: true,
  },
  {
    name: 'general',
    mode: 'subagent',
    description: 'General research and multi-step work with full tool access (no further subagents).',
    tools: null,
    system: '',
    builtin: true,
  },
];

function expandHome(dir) {
  if (typeof dir !== 'string') return null;
  if (dir === '~') return os.homedir();
  if (dir.startsWith('~/') || dir.startsWith('~\\')) return path.join(os.homedir(), dir.slice(2));
  return dir;
}

export function agentSources({ cwd, config = {} }) {
  const dirs = [{ dir: path.join(APP_HOME, 'agents'), source: 'global' }];
  for (const extra of config.agents?.dirs || []) {
    const resolved = expandHome(extra);
    if (resolved) dirs.push({ dir: path.resolve(cwd, resolved), source: 'config' });
  }
  dirs.push({ dir: path.join(cwd, '.chan', 'agents'), source: 'project' });
  dirs.push({ dir: path.join(cwd, '.claude', 'agents'), source: 'claude' });
  dirs.push({ dir: path.join(cwd, '.agents', 'agents'), source: 'agents' });
  return dirs;
}

function normalizeMode(value) {
  const mode = typeof value === 'string' ? value.toLowerCase() : 'all';
  return ['primary', 'subagent', 'all'].includes(mode) ? mode : 'all';
}

export function loadAgents({ cwd, config = {} }) {
  const map = new Map(BUILTIN_AGENTS.map((agent) => [agent.name, { ...agent }]));
  for (const { dir, source } of agentSources({ cwd, config })) {
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const walk = (current, prefix, depth) => {
      if (depth > MAX_DEPTH) return;
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full, prefix ? `${prefix}/${entry.name}` : entry.name, depth + 1);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          const relative = prefix ? `${prefix}/${entry.name.slice(0, -3)}` : entry.name.slice(0, -3);
          const name = normalizeSlashes(relative).replace(/\s+/g, '-');
          let raw;
          try {
            raw = fs.readFileSync(full, 'utf8');
          } catch {
            continue;
          }
          const { data, body } = parseFrontmatter(raw);
          const tools = Array.isArray(data.tools)
            ? data.tools.map((tool) => String(tool).trim()).filter(Boolean)
            : typeof data.tools === 'string' && data.tools.trim()
              ? data.tools.split(',').map((tool) => tool.trim()).filter(Boolean)
              : null;
          map.set(name, {
            name,
            mode: normalizeMode(data.mode),
            description:
              typeof data.description === 'string' && data.description.trim()
                ? data.description.trim()
                : firstMeaningfulLine(body),
            model: typeof data.model === 'string' && data.model.trim() ? data.model.trim() : null,
            tools: tools && tools.length ? tools : null,
            system: body.trim(),
            hidden: data.hidden === true,
            steps: Number.isFinite(data.steps) ? data.steps : null,
            source,
            path: full,
            builtin: false,
          });
        }
      }
    };
    walk(dir, '', 0);
  }
  return map;
}

export function resolveAgent(agents, name) {
  if (name && agents.has(name)) return agents.get(name);
  return agents.get('build');
}

export function visibleSubagents(agents) {
  return [...agents.values()].filter((agent) => !agent.hidden && (agent.mode === 'subagent' || agent.mode === 'all'));
}

export function formatAgentsForPrompt(agents) {
  const list = visibleSubagents(agents);
  if (!list.length) return '';
  const lines = [
    'Available subagents. Use the "subagent" tool with { agent, prompt } to delegate isolated work; the subagent returns its final report:',
  ];
  for (const agent of list) lines.push(`- ${agent.name}${agent.description ? `: ${agent.description}` : ''}`);
  return lines.join('\n');
}
