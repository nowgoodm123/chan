import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { buildSystemPrompt } from '../agent.js';
import { getProviderConfig, loadConfig, redactConfig } from '../config.js';
import { createProvider } from '../providers/index.js';
import { startServer, openBrowser, SITE_DIR } from '../server/server.js';
import { SessionStore } from '../sessions.js';
import { createTools, describeTools } from '../tools/index.js';
import { version } from '../version.js';
import { runTurn } from './runner.js';

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

const COMMAND_HELP = [
  ['/help', 'show this help'],
  ['/exit, /quit', 'leave the chat'],
  ['/new, /clear', 'start a fresh session'],
  ['/model [name]', 'show or change the model'],
  ['/provider [name]', 'show or switch the provider'],
  ['/approval [mode]', 'auto | ask | deny bash approvals'],
  ['/attach <path>', 'attach an image to the next message'],
  ['/detach', 'clear pending attachments'],
  ['/tools', 'list available tools'],
  ['/sessions', 'list saved sessions for this workspace'],
  ['/resume <id>', 'load a saved session'],
  ['/web [stop]', 'start/stop the browser UI from here'],
  ['/cwd', 'print the workspace directory'],
  ['/config', 'show the effective config (secrets redacted)'],
  ['/about', 'open the landing page'],
];

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

export async function startRepl({ cwd, config, ui, resumeId = null, flags = {} }) {
  const store = new SessionStore({ cwd });
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

  function readLine(promptText = '') {
    if (promptText) process.stdout.write(promptText);
    if (buffered.length) return Promise.resolve(buffered.shift());
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      waiting = resolve;
    });
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

  async function turn(text) {
    const activeProvider = ensureProvider();
    const images = pendingImages.splice(0);
    const userMessage = { role: 'user', content: text };
    if (images.length) userMessage.images = images;
    session.messages.push(userMessage);
    session.updatedAt = new Date().toISOString();
    if (session.title === 'New session' || !session.title) {
      session.title = text.slice(0, 60) || 'Image message';
    }
    store.save(session);

    const controller = new AbortController();
    currentAbort = controller;
    const tools = createTools({
      cwd,
      config: config.agent,
      session,
      approve,
      signal: controller.signal,
      approvalMode: approvalMode(),
    });
    const system = buildSystemPrompt({ cwd, custom: config.agent.systemPrompt });
    ui.line();
    try {
      const result = await runTurn({
        provider: activeProvider,
        session,
        tools,
        system,
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

  async function handleCommand(line) {
    const [rawCommand, ...rest] = line.slice(1).split(/\s+/);
    const command = rawCommand.toLowerCase();
    const arg = rest.join(' ').trim();
    switch (command) {
      case 'help':
        ui.line(ui.bold('Commands'));
        for (const [name, description] of COMMAND_HELP) ui.line(`  ${ui.cyan(name.padEnd(18))} ${description}`);
        ui.line(ui.dim('Everything else is sent to the agent. Ctrl+C stops a running turn.'));
        return false;
      case 'exit':
      case 'quit':
      case 'q':
        return true;
      case 'new':
      case 'clear': {
        session = store.create({
          cwd,
          provider: config.defaultProvider,
          model: provider?.model || null,
          approval: config.agent.approval,
        });
        history.length = 0;
        pendingImages = [];
        ui.info(`new session ${session.id}`);
        return false;
      }
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
        return false;
      case 'sessions': {
        const sessions = store.list();
        if (!sessions.length) ui.info('no saved sessions yet');
        for (const item of sessions) ui.line(`  ${ui.cyan(item.id)}  ${String(item.title || '').slice(0, 50)}  ${ui.dim(item.updatedAt)}`);
        return false;
      }
      case 'resume': {
        const loaded = arg ? store.get(arg) : null;
        if (!loaded) {
          ui.error(arg ? `session not found: ${arg}` : 'usage: /resume <id>');
          return false;
        }
        session = loaded;
        config.defaultProvider = session.provider || config.defaultProvider;
        provider = safeProvider(config);
        if (session.model) {
          config.providers[config.defaultProvider] = { ...(config.providers[config.defaultProvider] || {}), model: session.model };
        }
        ui.info(`resumed ${session.id} · ${session.messages.length} messages`);
        ui.info('history is in context; type a new message to continue');
        return false;
      }
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

  const providerInfo = (() => {
    try {
      const cfg = getProviderConfig(config, config.defaultProvider);
      return `${cfg.name} · ${cfg.model}`;
    } catch {
      return 'not configured';
    }
  })();

  ui.line();
  ui.banner({
    provider: config.defaultProvider,
    model: provider?.model || getModelName(config),
    cwd,
    version,
    approval: approvalMode(),
  });
  ui.info(`session ${session.id}${session.messages.length ? ` · resumed with ${session.messages.length} messages` : ''}`);
  if (!provider) ui.warn(`${providerError || 'provider not configured'} — run "chan config set providers.${config.defaultProvider}.apiKey=..."`);
  ui.line(ui.dim('Type a task, or /help for commands.'));
  ui.line();

  while (!closed || buffered.length) {
    const line = await readLine(prompt());
    if (line === null) break;
    const input = line.trim();
    if (!input) continue;
    history.push(input);
    if (input.startsWith('/')) {
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

export { COMMAND_HELP };
