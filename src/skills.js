import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_HOME } from './config.js';
import { firstMeaningfulLine, parseFrontmatter } from './util/frontmatter.js';
import { normalizeSlashes } from './util/paths.js';

const MAX_DEPTH = 6;
const MAX_FILES = 20;

function expandHome(dir) {
  if (typeof dir !== 'string') return null;
  if (dir === '~') return os.homedir();
  if (dir.startsWith('~/') || dir.startsWith('~\\')) return path.join(os.homedir(), dir.slice(2));
  return dir;
}

export function skillSources({ cwd, config = {} }) {
  const dirs = [];
  dirs.push({ dir: path.join(APP_HOME, 'skills'), source: 'global' });
  for (const extra of config.skills?.dirs || []) {
    const resolved = expandHome(extra);
    if (resolved) dirs.push({ dir: path.resolve(cwd, resolved), source: 'config' });
  }
  dirs.push({ dir: path.join(cwd, '.chan', 'skills'), source: 'project' });
  dirs.push({ dir: path.join(cwd, '.claude', 'skills'), source: 'claude' });
  dirs.push({ dir: path.join(cwd, '.agents', 'skills'), source: 'agents' });
  return dirs.filter((entry) => entry.dir);
}

function listSupportingFiles(dir, skillFile, depth = 0) {
  if (depth > 3) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSupportingFiles(full, skillFile, depth + 1));
    } else if (entry.isFile() && full !== skillFile) {
      files.push(normalizeSlashes(path.relative(path.dirname(skillFile), full)));
    }
    if (files.length >= MAX_FILES) break;
  }
  return files.slice(0, MAX_FILES);
}

function registerSkill(map, { file, id, source, dir }) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  const { data, body } = parseFrontmatter(raw);
  const cleanId = normalizeSlashes(id).replace(/^\/+|\/+$/g, '').replace(/\.md$/i, '').replace(/\s+/g, '-');
  if (!cleanId) return;
  const description =
    typeof data.description === 'string' && data.description.trim()
      ? data.description.trim()
      : firstMeaningfulLine(body, 200);
  const hidden = data['disable-model-invocation'] === true || data['opencode/autoinvoke'] === false;
  map.set(cleanId, {
    id: cleanId,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : cleanId,
    description,
    body: body.trim(),
    dir,
    files: listSupportingFiles(dir, file),
    source,
    path: file,
    hidden: Boolean(hidden),
  });
}

function scanSource(rootDir, source, map) {
  let stat;
  try {
    stat = fs.statSync(rootDir);
  } catch {
    return;
  }
  if (!stat.isDirectory()) return;

  const walk = (dir, prefix, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nestedPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
        const skillFile = path.join(full, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          registerSkill(map, { file: skillFile, id: nestedPrefix, source, dir: full });
        } else {
          walk(full, nestedPrefix, depth + 1);
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && depth === 0) {
        const id = entry.name.slice(0, -3);
        registerSkill(map, { file: full, id, source, dir });
      }
    }
  };

  walk(rootDir, '', 0);
}

export function loadSkills({ cwd, config = {} }) {
  const map = new Map();
  for (const entry of skillSources({ cwd, config })) {
    scanSource(entry.dir, entry.source, map);
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function findSkill(skills, id) {
  if (!id) return null;
  return skills.find((skill) => skill.id === id) || null;
}

export function formatSkillsForPrompt(skills) {
  const visible = (skills || []).filter((skill) => !skill.hidden && skill.description);
  if (!visible.length) return '';
  const lines = [
    'Available skills. When a skill matches the task, call the "skill" tool with its id to load full instructions before acting:',
  ];
  for (const skill of visible) lines.push(`- ${skill.id}: ${skill.description}`);
  return lines.join('\n');
}
