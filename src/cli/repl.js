import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { loadAgents } from '../agents.js';
import { expandCommand, loadCommands } from '../commands.js';
import { APP_HOME, CONFIG_PATH, getProviderConfig, PROVIDER_PRESETS, redactConfig, resolveSecret, saveConfig } from '../config.js';
import { createProvider } from '../providers/index.js';
import { createRuntime, resolveProviderForSpec } from '../runtime.js';
import { loadSkills } from '../skills.js';
import { startServer, openBrowser, SITE_DIR } from '../server/server.js';
import { SessionStore } from '../sessions.js';
import { createTools, describeTools } from '../tools/index.js';
import { version } from '../version.js';
import { renderSlashMenu, slashCompletions, SLASH_COMMANDS } from './palette.js';
import { runTurn } from './runner.js';

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

const IMAGE_EXTENSIONS = new Set(Object.keys(MIME_BY_EXT));

function loadImageAttachment(cwd, file) {
  const absolute = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  const stat = fs.statSync(absolute, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) throw new Error(`file not found: ${file}`);
  if (stat.size > 8 * 1024 * 1024) throw new Error('image is larger than 8MB');
  const ext = path.extname(absolute).toLowerCase();
  const mediaType = MIME_BY_EXT[ext];
  if (!mediaType) throw new Error(`unsupported image type "${ext}" (use png, jpg, gif, webp, bmp)`);
  const dataUrl = `data:${mediaType};base64,${fs.readFileSync(absolute).toString('base64')}`;
  return { name: path.basename(absolute), mediaType, dataUrl, path };
}

export async function startRepl({ cwd, config, ui, resumeId = null, flags = {}, mcpManager = null }) {
  const store = new SessionStore({ cwd });
  const BUILTIN_COMMANDS = new Set([...SLASH_COMMANDS.map((entry) => entry.command.slice(1)), 'q']);
  let provider = null;
  let providerError = null;
  let pendingImages = [];
  let currentAbort = null;
  let webHandle = null;
  const history = [];

  let session = resumeId ? store.get(resumeId) : null;
  if (resumeId && !session) throw new Error(`session not found: ${resumeId}`);
  config.defaultProvider = session?.provider || config.defaultProvider;
  if (session?.model) {
    config.providers[config.defaultProvider] = {
      ...(config.providers[config.defaultProvider] || {}),
      model: session.model,
    };
  }
  if (!session) {
    provider = safeProvider(config);
    session = store.create({
      cwd,
      provider: config.defaultProvider,
      model: provider?.model || null,
      approval: config.agent.approval,
      agent: config.agent.defaultAgent || 'build',
    });
  } else {
    provider = safeProvider(config);
    if (provider && !session.model) session.model = provider.model;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
    historySize: 500,
  });

  let waiting = null;
  const buffered = [];
  let closed = false;
  rl.on('line', (line) => {
    sigintCount = 0;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
    } else {
      buffered.push(line);
    }
  });
  rl.on('close', () => {
    closed = true;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(null);
    }
  });

  rl.completer = (line) => {
    let files = [];
    try {
      files = fs
        .readdirSync(cwd, { withFileTypes: true })
        .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => entry.name);
    } catch {
      files = [];
    }
    const agents = [...loadAgents({ cwd, config }).keys()];
    return slashCompletions(line, { providers: Object.keys(config.providers || {}), files, agents });
  };

  function readLine(promptText = '') {
    if (promptText && process.stdin.isTTY) process.stdout.write(promptText);
    if (buffered.length) return Promise.resolve(buffered.shift());
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      waiting = resolve;
    });
  }

  async function readSecret(promptText) {
    if (!process.stdin.isTTY || typeof rl._writeToOutput !== 'function') return readLine(promptText);
    const original = rl._writeToOutput;
    rl._writeToOutput = function masked(chunk) {
      if (String(chunk).includes('\n') || String(chunk).includes('\r')) return original.call(rl, chunk);
      return undefined;
    };
    try {
      return (await readLine(promptText)) || '';
    } finally {
      rl._writeToOutput = original;
    }
  }

  const prompt = () => ui.cyan('chan> ');

  function safeProvider(cfg) {
    try {
      return createProvider(cfg, cfg.defaultProvider);
    } catch (err) {
      providerError = err.message;
      return null;
    }
  }

  function ensureProvider() {
    if (provider) return provider;
    provider = safeProvider(config);
    if (!provider) {
      throw new Error(providerError || 'provider is not configured');
    }
    providerError = null;
    return provider;
  }

  const approvalMode = () => session.approval || config.agent.approval || 'auto';

  async function approve(request) {
    const mode = approvalMode();
    if (mode === 'deny') return { approved: false, reason: 'approval mode is deny' };
    if (mode === 'auto' && !request.requiresConfirmation) return { approved: true };
    ui.stop();
    const target = request.command ? `\`${request.command}\`` : request.tool;
    const answer = await readLine(ui.yellow(`approve ${target}${request.danger ? ` (${request.danger})` : ''}? [y/N] `));
    return { approved: /^y(es)?$/i.test(String(answer || '').trim()) };
  }

  function newSession() {
    session = store.create({
      cwd,
      provider: config.defaultProvider,
      model: provider?.model || null,
      approval: config.agent.approval,
      agent: config.agent.defaultAgent || 'build',
    });
    history.length = 0;
    pendingImages = [];
    ui.info(`new session ${session.id}`);
  }

  function resumeSession(id) {
    const loaded = id ? store.get(id) : null;
    if (!loaded) {
      ui.error(id ? `session not found: ${id}` : 'usage: /session resume <id>');
      return;
    }
    session = loaded;
    config.defaultProvider = session.provider || config.defaultProvider;
    if (session.model) {
      config.providers[config.defaultProvider] = {
        ...(config.providers[config.defaultProvider] || {}),
        model: session.model,
      };
    }
    provider = safeProvider(config);
    ui.info(`resumed ${session.id} · ${session.messages.length} messages`);
    ui.info('history is in context; type a new message to continue');
  }

  function listSessions() {
    const sessions = store.list();
    if (!sessions.length) {
      ui.info('no saved sessions yet');
      return;
    }
    for (const item of sessions) {
      const marker = item.id === session.id ? ui.green('*') : ' ';
      ui.line(` ${marker} ${ui.cyan(item.id)}  ${String(item.title || 'New session').slice(0, 48).padEnd(48)}  ${ui.dim(item.updatedAt)}`);
    }
  }

  function showSessionInfo(id) {
    const data = id ? store.get(id) : session;
    if (!data) {
      ui.error(`session not found: ${id}`);
      return;
    }
    ui.line(ui.bold(`session ${data.id}${data.id === session.id ? ' (current)' : ''}`));
    ui.line(`  title:    ${data.title || 'New session'}`);
    ui.line(`  provider: ${data.provider || config.defaultProvider} · ${data.model || '(unset)'}`);
    ui.line(`  cwd:      ${data.cwd || cwd}`);
    ui.line(`  messages: ${data.messages?.length || 0}`);
    ui.line(`  todos:    ${data.todos?.length || 0}`);
    ui.line(`  updated:  ${data.updatedAt}`);
    const usage = data.usage || {};
    ui.line(`  tokens:   in ${usage.inputTokens || 0} · out ${usage.outputTokens || 0} · total ${usage.totalTokens || 0}`);
  }

  function deleteSession(id) {
    if (!id) {
      ui.error('usage: /session delete <id>');
      return;
    }
    if (!store.list().some((item) => item.id === id)) {
      ui.error(`session not found: ${id}`);
      return;
    }
    store.delete(id);
    ui.info(`deleted session ${id}`);
    if (session.id === id) newSession();
  }

  async function connectProvider(input) {
    const known = [...new Set([...Object.keys(PROVIDER_PRESETS), ...Object.keys(config.providers || {})])];
    let name = input.trim();
    if (!name) {
      ui.line(ui.bold('Connect a model provider'));
      known.forEach((item, index) => {
        const providerConfig = config.providers?.[item] || {};
        const preset = PROVIDER_PRESETS[item] || {};
        ui.line(`  ${String(index + 1).padStart(2)}. ${item.padEnd(12)} ${ui.dim(providerConfig.baseUrl || preset.baseUrl || '')}`);
      });
      const answer = ((await readLine(ui.cyan('provider name or number (blank cancels): '))) || '').trim();
      if (!answer) return;
      name = /^\d+$/.test(answer) ? known[Number(answer) - 1] : answer;
      if (!name) {
        ui.error('invalid selection');
        return;
      }
    }

    if (/^\d+$/.test(name)) name = known[Number(name) - 1] || name;
    const preset = PROVIDER_PRESETS[name] || {};
    const existing = config.providers?.[name] || {};
    let type = existing.type || preset.type || 'openai';
    if (!preset.type) {
      const answer = ((await readLine(`type [openai|anthropic] (${type}): `)) || '').trim();
      if (answer) type = answer;
    }
    if (!['openai', 'anthropic'].includes(type)) {
      ui.error('type must be openai or anthropic');
      return;
    }

    const baseDefault = existing.baseUrl || preset.baseUrl || '';
    const modelDefault = existing.model || preset.model || '';
    const baseUrl = ((await readLine(`Base URL (${baseDefault || 'required'}): `)) || '').trim() || baseDefault;
    const model = ((await readLine(`Model (${modelDefault || 'required'}): `)) || '').trim() || modelDefault;
    if (!baseUrl || !model) {
      ui.error('base URL and model are required');
      return;
    }

    const apiKeyEnv = existing.apiKeyEnv || preset.apiKeyEnv;
    const envKey = apiKeyEnv ? process.env[apiKeyEnv] : '';
    const existingKey = resolveSecret(existing.apiKey, process.env);
    let enteredKey = '';
    if (envKey) {
      ui.info(`using ${apiKeyEnv} from the environment`);
    } else {
      const hint = existingKey ? 'leave blank to keep the current key' : 'blank for local or keyless endpoints';
      enteredKey = (await readSecret(`API key (${hint}): `)).trim();
    }

    const updated = { ...existing, type, baseUrl, model };
    if (enteredKey) updated.apiKey = enteredKey;
    else if (!existing.apiKey && apiKeyEnv) updated.apiKey = `env:${apiKeyEnv}`;
    config.providers[name] = updated;
    config.defaultProvider = name;
    saveConfig(config);

    session.provider = name;
    session.model = model;
    provider = safeProvider(config);
    store.save(session);
    if (provider) {
      let resolved = null;
      try {
        resolved = getProviderConfig(config, name);
      } catch {
        resolved = null;
      }
      const keyState = resolved?.apiKey ? 'configured' : 'not set';
      ui.line(ui.green(`connected: ${name} · ${model}`));
      ui.line(ui.dim(`  ${baseUrl} · key ${keyState}`));
      ui.line(ui.dim(`  saved to ${CONFIG_PATH}`));
    } else {
      ui.warn(providerError || 'provider could not be created');
    }
  }

  async function turn(text, options = {}) {
    const baseProvider = ensureProvider();
    const resolved = resolveProviderForSpec({
      config,
      baseName: config.defaultProvider,
      baseProvider,
      spec: options.modelSpec,
    });
    let activeProvider = resolved.provider;
    let providerName = resolved.name;
    const images = pendingImages.splice(0);
    const userMessage = { role: 'user', content: text };
    if (images.length) userMessage.images = images;
    session.messages.push(userMessage);
    session.updatedAt = new Date().toISOString();
    if (session.title === 'New session' || !session.title) {
      session.title = options.title || text.slice(0, 60) || 'Image message';
    }
    store.save(session);

    const controller = new AbortController();
    currentAbort = controller;
    let runtime;
    try {
      runtime = await createRuntime({
        cwd,
        config,
        session,
        provider: activeProvider,
        providerName,
        approvalMode: approvalMode(),
        approve,
        signal: controller.signal,
        mcpManager,
        agentName: options.agentName || null,
      });
      if (!options.modelSpec && runtime.profile?.model) {
        try {
          const agentProvider = resolveProviderForSpec({
            config,
            baseName: providerName,
            baseProvider: activeProvider,
            spec: runtime.profile.model,
          });
          activeProvider = agentProvider.provider;
          providerName = agentProvider.name;
        } catch (err) {
          ui.warn(`agent model: ${err.message}`);
        }
      }
    } catch (err) {
      currentAbort = null;
      ui.error(err.message);
      return;
    }
    ui.line();
    try {
      const result = await runTurn({
        provider: activeProvider,
        session,
        tools: runtime.tools,
        system: runtime.system,
        ui,
        approve,
        signal: controller.signal,
        maxSteps: config.agent.maxSteps,
        temperature: config.agent.temperature,
        maxOutputChars: config.agent.maxOutputChars,
      });
      if (result.error && !currentAbort.signal.aborted) ui.error(result.error);
    } catch (err) {
      if (err.name === 'AbortError') ui.warn('generation stopped');
      else ui.error(err.message);
    } finally {
      currentAbort = null;
      store.save(session);
    }
  }

  async function runCustomCommand(command, argsText) {
    const expanded = await expandCommand(command, argsText, { cwd });
    ui.info(`command /${command.name}${command.agent ? ` · agent ${command.agent}` : ''}${command.model ? ` · ${command.model}` : ''}`);
    if (command.subagent) {
      const baseProvider = ensureProvider();
      const resolved = resolveProviderForSpec({
        config,
        baseName: config.defaultProvider,
        baseProvider,
        spec: command.model,
      });
      const sessionAgent = session.agent || config.agent.defaultAgent || 'build';
      const controller = new AbortController();
      currentAbort = controller;
      try {
        const runtime = await createRuntime({
          cwd,
          config,
          session,
          provider: resolved.provider,
          providerName: resolved.name,
          approvalMode: approvalMode(),
          approve,
          signal: controller.signal,
          mcpManager,
          agentName: sessionAgent,
        });
        if (!runtime.runSubagent) throw new Error('subagents are not available');
        const result = await runtime.runSubagent({
          agent: command.agent || 'general',
          prompt: expanded,
          model: command.model || undefined,
        });
        session.messages.push({ role: 'user', content: `/${command.name} ${argsText}`.trim() });
        session.messages.push({ role: 'assistant', content: result });
        store.save(session);
        ui.line(result);
      } catch (err) {
        if (err.name === 'AbortError') ui.warn('subagent stopped');
        else ui.error(err.message);
      } finally {
        currentAbort = null;
      }
      return;
    }
    await turn(expanded, {
      agentName: command.agent,
      modelSpec: command.model,
      title: `/${command.name}${argsText ? ` ${argsText}` : ''}`.slice(0, 120),
    });
  }

  async function handleCommand(line) {
    const [rawCommand, ...rest] = line.slice(1).split(/\s+/);
    const command = rawCommand.toLowerCase();
    const arg = rest.join(' ').trim();
    switch (command) {
      case 'help':
        ui.line(ui.bold('Commands'));
        ui.line(renderSlashMenu({ all: true }));
        {
          const customCommands = loadCommands({ cwd, config });
          if (customCommands.length) {
            ui.line(ui.bold('Custom commands'));
            for (const item of customCommands) ui.line(`  /${item.name.padEnd(20)} ${ui.dim(item.description)}`);
          }
        }
        ui.line(ui.dim('Everything else is sent to the agent. Ctrl+C stops a running turn.'));
        return false;
      case 'exit':
      case 'quit':
      case 'q':
        return true;
      case 'new':
      case 'clear':
        newSession();
        return false;
      case 'model': {
        if (!arg) {
          ui.line(`model: ${provider?.model || session.model || '(unset)'}`);
          return false;
        }
        session.model = arg;
        config.providers[config.defaultProvider] = { ...(config.providers[config.defaultProvider] || {}), model: arg };
        provider = safeProvider(config);
        ui.info(`model set to ${arg}`);
        return false;
      }
      case 'provider': {
        if (!arg) {
          ui.line(`provider: ${config.defaultProvider} (${provider?.type || 'unknown'})`);
          return false;
        }
        if (!config.providers?.[arg]) {
          ui.error(`unknown provider "${arg}". Available: ${Object.keys(config.providers || {}).join(', ')}`);
          return false;
        }
        config.defaultProvider = arg;
        session.provider = arg;
        provider = safeProvider(config);
        if (provider) session.model = provider.model;
        ui.info(`provider set to ${arg}${provider ? ` · ${provider.model}` : ''}`);
        if (!provider) ui.warn(providerError);
        return false;
      }
      case 'approval': {
        if (!arg) {
          ui.line(`approval: ${approvalMode()}`);
          return false;
        }
        if (!['auto', 'ask', 'deny'].includes(arg)) {
          ui.error('approval must be auto, ask or deny');
          return false;
        }
        session.approval = arg;
        config.agent.approval = arg;
        ui.info(`approval set to ${arg}`);
        return false;
      }
      case 'attach': {
        if (!arg) {
          ui.line(pendingImages.length ? `${pendingImages.length} image(s) attached` : 'no attachments');
          return false;
        }
        try {
          const image = loadImageAttachment(cwd, arg);
          pendingImages.push(image);
          ui.info(`attached ${image.name} — send your message to include it`);
        } catch (err) {
          ui.error(err.message);
        }
        return false;
      }
      case 'detach':
        pendingImages = [];
        ui.info('attachments cleared');
        return false;
      case 'tools':
        for (const tool of describeTools()) ui.line(`  ${ui.cyan(tool.name.padEnd(12))} ${ui.dim(tool.description.slice(0, 100))}`);
        ui.line(ui.dim('  dynamic: skill, subagent, <server>_<tool> (MCP)'));
        return false;
      case 'sessions':
        listSessions();
        return false;
      case 'resume':
        resumeSession(arg);
        return false;
      case 'session': {
        const [subRaw, ...sessionRest] = arg.split(/\s+/).filter(Boolean);
        const sub = (subRaw || 'list').toLowerCase();
        const target = sessionRest.join(' ').trim();
        if (sub === 'list') listSessions();
        else if (sub === 'new') newSession();
        else if (sub === 'resume') resumeSession(target);
        else if (sub === 'delete' || sub === 'rm') deleteSession(target);
        else if (sub === 'show') showSessionInfo(target);
        else if (sub === 'rename') {
          if (!target) {
            ui.error('usage: /session rename <new title>');
          } else {
            session.title = target.slice(0, 200);
            store.save(session);
            ui.info(`renamed session to "${session.title}"`);
          }
        } else {
          ui.error(`unknown session command "${sub}" — use list, new, resume <id>, delete <id>, rename <title>, show [id]`);
        }
        return false;
      }
      case 'connect':
      case 'login':
        await connectProvider(arg);
        return false;
      case 'web': {
        if (arg === 'stop') {
          if (!webHandle) ui.info('web server is not running');
          else {
            await webHandle.server.close().catch(() => {});
            webHandle = null;
            ui.info('web server stopped');
          }
          return false;
        }
        if (webHandle) {
          ui.line(`web UI: ${ui.bold(webHandle.url)}  ${ui.dim(`${webHandle.url}/about`)}`);
          return false;
        }
        try {
          webHandle = await startServer({ cwd, config, open: arg === 'open' });
          ui.line(`web UI: ${ui.bold(webHandle.url)}   ${ui.dim('images/files upload enabled')}`);
          ui.line(ui.dim('stop it with /web stop'));
        } catch (err) {
          ui.error(err.message);
        }
        return false;
      }
      case 'agent': {
        const agents = loadAgents({ cwd, config });
        if (!arg) {
          const current = session.agent || config.agent.defaultAgent || 'build';
          ui.line(`agent: ${current}`);
          for (const profile of agents.values()) {
            if (profile.hidden) continue;
            const marker = profile.name === current ? ui.green('*') : ' ';
            ui.line(` ${marker} ${profile.name.padEnd(12)} ${String(profile.mode).padEnd(9)} ${ui.dim(profile.description || '')}`);
          }
          return false;
        }
        {
          const profile = agents.get(arg) || agents.get(arg.toLowerCase());
          if (!profile) {
            ui.error(`unknown agent "${arg}". Available: ${[...agents.keys()].join(', ')}`);
            return false;
          }
          session.agent = profile.name;
          if (profile.model) {
            try {
              const resolved = resolveProviderForSpec({
                config,
                baseName: config.defaultProvider,
                baseProvider: provider,
                spec: profile.model,
              });
              config.defaultProvider = resolved.name;
              session.provider = resolved.name;
              session.model = resolved.model || profile.model;
              provider = resolved.provider;
            } catch (err) {
              ui.warn(`agent model: ${err.message}`);
            }
          }
          store.save(session);
          ui.info(`agent set to ${profile.name} (${profile.mode})${profile.model ? ` · model ${profile.model}` : ''}`);
        }
        return false;
      }
      case 'agents': {
        const agents = loadAgents({ cwd, config });
        for (const profile of agents.values()) {
          if (profile.hidden) continue;
          const marker = profile.name === (session.agent || config.agent.defaultAgent) ? ui.green('*') : ' ';
          ui.line(` ${marker} ${ui.cyan(profile.name.padEnd(12))} ${String(profile.mode).padEnd(9)} ${ui.dim(profile.description || '')}${profile.source ? ui.dim(` [${profile.source}]`) : ''}`);
        }
        return false;
      }
      case 'skills': {
        const skills = loadSkills({ cwd, config });
        if (!skills.length) {
          ui.info('no skills found. Add .chan/skills/<id>/SKILL.md or ~/.chan_code/skills/<id>/SKILL.md');
          return false;
        }
        for (const skill of skills) {
          ui.line(`  ${ui.cyan(skill.id.padEnd(20))} ${ui.dim(skill.description || '')}${skill.hidden ? ui.dim(' [hidden]') : ''}`);
        }
        return false;
      }
      case 'commands': {
        const commands = loadCommands({ cwd, config });
        if (!commands.length) {
          ui.info('no custom commands. Add .chan/commands/<name>.md or ~/.chan_code/commands/<name>.md');
          return false;
        }
        for (const item of commands) {
          ui.line(`  ${ui.cyan(`/${item.name}`.padEnd(22))} ${ui.dim(item.description || '')}${item.subagent ? ui.dim(' [subagent]') : ''}`);
        }
        return false;
      }
      case 'mcp':
      case 'mcps': {
        if (!mcpManager) {
          ui.info('MCP is only connected when a manager is available');
          return false;
        }
        if (arg === 'refresh') {
          await mcpManager.refresh();
          ui.info('MCP servers refreshed');
        }
        const statuses = mcpManager.statusesList();
        if (!statuses.length) {
          ui.info('no MCP servers configured. Add mcp.servers to the config file.');
          return false;
        }
        for (const status of statuses) {
          const state = status.connected ? ui.green('connected') : ui.red('failed');
          ui.line(`  ${ui.cyan(status.name.padEnd(16))} ${String(status.type).padEnd(8)} ${state}`);
          if (status.connected) ui.line(ui.dim(`    tools: ${status.tools.join(', ') || '(none)'}`));
          else if (status.error) ui.line(ui.dim(`    ${status.error}`));
        }
        return false;
      }
      case 'cwd':
        ui.line(cwd);
        return false;
      case 'config':
        ui.line(JSON.stringify(redactConfig(config), null, 2));
        return false;
      case 'about': {
        const target = path.join(SITE_DIR, 'index.html');
        if (fs.existsSync(target)) openBrowser(pathToFileURL(target).href);
        else ui.info('landing page missing; run "chan serve" and open /about');
        return false;
      }
      default:
        ui.error(`unknown command /${command} — try /help`);
        return false;
    }
  }

  let sigintCount = 0;
  rl.on('SIGINT', () => {
    if (currentAbort) {
      sigintCount = 0;
      currentAbort.abort();
      process.stdout.write('\n');
      ui.warn('stopping…');
      return;
    }
    sigintCount += 1;
    process.stdout.write('\n');
    if (sigintCount >= 2) {
      rl.close();
      return;
    }
    ui.info('press Ctrl+C again to exit, or type /exit');
    process.stdout.write(prompt());
  });

  function printSlashMenu() {
    ui.line();
    ui.line(renderSlashMenu());
    ui.line(ui.dim('Tab completes commands, subcommands and provider names.'));
    ui.line();
  }

  let slashHintShown = false;
  if (process.stdin.isTTY) {
    const onKeypress = () => {
      setImmediate(() => {
        try {
          if (rl.line === '/') {
            if (!slashHintShown) {
              slashHintShown = true;
              process.stdout.write('\r\u001b[2K');
              ui.line(renderSlashMenu());
              ui.line(ui.dim('Tab completes commands, subcommands and provider names.'));
              rl.prompt(true);
            }
          } else if (rl.line === '' || !rl.line.startsWith('/')) {
            slashHintShown = false;
          }
        } catch {
          /* ignore */
        }
      });
    };
    process.stdin.on('keypress', onKeypress);
    rl.on('close', () => process.stdin.off('keypress', onKeypress));
  }

  ui.line();
  ui.banner({
    provider: config.defaultProvider,
    model: provider?.model || getModelName(config),
    cwd,
    version,
    approval: approvalMode(),
  });
  ui.info(`session ${session.id}${session.messages.length ? ` · resumed with ${session.messages.length} messages` : ''}`);
  ui.info(`agent: ${session.agent || config.agent.defaultAgent || 'build'} · skills/commands/agents load from .chan/ and ${APP_HOME}`);
  if (!provider) ui.warn(`${providerError || 'provider not configured'} — run "chan config set providers.${config.defaultProvider}.apiKey=..."`);
  ui.line(ui.dim('Type a task, or type / for the command menu. Try /commands, /skills, /agents, /mcps.'));
  ui.line();

  while (!closed || buffered.length) {
    const line = await readLine(prompt());
    if (line === null) break;
    const input = line.trim();
    if (!input) continue;
    if (input === '/') {
      printSlashMenu();
      continue;
    }
    history.push(input);
    if (input.startsWith('/')) {
      const inputName = input.slice(1).split(/\s+/)[0].toLowerCase();
      if (!BUILTIN_COMMANDS.has(inputName)) {
        const customCommand = loadCommands({ cwd, config }).find((item) => item.name.toLowerCase() === inputName);
        if (!customCommand) {
          ui.error(`unknown command /${inputName} — try /help or /commands`);
          continue;
        }
        try {
          await runCustomCommand(customCommand, input.slice(1 + inputName.length).trim());
        } catch (err) {
          ui.error(err.message);
        }
        ui.line();
        continue;
      }
      try {
        const shouldExit = await handleCommand(input);
        if (shouldExit) break;
      } catch (err) {
        ui.error(err.message);
      }
      continue;
    }
    if (pendingImages.length) ui.info(`${pendingImages.length} attachment(s) included`);
    await turn(input);
    ui.line();
  }

  ui.stop();
  rl.close();
  if (webHandle) await webHandle.server.close().catch(() => {});
  ui.info('bye');
}

function getModelName(config) {
  try {
    return getProviderConfig(config, config.defaultProvider).model;
  } catch {
    return '—';
  }
}

export { SLASH_COMMANDS as COMMAND_HELP };
