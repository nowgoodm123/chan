import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderSlashMenu, slashCompletions, SLASH_COMMANDS } from '../src/cli/palette.js';

test('slash commands are unique and include session/connect', () => {
  const names = SLASH_COMMANDS.map((entry) => entry.command);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('/session'));
  assert.ok(names.includes('/connect'));
  assert.ok(names.includes('/help'));
});

test('renderSlashMenu aligns commands and hides aliases by default', () => {
  const menu = renderSlashMenu();
  assert.match(menu, /\/session/);
  assert.match(menu, /\/connect/);
  assert.match(menu, /manage sessions/);
  assert.doesNotMatch(menu, /\/login/);
  const all = renderSlashMenu({ all: true });
  assert.match(all, /\/login/);
});

test('slashCompletions completes commands and arguments', () => {
  const [commands] = slashCompletions('/co');
  assert.ok(commands.includes('/connect'));
  assert.ok(commands.includes('/config'));

  const [sessionSubs] = slashCompletions('/session ');
  assert.deepEqual(sessionSubs, ['list', 'new', 'resume', 'delete', 'fork', 'export', 'compact', 'rename', 'show']);

  const [providers] = slashCompletions('/connect de', { providers: ['deepseek', 'openai'] });
  assert.deepEqual(providers, ['deepseek']);

  const [approval] = slashCompletions('/approval a');
  assert.ok(approval.includes('ask'));
  assert.ok(approval.includes('auto'));

  const [attachments] = slashCompletions('/attach er', { files: ['error.png', 'logo.png'] });
  assert.deepEqual(attachments, ['error.png']);

  const [none, line] = slashCompletions('/model x');
  assert.deepEqual(none, []);
  assert.equal(line, '/model x');
});
