import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createTools, describeTools } from '../src/tools/index.js';
import { findDangerousCommand } from '../src/tools/bash.js';
import { createGlobMatcher, globToRegExp } from '../src/util/glob.js';

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chan-tools-'));
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.js'), 'const needle = 1;\nconsole.log(needle);\n');
  fs.writeFileSync(path.join(dir, 'b.ts'), 'export const x: number = 1;\n');
  fs.writeFileSync(path.join(dir, 'sub', 'c.js'), '// needle here\n');
  fs.writeFileSync(path.join(dir, 'node_modules', 'ignored.js'), 'needle\n');
  return dir;
}

function tools(cwd, overrides = {}) {
  const { session = null, approve = null, signal = null, ...config } = overrides;
  const list = createTools({
    cwd,
    config: { maxOutputChars: 20000, commandTimeoutMs: 30000, ...config },
    session,
    approve,
    signal,
  });
  return Object.fromEntries(list.map((tool) => [tool.name, tool]));
}

test('tool registry exposes unique, documented tools', () => {
  const names = describeTools().map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  for (const tool of describeTools()) {
    assert.ok(tool.description.length > 10, `${tool.name} needs a description`);
    assert.equal(tool.parameters.type, 'object');
  }
  assert.ok(names.includes('bash'));
  assert.ok(names.includes('read'));
});

test('write + read + list roundtrip with numbered lines', async () => {
  const cwd = workspace();
  const t = tools(cwd);
  await t.write.run({ path: 'notes/hello.txt', content: 'line one\nline two\nline three\n' });
  const read = await t.read.run({ path: 'notes/hello.txt' });
  assert.match(read, /1: line one/);
  assert.match(read, /3: line three/);
  assert.match(read, /3 lines total/);
  const listed = await t.list.run({ path: 'notes' });
  assert.match(listed, /hello\.txt/);
});

test('read supports offsets and rejects directories', async () => {
  const cwd = workspace();
  const t = tools(cwd);
  const read = await t.read.run({ path: 'a.js', offset: 2, limit: 1 });
  assert.match(read, /2: console\.log/);
  assert.doesNotMatch(read, /1: const/);
  await assert.rejects(t.read.run({ path: 'sub' }), /is a directory/);
});

test('write refuses paths outside the workspace', async () => {
  const cwd = workspace();
  const t = tools(cwd);
  await assert.rejects(t.write.run({ path: '../escape.txt', content: 'x' }), /outside the workspace/);
  await assert.rejects(t.read.run({ path: path.join(os.tmpdir(), 'nope') }), /outside the workspace/);
});

test('edit replaces unique strings, refuses ambiguity and misses', async () => {
  const cwd = workspace();
  const t = tools(cwd);
  await t.write.run({ path: 'edit.txt', content: 'alpha beta gamma\n' });
  const result = await t.edit.run({ path: 'edit.txt', oldString: 'beta', newString: 'BETA' });
  assert.match(result, /1 replacement/);
  assert.match(await t.read.run({ path: 'edit.txt' }), /alpha BETA gamma/);
  await assert.rejects(t.edit.run({ path: 'edit.txt', oldString: 'nope', newString: 'x' }), /not found/);
  await t.write.run({ path: 'dup.txt', content: 'x\nx\n' });
  await assert.rejects(t.edit.run({ path: 'dup.txt', oldString: 'x', newString: 'y' }), /appears 2 times/);
  await t.edit.run({ path: 'dup.txt', oldString: 'x', newString: 'y', replaceAll: true });
  assert.equal(fs.readFileSync(path.join(cwd, 'dup.txt'), 'utf8'), 'y\ny\n');
});

test('glob matcher supports **, *, braces and ignores dotfiles by default', () => {
  assert.ok(globToRegExp('**/*.js').test('src/app.js'));
  assert.ok(globToRegExp('**/*.js').test('app.js'));
  assert.ok(!globToRegExp('**/*.js').test('src/app.ts'));
  assert.ok(createGlobMatcher('src/**/*.{ts,tsx}')('src/components/Button.tsx'));
  assert.ok(!createGlobMatcher('*.js')('.hidden.js'));
  assert.ok(createGlobMatcher('*.js', { dot: true })('.hidden.js'));
});

test('glob tool finds files and skips heavy directories', async () => {
  const cwd = workspace();
  const t = tools(cwd);
  const found = await t.glob.run({ pattern: '**/*.js' });
  assert.match(found, /a\.js/);
  assert.match(found, /sub\/c\.js/);
  assert.doesNotMatch(found, /node_modules/);
});

test('grep searches content with include filters', async () => {
  const cwd = workspace();
  const t = tools(cwd);
  const result = await t.grep.run({ pattern: 'needle' });
  assert.match(result, /a\.js:1: const needle = 1;/);
  assert.match(result, /sub\/c\.js:1:/);
  assert.doesNotMatch(result, /node_modules/);
  const filtered = await t.grep.run({ pattern: 'needle', include: 'a.*' });
  assert.match(filtered, /a\.js/);
  assert.doesNotMatch(filtered, /sub\/c\.js/);
  await assert.rejects(t.grep.run({ pattern: '[' }), /invalid regular expression/);
});

test('bash runs commands, captures exit codes and blocks dangerous input', async () => {
  const cwd = workspace();
  const t = tools(cwd);
  const ok = await t.bash.run({ command: 'node -e "console.log(\'from-node\')"' });
  assert.match(ok, /from-node/);
  assert.match(ok, /status: success/);
  const failing = await t.bash.run({ command: 'node -e "process.exit(3)"' });
  assert.match(failing, /exit code 3/);
  assert.ok(findDangerousCommand('rm -rf /'));
  assert.ok(findDangerousCommand('git push --force origin main'));
  assert.equal(findDangerousCommand('npm test'), null);
  await assert.rejects(t.bash.run({ command: 'rm -rf /' }), /blocked|refused/);
});

test('todo tools update the session todo list', async () => {
  const cwd = workspace();
  const session = { todos: [] };
  const t = tools(cwd, { session });
  const output = await t.todo_write.run({
    todos: [
      { content: 'write code', status: 'completed' },
      { content: 'run tests', status: 'in_progress' },
    ],
  });
  assert.match(output, /\[x\] write code/);
  assert.match(output, /\[~\] run tests/);
  assert.equal(session.todos.length, 2);
  const read = await t.todo_read.run({});
  assert.match(read, /1 remaining \/ 2 total/);
  await assert.rejects(t.todo_write.run({ todos: [{ content: 'x', status: 'bogus' }] }), /invalid status/);
});

test('permission rules gate tools and can require approval', async () => {
  const cwd = workspace();
  fs.writeFileSync(path.join(cwd, 'secret.txt'), 'classified');
  fs.writeFileSync(path.join(cwd, '.env'), 'API_KEY=1');

  const denied = tools(cwd, { permissions: [{ action: 'read', resource: 'secret.txt', effect: 'deny' }] });
  await assert.rejects(denied.read.run({ path: 'secret.txt' }), /Permission denied by rule/);

  let approvals = 0;
  const asking = tools(cwd, {
    permissions: [{ action: 'read', resource: 'secret.txt', effect: 'ask' }],
    approve: async (request) => {
      approvals += 1;
      assert.equal(request.action, 'read');
      assert.equal(request.resource, 'secret.txt');
      return { approved: true };
    },
  });
  assert.match(await asking.read.run({ path: 'secret.txt' }), /classified/);
  assert.equal(approvals, 1);

  const rejecting = tools(cwd, {
    permissions: [{ action: 'read', resource: 'secret.txt', effect: 'ask' }],
    approve: async () => ({ approved: false }),
  });
  await assert.rejects(rejecting.read.run({ path: 'secret.txt' }), /Permission denied:/);

  assert.match(await tools(cwd, { approve: async () => ({ approved: true }) }).read.run({ path: '.env' }), /API_KEY/);
  await assert.rejects(tools(cwd).read.run({ path: '.env' }), /Approval required/);
});

test('shell permission rules can allow or deny commands', async () => {
  const cwd = workspace();
  const allowed = tools(cwd, {
    approval: 'ask',
    permissions: [{ action: 'shell', resource: 'node *', effect: 'allow' }],
    approve: async () => {
      throw new Error('approval should not be requested');
    },
  });
  const output = await allowed.bash.run({ command: 'node -e "console.log(7)"' });
  assert.match(output, /status: success/);
  assert.match(output, /7/);

  const denied = tools(cwd, {
    permissions: [{ action: 'shell', resource: 'git push *', effect: 'deny' }],
  });
  await assert.rejects(denied.bash.run({ command: 'git push origin main' }), /Permission denied by rule/);

  const askDenied = tools(cwd, {
    permissions: [{ action: 'shell', resource: 'echo *', effect: 'ask' }],
    approve: async () => ({ approved: false }),
  });
  await assert.rejects(askDenied.bash.run({ command: 'echo hi' }), /Permission denied: shell echo hi/);
});

test('webfetch converts HTML to text', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><head><title>t</title><script>bad()</script></head><body><h1>Hello</h1><p>World &amp; friends</p></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const cwd = workspace();
    const t = tools(cwd);
    const output = await t.webfetch.run({ url: `http://127.0.0.1:${port}/` });
    assert.match(output, /Hello/);
    assert.match(output, /World & friends/);
    assert.doesNotMatch(output, /bad\(\)/);
    await assert.rejects(t.webfetch.run({ url: 'file:///etc/passwd' }), /only http and https/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
