import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_PERMISSION_RULES,
  addPermissionRule,
  evaluatePermissions,
  matchPermission,
  permissionRequestForTool,
} from '../src/permissions.js';

test('wildcard permission matching supports * and ?', () => {
  assert.ok(matchPermission('git status *', 'git status --short'));
  assert.ok(matchPermission('git status *', 'git status'));
  assert.ok(matchPermission('*.env', 'config/.env'));
  assert.ok(matchPermission('src/?.js', 'src/a.js'));
  assert.ok(!matchPermission('src/?.js', 'src/ab.js'));
  assert.ok(!matchPermission('git status *', 'git push'));
});

test('permission rules use the last matching rule', () => {
  const rules = [
    { action: 'shell', resource: '*', effect: 'ask' },
    { action: 'shell', resource: 'git status *', effect: 'allow' },
    { action: 'shell', resource: 'git push *', effect: 'deny' },
  ];
  assert.equal(evaluatePermissions(rules, 'shell', 'git status --short').effect, 'allow');
  assert.equal(evaluatePermissions(rules, 'shell', 'git push origin main').effect, 'deny');
  assert.equal(evaluatePermissions(rules, 'shell', 'npm test').effect, 'ask');
  assert.equal(evaluatePermissions(rules, 'read', 'src/a.js'), null);
});

test('default rules ask before reading .env files', () => {
  assert.equal(evaluatePermissions(DEFAULT_PERMISSION_RULES, 'read', '.env').effect, 'ask');
  assert.equal(evaluatePermissions(DEFAULT_PERMISSION_RULES, 'read', 'apps/web/.env.local').effect, 'ask');
  assert.equal(evaluatePermissions(DEFAULT_PERMISSION_RULES, 'read', '.env.example').effect, 'allow');
  assert.equal(evaluatePermissions(DEFAULT_PERMISSION_RULES, 'read', 'src/app.js'), null);
});

test('tool requests map to actions and workspace-relative resources', () => {
  const cwd = path.resolve(os.tmpdir(), 'chan-perm');
  assert.deepEqual(permissionRequestForTool('read', { path: 'src/a.js' }, cwd), { action: 'read', resource: 'src/a.js' });
  assert.deepEqual(permissionRequestForTool('bash', { command: 'npm test' }, cwd), { action: 'shell', resource: 'npm test' });
  assert.deepEqual(permissionRequestForTool('webfetch', { url: 'https://example.com' }, cwd), {
    action: 'webfetch',
    resource: 'https://example.com',
  });
  assert.deepEqual(permissionRequestForTool('skill', { id: 'release' }, cwd), { action: 'skill', resource: 'release' });
  assert.deepEqual(permissionRequestForTool('subagent', { agent: 'explore' }, cwd), { action: 'subagent', resource: 'explore' });
  assert.deepEqual(permissionRequestForTool('fake_tool', {}, cwd), { action: 'fake_tool', resource: '*' });
  const outside = permissionRequestForTool('read', { path: '../outside.txt' }, cwd);
  assert.equal(outside.action, 'read');
  assert.ok(outside.resource.includes('outside.txt'));
});

test('addPermissionRule appends unique rules', () => {
  const config = {};
  assert.equal(addPermissionRule(config, { action: 'shell', resource: 'git status *', effect: 'allow' }), true);
  assert.equal(addPermissionRule(config, { action: 'shell', resource: 'git status *', effect: 'allow' }), false);
  assert.equal(config.permissions.length, 1);
});
