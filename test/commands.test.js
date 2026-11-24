import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { expandCommand, loadCommands, splitArgs } from '../src/commands.js';

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chan-commands-'));
}

test('splitArgs respects single and double quotes', () => {
  assert.deepEqual(splitArgs('src/a.ts "error handling" \'two words\''), ['src/a.ts', 'error handling', 'two words']);
  assert.deepEqual(splitArgs('   '), []);
});

test('loadCommands discovers project and nested commands with metadata', () => {
  const cwd = workspace();
  fs.mkdirSync(path.join(cwd, '.chan', 'commands', 'team'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.chan', 'commands', 'review.md'),
    '---\ndescription: Review changes\nagent: plan\nmodel: openai/gpt-4o-mini\n---\nReview $ARGUMENTS. Report bugs.\n',
  );
  fs.writeFileSync(
    path.join(cwd, '.chan', 'commands', 'team', 'audit.md'),
    '---\ndescription: Audit package\nsubagent: true\n---\nAudit $1 for issues.\n',
  );
  const commands = loadCommands({ cwd, config: {} });
  assert.equal(commands.length, 2);
  const review = commands.find((command) => command.name === 'review');
  assert.equal(review.description, 'Review changes');
  assert.equal(review.agent, 'plan');
  assert.equal(review.model, 'openai/gpt-4o-mini');
  assert.equal(review.subagent, false);
  const audit = commands.find((command) => command.name === 'team/audit');
  assert.equal(audit.subagent, true);
  assert.equal(audit.agent, null);
});

test('expandCommand substitutes arguments and appends when no placeholder exists', async () => {
  const cwd = workspace();
  const review = {
    template: 'Review $1. Focus on $2.',
  };
  assert.equal(await expandCommand(review, 'src/auth.ts "error handling"', { cwd }), 'Review src/auth.ts. Focus on error handling.');

  const rest = { template: 'Compare $1 with $2.' };
  assert.equal(await expandCommand(rest, 'api stable branch', { cwd }), 'Compare api with stable branch.');

  const raw = { template: 'Review $ARGUMENTS now.' };
  assert.equal(await expandCommand(raw, 'src/a.ts --strict', { cwd }), 'Review src/a.ts --strict now.');

  const append = { template: 'Explain this code.' };
  assert.equal(await expandCommand(append, 'src/cache.ts', { cwd }), 'Explain this code.\n\nsrc/cache.ts');
});

test('expandCommand runs shell blocks', async () => {
  const cwd = workspace();
  const command = {
    template: 'Output: !`node -e "console.log(\'shell-ok\')"`',
  };
  const expanded = await expandCommand(command, '', { cwd });
  assert.match(expanded, /Output: shell-ok/);
});
