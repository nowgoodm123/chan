import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  APP_HOME,
  CONFIG_PATH,
  DEFAULT_CONFIG,
  PROVIDER_PRESETS,
  getProviderConfig,
  initConfig,
  listProviders,
  loadConfig,
  redactConfig,
  saveConfig,
  setConfigValue,
} from '../config.js';
import { expandCommand, loadCommands } from '../commands.js';
import { createMcpManager } from '../mcp/index.js';
import { addPermissionRule } from '../permissions.js';
import { createProvider } from '../providers/index.js';
import { createRuntime, resolveProviderForSpec } from '../runtime.js';
import { SessionStore } from '../sessions.js';
import { describeTools } from '../tools/index.js';
import { startServer, openBrowser, SITE_DIR } from '../server/server.js';
import { version } from '../version.js';
import { parseArgs } from './args.js';
import { ConsoleUI } from './ui.js';
import { createApprovalPrompt, readStdin, runTurn } from './runner.js';
import { startRepl } from './repl.js';

const HELP = `chan_code v${version} — open-source AI coding agent for terminal and browser

USAGE
  chan                          start the interactive chat (REPL)
  chan run <prompt...>          run a single task and exit
  chan serve [options]          start the browser UI (http://127.0.0.1:4731)
  chan init                     create ~/.chan_code/config.json
  chan config [show|path|get|set|edit]
  chan models [--presets]        list providers and available presets
  chan tools                     list agent tools
  chan mcp [list|refresh]        show MCP server status
  chan sessions [list|rm <id>]   manage saved sessions
  chan about                     open the chan_code landing page
  chan help / chan version

OPTIONS
  -p, --provider <name>    provider to use (default from config)
  -m, --model <name>       override the model
  -C, --cwd <dir>          workspace directory (default: current directory)
      --approval <mode>    auto | ask | deny (default: auto)
      --max-steps <n>      maximum agent steps per turn
  -f, --file <path>        attach a text file to the prompt (repeatable)
      --resume <id>        resume a saved session
      --system <text>      extra system prompt instructions
  -V, --verbose            show full tool output
      --json               machine-readable output where supported

WEB SERVER
  chan serve --port 4731 --host 127.0.0.1 --open
  chan serve --host 0.0.0.0 --token <secret>

CONFIG
  Settings live in ${CONFIG_PATH}
  Environment: CHAN_PROVIDER, CHAN_MODEL, CHAN_BASE_URL, CHAN_API_KEY,
  CHAN_PORT, CHAN_HOST, CHAN_TOKEN, CHAN_APPROVAL, CHAN_HOME

MODEL EXAMPLES
  chan init --provider deepseek
  chan config set providers.deepseek.apiKey=sk-...
  chan config set providers.ollama.model=qwen2.5-coder:7b
  chan models --presets

EXAMPLES
  chan run "Explain the architecture of this project"
  chan serve --open
  echo "fix the failing tests" | chan run
`;

const COMMANDS = new Set(['run', 'chat', 'serve', 'config', 'models', 'tools', 'mcp', 'sessions', 'init', 'about', 'help', 'version']);

function applyOverrides(config, flags) {
  if (flags.provider) config.defaultProvider = flags.provider;
  const providerName = config.defaultProvider;
  if (!config.providers) config.providers = {};
  if (!config.providers[providerName]) {
    config.providers[providerName] = { ...(PROVIDER_PRESETS[providerName] || { type: 'openai', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' }) };
  }
  if (flags.provider && PROVIDER_PRESETS[flags.provider] && !flags.model) {
    const preset = PROVIDER_PRESETS[flags.provider];
    if (!config.providers[providerName].baseUrl) config.providers[providerName].baseUrl = preset.baseUrl;
    if (!config.providers[providerName].model) config.providers[providerName].model = preset.model;
  }
  if (flags.model) {
    config.providers[providerName] = { ...config.providers[providerName], model: flags.model };
  }
  if (flags.approval) {
    if (!['auto', 'ask', 'deny'].includes(flags.approval)) {
      throw new Error(`invalid approval mode "${flags.approval}" (use auto, ask or deny)`);
    }
    config.agent = { ...config.agent, approval: flags.approval };
  }
  if (flags['max-steps']) {
    const steps = Number(flags['max-steps']);
    if (!Number.isFinite(steps) || steps < 1) throw new Error('--max-steps must be a positive number');
    config.agent = { ...config.agent, maxSteps: steps };
  }
  if (flags.system) config.agent = { ...config.agent, systemPrompt: flags.system };
  return config;
}

function pickProvider(config) {
  const provider = createProvider(config, config.defaultProvider);
  return provider;
}

function makeApprovalFor(mode, config = null) {
  if (mode === 'deny') return async () => ({ approved: false, reason: 'approval mode is deny' });
  const onRemember =
    config && typeof config === 'object'
      ? async (request) => {
          if (request.permission && addPermissionRule(config, request.permission)) {
            saveConfig(config);
          }
        }
      : null;
  if (mode === 'ask') return createApprovalPrompt(null, { onRemember });
  const prompt = createApprovalPrompt(null, { onRemember });
  return async (request) => (request.requiresConfirmation ? prompt(request) : { approved: true });
}

function fileSnippet(cwd, file) {
  const absolute = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  const stat = fs.statSync(absolute, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) throw new Error(`file not found: ${file}`);
  if (stat.size > 400 * 1024) throw new Error(`file too large to attach: ${file}`);
  const relative = path.relative(cwd, absolute) || file;
  const ext = path.extname(absolute).replace('.', '') || 'text';
  const content = fs.readFileSync(absolute, 'utf8');
  return `\n\n--- attached file: ${relative.replace(/\\/g, '/')} ---\n\`\`\`${ext}\n${content}\n\`\`\``;
}

async function commandRun({ positionals, flags, config, cwd, ui }) {
  let prompt = positionals.join(' ').trim();
  if (!prompt && !process.stdin.isTTY) prompt = (await readStdin()).trim();
  if (!prompt) throw new Error('no prompt provided. Usage: chan run "your task"');
  if (flags.file?.length) {
    prompt += flags.file.map((file) => fileSnippet(cwd, file)).join('');
  }

  let commandMeta = null;
  if (prompt.startsWith('/')) {
    const name = prompt.slice(1).split(/\s+/)[0];
    const command = loadCommands({ cwd, config }).find((item) => item.name === name);
    if (command) {
      commandMeta = command;
      ui.info(`running custom command /${command.name}`);
      prompt = await expandCommand(command, prompt.slice(1 + name.length).trim(), { cwd });
    }
  }

  const baseProvider = pickProvider(config);
  const resolved = resolveProviderForSpec({
    config,
    baseName: config.defaultProvider,
    baseProvider,
    spec: commandMeta?.model,
  });
  const provider = resolved.provider;

  const store = new SessionStore({ cwd });
  const session = store.create({
    cwd,
    provider: resolved.name,
    model: provider.model,
    approval: config.agent.approval,
    agent: commandMeta?.agent || config.agent.defaultAgent,
  });
  session.messages.push({ role: 'user', content: prompt });
  const uiApproval = makeApprovalFor(config.agent.approval, config);

  const mcpManager = createMcpManager({ config, cwd, logger: (message) => ui.warn(message) });
  await mcpManager.init();
  try {
    const runtime = await createRuntime({
      cwd,
      config,
      session,
      provider,
      providerName: resolved.name,
      approvalMode: config.agent.approval,
      approve: uiApproval,
      mcpManager,
      agentName: commandMeta?.agent || null,
    });

    ui.info(`chan_code · ${resolved.name} · ${provider.model} · ${session.agent || config.agent.defaultAgent} · ${cwd}`);
    ui.info(`session ${session.id}`);
    ui.line();

    const result = await runTurn({
      provider,
      session,
      tools: runtime.tools,
      system: runtime.system,
      ui,
      approve: uiApproval,
      maxSteps: config.agent.maxSteps,
      temperature: config.agent.temperature,
      maxOutputChars: config.agent.maxOutputChars,
    });

    store.save(session);
    ui.line(ui.dim(`resume with: chan --resume ${session.id}`));
    if (result.error) process.exitCode = 1;
  } finally {
    await mcpManager.close();
  }
}

async function commandChat({ flags, config, cwd, ui }) {
  if (!process.stdin.isTTY) {
    return commandRun({ positionals: [], flags, config, cwd, ui });
  }
  const mcpManager = createMcpManager({ config, cwd, logger: (message) => ui.warn(message) });
  await mcpManager.init();
  try {
    return await startRepl({ cwd, config, ui, resumeId: flags.resume, flags, mcpManager });
  } finally {
    await mcpManager.close();
  }
}

async function commandMcp({ positionals, config, cwd, ui }) {
  const action = (positionals[0] || 'list').toLowerCase();
  const manager = createMcpManager({ config, cwd, logger: (message) => ui.warn(message) });
  await manager.init();
  if (action === 'refresh') await manager.refresh();
  const statuses = manager.statusesList();
  if (!statuses.length) {
    ui.info('no MCP servers configured. Add mcp.servers to your config file.');
    ui.line(ui.dim('Example: chan config set mcp.servers.context7.type=remote'));
  }
  for (const status of statuses) {
    const icon = status.connected ? ui.green('connected') : ui.red('failed');
    ui.line(`${status.name.padEnd(16)} ${String(status.type).padEnd(8)} ${icon}`);
    if (status.connected) ui.line(ui.dim(`  tools: ${status.tools.join(', ') || '(none)'}`));
    else if (status.error) ui.line(ui.dim(`  ${status.error}`));
  }
  await manager.close();
  if (action !== 'list' && action !== 'refresh') throw new Error(`unknown mcp command "${action}" (use list or refresh)`);
}

async function commandServe({ flags, config, cwd, ui }) {
  if (flags.token) {
    config.server = { ...config.server, token: flags.token };
  }
  const port = flags.port ? Number(flags.port) : undefined;
  const host = flags.host;
  const { url, port: actualPort, lan, server } = await startServer({ cwd, config, port, host, open: flags.open });

  ui.line(ui.cyan('chan_code web server'));
  ui.line(`  app:     ${ui.bold(`${url}`)}`);
  ui.line(`  landing: ${url}/about`);
  if (lan.length) {
    ui.line(`  network: ${lan.map((item) => `${item}`).join(', ')}`);
    if (!server.token) ui.line(ui.yellow('  warning: listening on the network without a token is blocked; local access only'));
  }
  if (server.token) ui.line(ui.dim('  token:   enabled (append ?token=... or send Authorization: Bearer ...)'));
  ui.line(ui.dim(`  workspace: ${cwd}`));
  ui.line(ui.dim('  press Ctrl+C to stop'));

  await new Promise((resolve) => {
    const stop = async () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      ui.info('stopping server…');
      await server.close().catch(() => {});
      resolve();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
  void actualPort;
}

function commandConfig({ positionals, ui }) {
  const sub = positionals[0] || 'show';
  if (sub === 'path') {
    ui.line(CONFIG_PATH);
    return;
  }
  if (sub === 'show') {
    const config = loadConfig({ cwd: process.cwd() });
    ui.line(JSON.stringify(redactConfig(config), null, 2));
    return;
  }
  if (sub === 'edit') {
    const config = loadConfig({ cwd: process.cwd() });
    saveConfig(config);
    const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad.exe' : 'vi');
    const result = spawnSync(editor, [CONFIG_PATH], { stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.error) ui.error(`could not open editor "${editor}": ${result.error.message}`);
    return;
  }
  if (sub === 'get') {
    const key = positionals[1];
    if (!key) throw new Error('usage: chan config get <key>');
    const config = loadConfig({ cwd: process.cwd() });
    let cursor = config;
    for (const part of key.split('.')) {
      if (cursor == null) break;
      cursor = cursor[part];
    }
    ui.line(cursor === undefined ? '' : typeof cursor === 'object' ? JSON.stringify(redactConfig(cursor), null, 2) : String(cursor));
    return;
  }
  if (sub === 'set') {
    const assignments = positionals.slice(1);
    if (!assignments.length) throw new Error('usage: chan config set key=value [key2=value2 ...]');
    const config = loadConfig({ cwd: process.cwd(), includeProject: false });
    for (const assignment of assignments) {
      const eq = assignment.indexOf('=');
      if (eq === -1) throw new Error(`invalid assignment "${assignment}" (expected key=value)`);
      const key = assignment.slice(0, eq).trim();
      const value = assignment.slice(eq + 1);
      if (key === 'server.token') config.server = { ...config.server, token: value };
      else if (key === 'defaultProvider') config.defaultProvider = value;
      else setConfigValue(config, key, value);
      ui.info(`set ${key}`);
    }
    saveConfig(config);
    ui.line(ui.green(`saved ${CONFIG_PATH}`));
    return;
  }
  throw new Error(`unknown config command "${sub}" (use show, path, get, set, edit)`);
}

function commandModels({ flags, config, ui }) {
  const providers = listProviders(config);
  if (flags.json) {
    ui.line(JSON.stringify({ defaultProvider: config.defaultProvider, providers }, null, 2));
    return;
  }
  ui.line(ui.bold('Configured providers'));
  if (!providers.length) ui.line(ui.dim('  none — run "chan init"'));
  for (const provider of providers) {
    const marker = provider.name === config.defaultProvider ? ui.green('*') : ' ';
    const key = provider.hasApiKey ? ui.green('key') : provider.local ? ui.dim('local') : ui.yellow('no key');
    ui.line(` ${marker} ${provider.name.padEnd(12)} ${String(provider.type || '').padEnd(10)} ${String(provider.model || '').padEnd(28)} ${key}`);
    ui.line(ui.dim(`   ${provider.baseUrl || ''}`));
  }
  if (flags.presets) {
    ui.line();
    ui.line(ui.bold('Presets (add with chan config set providers.<name>....)'));
    for (const [name, preset] of Object.entries(PROVIDER_PRESETS)) {
      ui.line(`  ${name.padEnd(12)} ${preset.model.padEnd(30)} ${ui.dim(preset.baseUrl)}`);
    }
  }
  ui.line();
  ui.line(ui.dim('Tip: chan config set providers.deepseek.apiKey=sk-...'));
}

function commandTools({ flags, config, ui }) {
  const tools = describeTools();
  if (flags.json) {
    ui.line(JSON.stringify(tools, null, 2));
    return;
  }
  for (const tool of tools) {
    ui.line(`${ui.cyan(tool.name.padEnd(12))} ${tool.description}`);
  }
  ui.line();
  ui.line(ui.dim('Dynamic tools: skill (skills), subagent (agents), <server>_<tool> (MCP)'));
  ui.line(ui.dim(`Workspace: ${process.cwd()} · approval: ${config.agent.approval}`));
}

function commandSessions({ positionals, ui, cwd }) {
  const store = new SessionStore({ cwd });
  const sub = positionals[0] || 'list';
  if (sub === 'rm' || sub === 'delete') {
    const id = positionals[1];
    if (!id) throw new Error('usage: chan sessions rm <id>');
    const ok = store.delete(id);
    ui.line(ok ? ui.green(`deleted session ${id}`) : ui.red(`session not found: ${id}`));
    return;
  }
  if (sub === 'show') {
    const id = positionals[1];
    if (!id) throw new Error('usage: chan sessions show <id>');
    const session = store.get(id);
    if (!session) throw new Error(`session not found: ${id}`);
    ui.line(JSON.stringify({ ...session, messages: session.messages.map((m) => ({ ...m, images: m.images?.map((i) => i.name || i.path) })) }, null, 2));
    return;
  }
  const sessions = store.list();
  if (!sessions.length) {
    ui.line(ui.dim('No saved sessions for this workspace.'));
    return;
  }
  for (const session of sessions) {
    ui.line(`${ui.cyan(session.id)}  ${String(session.title || 'New session').slice(0, 52).padEnd(52)}  ${ui.dim(session.updatedAt)}`);
  }
  ui.line();
  ui.line(ui.dim('Resume: chan chat --resume <id>'));
}

function commandInit({ flags, ui }) {
  const result = initConfig({ force: flags.force, provider: flags.provider });
  if (result.created) {
    ui.line(ui.green(`Created ${result.path}`));
  } else {
    ui.line(`Config already exists at ${result.path} (use --force to overwrite)`);
  }
  ui.line();
  ui.line('Next steps:');
  ui.line(`  1. chan config set providers.deepseek.apiKey=sk-...   ${ui.dim('(or export DEEPSEEK_API_KEY)')}`);
  ui.line('  2. chan models');
  ui.line('  3. chan            # interactive chat');
  ui.line('     chan serve --open  # browser UI with image/file support');
  return result;
}

function commandAbout() {
  const target = path.join(SITE_DIR, 'index.html');
  if (fs.existsSync(target)) {
    openBrowser(pathToFileURL(target).href);
    process.stdout.write(`Opened ${target}\n`);
  } else {
    process.stdout.write('Landing page not found. Run "chan serve" and open http://127.0.0.1:4731/about\n');
  }
}

export async function main(argv = []) {
  const { flags, positionals } = parseArgs(argv);
  if (flags.version || positionals[0] === 'version') {
    process.stdout.write(`chan_code ${version}\n`);
    return;
  }
  if (flags.help || positionals[0] === 'help') {
    process.stdout.write(HELP);
    return;
  }

  let command = 'chat';
  if (positionals.length) {
    if (COMMANDS.has(positionals[0])) {
      command = positionals.shift();
    } else {
      command = 'run';
    }
  }

  const cwd = path.resolve(flags.cwd || process.cwd());
  if (!fs.existsSync(cwd)) throw new Error(`working directory not found: ${cwd}`);
  if (command === 'init') {
    return commandInit({ flags, ui: new ConsoleUI() });
  }
  if (command === 'about') return commandAbout();

  const config = applyOverrides(loadConfig({ cwd, includeProject: !flags['no-project'] }), flags);
  const ui = new ConsoleUI({ verbose: Boolean(flags.verbose) });

  if (command === 'config') return commandConfig({ positionals, ui });
  if (command === 'models') return commandModels({ flags, config, ui });
  if (command === 'tools') return commandTools({ flags, config, ui });
  if (command === 'mcp') return commandMcp({ positionals, config, cwd, ui });
  if (command === 'sessions') return commandSessions({ positionals, ui, cwd });
  if (command === 'serve') return commandServe({ flags, config, cwd, ui });
  if (command === 'run') return commandRun({ positionals, flags, config, cwd, ui });
  return commandChat({ flags, config, cwd, ui });
}

export { HELP, APP_HOME, DEFAULT_CONFIG, getProviderConfig };
