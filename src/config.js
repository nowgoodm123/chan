import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_HOME =
  process.env.CHAN_HOME && process.env.CHAN_HOME.trim()
    ? path.resolve(process.env.CHAN_HOME)
    : path.join(os.homedir(), '.chan_code');

export const CONFIG_PATH = path.join(APP_HOME, 'config.json');
export const SESSIONS_DIR = path.join(APP_HOME, 'sessions');

export const PROVIDER_PRESETS = {
  openai: {
    type: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  anthropic: {
    type: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-7-sonnet-latest',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    maxTokens: 8192,
  },
  deepseek: {
    type: 'openai',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
  openrouter: {
    type: 'openai',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
  groq: {
    type: 'openai',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    apiKeyEnv: 'GROQ_API_KEY',
  },
  moonshot: {
    type: 'openai',
    label: 'Moonshot / Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-32k',
    apiKeyEnv: 'MOONSHOT_API_KEY',
  },
  qwen: {
    type: 'openai',
    label: 'Alibaba Qwen (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
  },
  zhipu: {
    type: 'openai',
    label: 'Zhipu GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-plus',
    apiKeyEnv: 'ZHIPU_API_KEY',
  },
  ollama: {
    type: 'openai',
    label: 'Ollama (local)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5-coder:7b',
    apiKey: '',
  },
  lmstudio: {
    type: 'openai',
    label: 'LM Studio (local)',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'local-model',
    apiKey: '',
  },
  vllm: {
    type: 'openai',
    label: 'vLLM (local)',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'local-model',
    apiKey: '',
  },
};

export const DEFAULT_CONFIG = {
  defaultProvider: 'deepseek',
  providers: {
    deepseek: { ...PROVIDER_PRESETS.deepseek },
    openai: { ...PROVIDER_PRESETS.openai },
    anthropic: { ...PROVIDER_PRESETS.anthropic },
    ollama: { ...PROVIDER_PRESETS.ollama },
  },
  agent: {
    maxSteps: 40,
    approval: 'auto',
    allowOutsideWorkspace: false,
    allowDangerous: false,
    commandTimeoutMs: 120000,
    maxOutputChars: 20000,
    temperature: 0.2,
    systemPrompt: '',
    defaultAgent: 'build',
  },
  mcp: {
    servers: {},
    timeoutMs: 30000,
  },
  skills: {
    dirs: [],
  },
  commands: {
    dirs: [],
  },
  agents: {
    dirs: [],
  },
  server: {
    host: '127.0.0.1',
    port: 4731,
    token: '',
  },
  ui: {
    theme: 'dark',
  },
};

export function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`failed to read ${filePath}: ${err.message}`);
  }
}

export function findProjectConfig(cwd) {
  for (const name of ['chan.config.json', path.join('.chan', 'config.json')]) {
    const candidate = path.join(cwd, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function envOverrides(env = process.env) {
  const out = {};
  if (env.CHAN_PROVIDER) out.defaultProvider = env.CHAN_PROVIDER;
  if (env.CHAN_PORT) {
    out.server = { ...(out.server || {}), port: Number(env.CHAN_PORT) };
  }
  if (env.CHAN_HOST) {
    out.server = { ...(out.server || {}), host: env.CHAN_HOST };
  }
  if (env.CHAN_TOKEN) {
    out.server = { ...(out.server || {}), token: env.CHAN_TOKEN };
  }
  if (env.CHAN_APPROVAL) {
    out.agent = { ...(out.agent || {}), approval: env.CHAN_APPROVAL };
  }
  if (env.CHAN_AGENT) {
    out.agent = { ...(out.agent || {}), defaultAgent: env.CHAN_AGENT };
  }
  if (env.CHAN_MAX_STEPS) {
    out.agent = { ...(out.agent || {}), maxSteps: Number(env.CHAN_MAX_STEPS) };
  }
  if (env.CHAN_MODEL || env.CHAN_BASE_URL || env.CHAN_API_KEY) {
    const name = env.CHAN_PROVIDER || DEFAULT_CONFIG.defaultProvider;
    out.providers = {
      ...(out.providers || {}),
      [name]: {
        ...(env.CHAN_MODEL ? { model: env.CHAN_MODEL } : {}),
        ...(env.CHAN_BASE_URL ? { baseUrl: env.CHAN_BASE_URL } : {}),
        ...(env.CHAN_API_KEY ? { apiKey: env.CHAN_API_KEY } : {}),
      },
    };
  }
  return out;
}

export function loadConfig({ cwd = process.cwd(), env = process.env, includeProject = true } = {}) {
  let config = structuredClone(DEFAULT_CONFIG);
  const globalConfig = readJsonFile(CONFIG_PATH);
  if (globalConfig) config = deepMerge(config, globalConfig);
  if (includeProject) {
    const projectPath = findProjectConfig(cwd);
    if (projectPath) config = deepMerge(config, readJsonFile(projectPath) || {});
  }
  config = deepMerge(config, envOverrides(env));
  return config;
}

export function saveConfig(config) {
  fs.mkdirSync(APP_HOME, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return CONFIG_PATH;
}

export function resolveSecret(value, env = process.env) {
  if (typeof value !== 'string') return '';
  if (value.startsWith('env:')) {
    const name = value.slice(4).trim();
    return env[name] || '';
  }
  return value;
}

export function isLocalUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function getProviderConfig(config, name) {
  const providerName = name || config.defaultProvider;
  const provider = config.providers?.[providerName];
  if (!provider) {
    const known = Object.keys(config.providers || {}).join(', ') || '(none)';
    throw new Error(`unknown provider "${providerName}". Configured providers: ${known}. Run "chan init" to create a config.`);
  }
  const preset = PROVIDER_PRESETS[providerName] || {};
  const merged = deepMerge({ ...preset }, provider);
  const env = process.env;
  let apiKey = resolveSecret(merged.apiKey, env);
  if (!apiKey && merged.apiKeyEnv) apiKey = env[merged.apiKeyEnv] || '';
  if (!apiKey && merged.apiKeyFromEnv) apiKey = env[merged.apiKeyFromEnv] || '';
  return {
    name: providerName,
    type: merged.type || 'openai',
    model: merged.model,
    fallbackModels: merged.fallbackModels || [],
    baseUrl: merged.baseUrl,
    apiKey,
    apiKeyEnv: merged.apiKeyEnv,
    maxTokens: merged.maxTokens,
    temperature: merged.temperature,
    streamUsage: merged.streamUsage,
    extraHeaders: merged.extraHeaders || {},
    label: merged.label || providerName,
  };
}

export function listProviders(config) {
  return Object.keys(config.providers || {}).map((name) => {
    let resolved = null;
    let error = null;
    try {
      resolved = getProviderConfig(config, name);
    } catch (err) {
      error = err.message;
    }
    return {
      name,
      label: resolved?.label || name,
      type: resolved?.type,
      model: resolved?.model,
      baseUrl: resolved?.baseUrl,
      hasApiKey: Boolean(resolved?.apiKey),
      local: isLocalUrl(resolved?.baseUrl),
      error,
    };
  });
}

export function redactConfig(config) {
  const clone = structuredClone(config);
  for (const provider of Object.values(clone.providers || {})) {
    if (provider.apiKey && !String(provider.apiKey).startsWith('env:')) {
      provider.apiKey = provider.apiKey.length > 8 ? `${provider.apiKey.slice(0, 4)}***` : '***';
    }
    delete provider.apiKeyEnv;
  }
  if (clone.server?.token) clone.server.token = '***';
  return clone;
}

export function initConfig({ force = false, provider = DEFAULT_CONFIG.defaultProvider } = {}) {
  if (fs.existsSync(CONFIG_PATH) && !force) {
    return { created: false, path: CONFIG_PATH };
  }
  const config = structuredClone(DEFAULT_CONFIG);
  if (advisor(provider)) config.defaultProvider = provider;
  saveConfig(config);
  return { created: true, path: CONFIG_PATH };
}

function advisor(provider) {
  return Boolean(provider) && Object.keys(PROVIDER_PRESETS).includes(provider);
}

export function setConfigValue(config, dottedKey, rawValue) {
  const parts = String(dottedKey).split('.').filter(Boolean);
  if (!parts.length) throw new Error('config key is required');
  let cursor = config;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  let value = rawValue;
  if (typeof rawValue === 'string') {
    if (rawValue === 'true') value = true;
    else if (rawValue === 'false') value = false;
    else if (/^-?\d+(\.\d+)?$/.test(rawValue)) value = Number(rawValue);
    else if (rawValue.startsWith('{') || rawValue.startsWith('[')) {
      try {
        value = JSON.parse(rawValue);
      } catch {
        value = rawValue;
      }
    }
  }
  cursor[parts[parts.length - 1]] = value;
  return config;
}
