import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { APP_HOME } from './config.js';
import { firstMeaningfulLine, parseFrontmatter } from './util/frontmatter.js';
import { normalizeSlashes } from './util/paths.js';

const MAX_DEPTH = 6;

function expandHome(dir) {
  if (typeof dir !== 'string') return null;
  if (dir === '~') return os.homedir();
  if (dir.startsWith('~/') || dir.startsWith('~\\')) return path.join(os.homedir(), dir.slice(2));
  return dir;
}

export function commandSources({ cwd, config = {} }) {
  const dirs = [{ dir: path.join(APP_HOME, 'commands'), source: 'global' }];
  for (const extra of config.commands?.dirs || []) {
    const resolved = expandHome(extra);
    if (resolved) dirs.push({ dir: path.resolve(cwd, resolved), source: 'config' });
  }
  dirs.push({ dir: path.join(cwd, '.chan', 'commands'), source: 'project' });
  dirs.push({ dir: path.join(cwd, '.claude', 'commands'), source: 'claude' });
  dirs.push({ dir: path.join(cwd, '.agents', 'commands'), source: 'agents' });
  return dirs;
}

export function loadCommands({ cwd, config = {} }) {
  const map = new Map();
  for (const { dir, source } of commandSources({ cwd, config })) {
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
          const id = normalizeSlashes(relative).replace(/\s+/g, '-');
          let raw;
          try {
            raw = fs.readFileSync(full, 'utf8');
          } catch {
            continue;
          }
          const { data, body } = parseFrontmatter(raw);
          const template = body.trim();
          if (!template) continue;
          map.set(id, {
            name: id,
            description:
              typeof data.description === 'string' && data.description.trim()
                ? data.description.trim()
                : firstMeaningfulLine(template),
            agent: typeof data.agent === 'string' ? data.agent : null,
            model: typeof data.model === 'string' ? data.model : null,
            subagent: data.subagent === true || data.subtask === true,
            template,
            source,
            path: full,
          });
        }
      }
    };
    walk(dir, '', 0);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function splitArgs(input) {
  const text = String(input || '').trim();
  if (!text) return [];
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function shellFor(platform) {
  if (platform === 'win32') {
    return {
      file: process.env.CHAN_SHELL || 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'],
    };
  }
  return { file: process.env.CHAN_SHELL || (fs.existsSync('/bin/bash') ? '/bin/bash' : 'sh'), args: ['-lc'] };
}

export function runShellBlock(command, cwd) {
  const shell = shellFor(process.platform);
  const result = spawnSync(shell.file, [...shell.args, command], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new Error(`command shell block failed: ${result.error.message}`);
  const output = `${result.stdout || ''}${result.stderr ? `\n${result.stderr}` : ''}`.trim();
  return output || `(no output, exit ${result.status ?? '?'})`;
}

export async function expandCommand(command, rawArgs = '', { cwd = process.cwd() } = {}) {
  const template = command.template;
  const args = splitArgs(rawArgs);
  let body = template;

  if (body.includes('$ARGUMENTS')) {
    body = body.split('$ARGUMENTS').join(rawArgs);
  }

  let highest = 0;
  for (let i = 1; i <= 9; i++) {
    if (body.includes(`$${i}`)) highest = i;
  }
  if (highest > 0) {
    for (let i = 1; i <= highest; i++) {
      const value = i === highest ? args.slice(i - 1).join(' ') : args[i - 1] || '';
      body = body.split(`$${i}`).join(value);
    }
  } else if (!template.includes('$ARGUMENTS') && rawArgs.trim()) {
    body = `${body}\n\n${rawArgs}`;
  }

  const shellPattern = /!`([^`]+)`/g;
  const matches = [...body.matchAll(shellPattern)];
  for (const match of matches) {
    const output = runShellBlock(match[1], cwd);
    body = body.replace(match[0], output);
  }
  return body.trim();
}

export function formatCommandsForPrompt(commands) {
  if (!commands.length) return '';
  return commands.map((command) => `/${command.name} — ${command.description}`).join('\n');
}
