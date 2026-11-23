import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chan-config-'));
process.env.CHAN_HOME = home;

const {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  PROVIDER_PRESETS,
  deepMerge,
  getProviderConfig,
  initConfig,
  listProviders,
  loadConfig,
  redactConfig,
  resolveSecret,
  saveConfig,
  setConfigValue,
} = await import('../src/config.js');

test('default config contains presets and sane defaults', () => {
  assert.equal(DEFAULT_CONFIG.agent.approval, 'auto');
  assert.ok(DEFAULT_CONFIG.providers.deepseek);
  assert.ok(PROVIDER_PRESETS.anthropic);
  assert.equal(PROVIDER_PRESETS.anthropic.type, 'anthropic');
});

test('deepMerge merges nested objects without mutating inputs', () => {
  const base = { a: 1, nested: { x: 1, y: 2 } };
  const merged = deepMerge(base, { nested: { y: 3 }, b: 2 });
  assert.deepEqual(merged, { a: 1, nested: { x: 1, y: 3 }, b: 2 });
  assert.equal(base.nested.y, 2);
});

test('resolveSecret resolves env: references', () => {
  assert.equal(resolveSecret('env:MY_SECRET', { MY_SECRET: 'abc' }), 'abc');
  assert.equal(resolveSecret('env:MISSING', {}), '');
  assert.equal(resolveSecret('literal-key'), 'literal-key');
});

test('environment overrides win over file config', () => {
  const config = loadConfig({
    cwd: home,
    includeProject: false,
    env: { CHAN_PROVIDER: 'openai', CHAN_MODEL: 'gpt-x', CHAN_PORT: '5000', CHAN_APPROVAL: 'ask' },
  });
  assert.equal(config.defaultProvider, 'openai');
  assert.equal(config.server.port, 5000);
  assert.equal(config.agent.approval, 'ask');
  assert.equal(config.providers.openai.model, 'gpt-x');
});

test('project config is merged over the global config', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'chan-project-'));
  fs.writeFileSync(
    path.join(project, 'chan.config.json'),
    JSON.stringify({ defaultProvider: 'ollama', agent: { approval: 'deny' } }),
  );
  const config = loadConfig({ cwd: project, env: {}, includeProject: true });
  assert.equal(config.defaultProvider, 'ollama');
  assert.equal(config.agent.approval, 'deny');
  assert.equal(config.agent.maxSteps, DEFAULT_CONFIG.agent.maxSteps);
});

test('getProviderConfig resolves api keys from env and presets', () => {
  const config = structuredClone(DEFAULT_CONFIG);
  const resolved = getProviderConfig({ ...config, providers: { ...config.providers, deepseek: { ...config.providers.deepseek, apiKey: 'env:DEEP_KEY' } } }, 'deepseek');
  const previous = process.env.DEEP_KEY;
  process.env.DEEP_KEY = 'sk-test';
  assert.equal(getProviderConfig({ ...config, providers: { ...config.providers, deepseek: { ...config.providers.deepseek, apiKey: 'env:DEEP_KEY' } } }, 'deepseek').apiKey, 'sk-test');
  if (previous === undefined) delete process.env.DEEP_KEY;
  else process.env.DEEP_KEY = previous;
  assert.equal(resolved.type, 'openai');
});

test('getProviderConfig throws for unknown providers', () => {
  assert.throws(() => getProviderConfig(DEFAULT_CONFIG, 'nope'), /unknown provider/);
});

test('redactConfig hides secrets', () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.providers.deepseek.apiKey = 'sk-super-secret-value';
  config.server.token = 'top-secret';
  const redacted = redactConfig(config);
  assert.equal(redacted.providers.deepseek.apiKey, 'sk-s***');
  assert.equal(redacted.server.token, '***');
  assert.equal(config.providers.deepseek.apiKey, 'sk-super-secret-value');
});

test('setConfigValue supports dotted paths and typed values', () => {
  const config = structuredClone(DEFAULT_CONFIG);
  setConfigValue(config, 'agent.maxSteps', '12');
  setConfigValue(config, 'providers.deepseek.apiKey', 'sk-1');
  setConfigValue(config, 'agent.allowDangerous', 'true');
  assert.equal(config.agent.maxSteps, 12);
  assert.equal(config.providers.deepseek.apiKey, 'sk-1');
  assert.equal(config.agent.allowDangerous, true);
});

test('saveConfig, initConfig and listProviders work with CHAN_HOME', () => {
  assert.equal(CONFIG_PATH, path.join(home, 'config.json'));
  const result = initConfig({ force: true, provider: 'openai' });
  assert.equal(result.created, true);
  assert.ok(fs.existsSync(CONFIG_PATH));
  const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  assert.equal(saved.defaultProvider, 'openai');
  const second = initConfig({});
  assert.equal(second.created, false);
  const providers = listProviders(loadConfig({ cwd: home, env: {} }));
  assert.ok(providers.find((p) => p.name === 'deepseek'));
  saveConfig(saved);
});
