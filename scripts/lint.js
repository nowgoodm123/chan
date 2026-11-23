#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
let checked = 0;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.chan') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

for (const dir of ['bin', 'src', 'test', 'scripts']) {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) continue;
  for (const file of walk(absolute)) {
    checked += 1;
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      problems.push(`${path.relative(root, file)}: ${result.stderr.trim().split('\n')[0]}`);
    }
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const [name, bin] of Object.entries(pkg.bin || {})) {
  if (!fs.existsSync(path.join(root, bin))) problems.push(`package.json bin "${name}" points to missing ${bin}`);
}

for (const required of ['README.md', 'LICENSE', 'site/index.html', 'docs/GETTING_STARTED.md', 'docs/CONFIGURATION.md']) {
  if (!fs.existsSync(path.join(root, required))) problems.push(`missing required file ${required}`);
}

if (problems.length) {
  console.error('lint failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`lint ok: ${checked} JavaScript files checked, ${Object.keys(pkg.bin).length} bin entries verified`);
}
