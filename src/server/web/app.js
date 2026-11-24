const TOKEN_KEY = 'chan_token';
const CWD_KEY = 'chan_cwd';
const THEME_KEY = 'chan_theme';

const state = {
  token: '',
  config: null,
  providers: [],
  sessions: [],
  session: null,
  busy: false,
  abort: null,
  attachments: [],
  live: null,
  agents: [],
  defaultAgent: 'build',
  commands: [],
  slashItems: [],
  slashIndex: 0,
};

const el = {
  sidebar: document.getElementById('sidebar'),
  menu: document.getElementById('menu'),
  sessionList: document.getElementById('session-list'),
  newSession: document.getElementById('new-session'),
  title: document.getElementById('session-title'),
  meta: document.getElementById('session-meta'),
  messages: document.getElementById('messages'),
  empty: document.getElementById('empty-state'),
  provider: document.getElementById('provider-select'),
  agent: document.getElementById('agent-select'),
  model: document.getElementById('model-input'),
  approval: document.getElementById('approval-select'),
  settingsBtn: document.getElementById('settings-btn'),
  forkBtn: document.getElementById('fork-btn'),
  exportBtn: document.getElementById('export-btn'),
  compactBtn: document.getElementById('compact-btn'),
  slashMenu: document.getElementById('slash-menu'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  stop: document.getElementById('stop'),
  attachImage: document.getElementById('attach-image'),
  attachFile: document.getElementById('attach-file'),
  imageInput: document.getElementById('image-input'),
  fileInput: document.getElementById('file-input'),
  attachments: document.getElementById('attachments'),
  themeToggle: document.getElementById('theme-toggle'),
  dialog: document.getElementById('settings'),
  setDefaultProvider: document.getElementById('set-default-provider'),
  setApproval: document.getElementById('set-approval'),
  setMaxSteps: document.getElementById('set-max-steps'),
  setCwd: document.getElementById('set-cwd'),
  setSystem: document.getElementById('set-system'),
  setProviderName: document.getElementById('set-provider-name'),
  setModel: document.getElementById('set-model'),
  setBaseUrl: document.getElementById('set-base-url'),
  setApiKey: document.getElementById('set-api-key'),
  setToken: document.getElementById('set-token'),
  providerStatus: document.getElementById('provider-status'),
  settingsStatus: document.getElementById('settings-status'),
  settingsSave: document.getElementById('settings-save'),
  settingsCancel: document.getElementById('settings-cancel'),
};

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

function renderMarkdown(text) {
  const codeBlocks = [];
  let rest = String(text || '').replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    codeBlocks.push(
      `<pre><code data-lang="${escapeHtml(lang)}">${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`,
    );
    return `\u0000${codeBlocks.length - 1}\u0000`;
  });
  rest = escapeHtml(rest);
  rest = rest.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  rest = rest.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  rest = rest.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  rest = rest.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  rest = rest.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  rest = rest.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  rest = rest.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  rest = rest.replace(/(?:^|\n)((?:[-*] .*(?:\n|$))+)/g, (_m, block) => {
    const items = block
      .trim()
      .split('\n')
      .map((line) => `<li>${line.replace(/^[-*] /, '')}</li>`)
      .join('');
    return `\n<ul>${items}</ul>`;
  });
  const paragraphs = rest
    .split(/\n{2,}/)
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return '';
      if (/^<(h\d|ul|pre|blockquote)/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
  return paragraphs.replace(/\u0000(\d+)\u0000/g, (_m, index) => codeBlocks[Number(index)] || '');
}

function relativeTime(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
}

async function ensureToken(force = false) {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('token');
  if (fromUrl) {
    state.token = fromUrl;
    localStorage.setItem(TOKEN_KEY, fromUrl);
    params.delete('token');
    history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
  }
  if (state.token && !force) return state.token;
  state.token = localStorage.getItem(TOKEN_KEY) || '';
  return state.token;
}

async function rawFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  return fetch(path, { ...options, headers });
}

async function api(path, options = {}) {
  await ensureToken();
  let res = await rawFetch(path, options);
  if (res.status === 401) {
    const entered = window.prompt('This chan_code server requires a token. Enter it now:');
    if (!entered) throw new Error('server token is required');
    state.token = entered.trim();
    localStorage.setItem(TOKEN_KEY, state.token);
    res = await rawFetch(path, options);
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message = isJson ? payload.error || `HTTP ${res.status}` : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return payload;
}

function setBusy(busy) {
  state.busy = busy;
  el.send.disabled = busy;
  el.stop.hidden = !busy;
  el.send.hidden = busy;
  el.input.disabled = false;
}

function showEmpty(show) {
  el.empty.style.display = show ? '' : 'none';
}

function clearMessages() {
  for (const child of [...el.messages.children]) {
    if (child !== el.empty) child.remove();
  }
}

function nearBottom() {
  return el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight < 140;
}

function scrollDown(force = false) {
  if (force || nearBottom()) el.messages.scrollTop = el.messages.scrollHeight;
}

function addMessageShell(role, label) {
  const wrap = document.createElement('div');
  wrap.className = `message ${role}`;
  const head = document.createElement('div');
  head.className = 'message-head';
  head.textContent = label;
  wrap.appendChild(head);
  el.messages.appendChild(wrap);
  scrollDown(true);
  return wrap;
}

const roleLabel = (role) => (role === 'user' ? 'you' : 'chan_code');

function summaryArgs(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    const parts = [];
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        const flat = value.replace(/\s+/g, ' ');
        parts.push(`${key}: ${flat.length > 90 ? `${flat.slice(0, 90)}…` : flat}`);
      } else {
        parts.push(`${key}: ${JSON.stringify(value).slice(0, 60)}`);
      }
      if (parts.join(', ').length > 120) break;
    }
    return parts.join(', ');
  } catch {
    return String(raw || '').slice(0, 120);
  }
}

function createToolCard(name, argsText) {
  const details = document.createElement('details');
  details.className = 'tool';
  const summary = document.createElement('summary');
  const badge = document.createElement('span');
  badge.className = 'badge running';
  badge.textContent = 'running';
  const toolName = document.createElement('span');
  toolName.className = 'tool-name';
  toolName.textContent = name;
  const toolArgs = document.createElement('span');
  toolArgs.className = 'tool-args';
  toolArgs.textContent = summaryArgs(argsText);
  summary.append(badge, toolName, toolArgs);
  const pre = document.createElement('pre');
  pre.textContent = '';
  details.append(summary, pre);
  el.messages.appendChild(details);
  scrollDown();
  return { details, badge, pre };
}

function renderAttachmentsPreview(container, images) {
  if (!images?.length) return;
  const strip = document.createElement('div');
  strip.className = 'attachments-preview';
  for (const image of images) {
    if (image.dataUrl && image.mediaType?.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = image.dataUrl;
      img.alt = image.name || 'image';
      strip.appendChild(img);
    } else {
      const chip = document.createElement('span');
      chip.className = 'file-chip';
      chip.textContent = image.name || image.path || 'file';
      strip.appendChild(chip);
    }
  }
  container.appendChild(strip);
}

function renderUserMessage(message) {
  const wrap = addMessageShell('user', 'you');
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = message.content || '';
  wrap.appendChild(bubble);
  if (message.images?.length) {
    const strip = document.createElement('div');
    strip.className = 'attachments-preview';
    for (const image of message.images) {
      if (image.dataUrl) {
        const img = document.createElement('img');
        img.src = image.dataUrl;
        img.alt = image.name || 'image';
        strip.appendChild(img);
      } else {
        const chip = document.createElement('span');
        chip.className = 'file-chip';
        chip.textContent = image.name || image.path || 'image';
        strip.appendChild(chip);
      }
    }
    wrap.appendChild(strip);
  }
}

function renderAssistantMessage(message) {
  const wrap = addMessageShell('assistant', 'chan_code');
  if (message.reasoning) {
    const reasoning = document.createElement('div');
    reasoning.className = 'reasoning visible';
    reasoning.textContent = message.reasoning;
    wrap.appendChild(reasoning);
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = renderMarkdown(message.content || '');
  wrap.appendChild(bubble);
}

function renderToolResult(card, ok, output) {
  card.badge.className = `badge ${ok ? 'ok' : 'fail'}`;
  card.badge.textContent = ok ? 'done' : 'error';
  card.pre.textContent = String(output || '').slice(0, 20000);
  card.details.open = !ok;
}

function renderHistory(session) {
  clearMessages();
  const messages = session.messages || [];
  showEmpty(messages.length === 0);
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (message.role === 'user') {
      renderUserMessage(message);
      index += 1;
    } else if (message.role === 'assistant') {
      if (!message.content && !message.toolCalls?.length) {
        index += 1;
        continue;
      }
      if (message.content || !message.toolCalls?.length) renderAssistantMessage(message);
      if (message.toolCalls?.length) {
        const results = new Map();
        let cursor = index + 1;
        while (cursor < messages.length && messages[cursor].role === 'tool') {
          results.set(messages[cursor].toolCallId, messages[cursor]);
          cursor += 1;
        }
        for (const call of message.toolCalls) {
          const result = results.get(call.id);
          const card = createToolCard(call.name, call.arguments);
          if (result) {
            renderToolResult(card, !String(result.content || '').startsWith('Error:'), result.content);
          }
        }
        index = cursor;
      } else {
        index += 1;
      }
    } else {
      index += 1;
    }
  }
  scrollDown(true);
}

function renderSessions() {
  el.sessionList.innerHTML = '';
  if (!state.sessions.length) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.style.padding = '8px';
    hint.textContent = 'No sessions yet. Start one by sending a message.';
    el.sessionList.appendChild(hint);
    return;
  }
  for (const session of state.sessions) {
    const item = document.createElement('button');
    item.className = `session-item${state.session?.id === session.id ? ' active' : ''}`;
    item.type = 'button';
    const st = document.createElement('div');
    st.className = 'st';
    const title = document.createElement('strong');
    title.textContent = session.title || 'New session';
    const sub = document.createElement('small');
    sub.textContent = `${relativeTime(session.updatedAt)} · ${session.provider || 'default'}`;
    st.append(title, sub);
    const del = document.createElement('span');
    del.className = 'session-del';
    del.textContent = '×';
    del.title = 'Delete session';
    del.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!window.confirm(`Delete "${session.title || 'session'}"?`)) return;
      try {
        await api(`/api/sessions/${session.id}`, { method: 'DELETE' });
        if (state.session?.id === session.id) startNewSession();
        await loadSessions();
      } catch (err) {
        window.alert(err.message);
      }
    });
    item.append(st, del);
    item.addEventListener('click', () => openSession(session.id));
    el.sessionList.appendChild(item);
  }
}

function updateHeader() {
  const session = state.session;
  el.title.textContent = session?.title || 'chan_code';
  const provider = session?.provider || el.provider.value || state.config?.defaultProvider || '—';
  const model = session?.model || el.model.value || '—';
  const agent = el.agent.value || session?.agent || state.defaultAgent || 'build';
  const status = state.busy ? 'working…' : 'ready';
  el.meta.textContent = `${agent} · ${provider} · ${model} · ${status}`;
}

function setSession(session) {
  state.session = session;
  if (session) {
    if (session.provider) el.provider.value = session.provider;
    if (session.model) el.model.value = session.model;
    if (session.approval) el.approval.value = session.approval;
    if (session.agent) el.agent.value = session.agent;
    renderHistory(session);
  } else {
    clearMessages();
    showEmpty(true);
  }
  hideSlashMenu();
  updateHeader();
  renderSessions();
  loadAgentOptions();
  loadSlashCommands();
}

function startNewSession() {
  if (state.busy) {
    window.alert('Wait for the current response to finish, or press Stop.');
    return;
  }
  setSession(null);
  el.input.focus();
}

async function openSession(id) {
  if (state.busy && state.session?.id !== id) {
    window.alert('Wait for the current response to finish first.');
    return;
  }
  try {
    const { session } = await api(`/api/sessions/${id}`);
    setSession(session);
    closeSidebarOnMobile();
  } catch (err) {
    window.alert(err.message);
  }
}

async function loadSessions() {
  try {
    const { sessions } = await api('/api/sessions');
    state.sessions = sessions;
    renderSessions();
  } catch {
    state.sessions = [];
    renderSessions();
  }
}

function applyProviderSelection(name) {
  const provider = state.providers.find((p) => p.name === name);
  if (provider?.model) el.model.value = provider.model;
  updateHeader();
}

function extensionsCwd() {
  return state.session?.cwd || localStorage.getItem(CWD_KEY) || '';
}

async function loadAgentOptions() {
  const cwd = extensionsCwd();
  const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
  let data;
  try {
    data = await api(`/api/agents${query}`);
  } catch {
    data = { agents: [], defaultAgent: 'build' };
  }
  state.agents = data.agents || [];
  state.defaultAgent = data.defaultAgent || 'build';
  const current = state.session?.agent || el.agent.value || state.defaultAgent;
  el.agent.innerHTML = '';
  const list = state.agents.filter((agent) => !agent.hidden);
  if (!list.length) {
    el.agent.add(new Option('build', 'build'));
  } else {
    for (const agent of list) el.agent.add(new Option(`${agent.name} · ${agent.mode}`, agent.name));
  }
  if ([...el.agent.options].some((option) => option.value === current)) el.agent.value = current;
  updateHeader();
}

async function loadSlashCommands() {
  const cwd = extensionsCwd();
  const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
  try {
    const data = await api(`/api/commands${query}`);
    state.commands = data.commands || [];
  } catch {
    state.commands = [];
  }
  updateSlashMenu();
}

function hideSlashMenu() {
  state.slashItems = [];
  if (el.slashMenu) el.slashMenu.hidden = true;
}

function renderSlashMenu() {
  if (!state.slashItems.length) {
    hideSlashMenu();
    return;
  }
  el.slashMenu.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'slash-title';
  title.textContent = 'Custom commands';
  el.slashMenu.appendChild(title);
  state.slashItems.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `slash-item${index === state.slashIndex ? ' active' : ''}`;
    const name = document.createElement('code');
    name.textContent = `/${item.name}`;
    const description = document.createElement('span');
    description.textContent = item.description || '';
    button.append(name, description);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => applySlashCommand(item));
    el.slashMenu.appendChild(button);
  });
  el.slashMenu.hidden = false;
}

function updateSlashMenu() {
  const value = el.input.value;
  if (!value.startsWith('/') || value.includes(' ')) {
    hideSlashMenu();
    return;
  }
  const query = value.slice(1).toLowerCase();
  const items = state.commands.filter((command) => command.name.toLowerCase().startsWith(query)).slice(0, 8);
  if (!items.length) {
    hideSlashMenu();
    return;
  }
  const previous = state.slashItems[state.slashIndex]?.name;
  state.slashItems = items;
  const keep = items.findIndex((item) => item.name === previous);
  state.slashIndex = keep >= 0 ? keep : 0;
  renderSlashMenu();
}

function applySlashCommand(item) {
  el.input.value = `/${item.name} `;
  hideSlashMenu();
  autoResize();
  el.input.focus();
}

async function forkCurrentSession() {
  if (!state.session) {
    window.alert('Nothing to fork yet.');
    return;
  }
  if (state.busy) {
    window.alert('Wait for the current response to finish first.');
    return;
  }
  try {
    const { session } = await api(`/api/sessions/${state.session.id}/fork`, { method: 'POST', body: '{}' });
    await loadSessions();
    setSession(session);
  } catch (err) {
    addNote(err.message, 'error');
  }
}

function exportCurrentSession() {
  if (!state.session) {
    window.alert('Nothing to export yet.');
    return;
  }
  const token = state.token ? `&token=${encodeURIComponent(state.token)}` : '';
  window.open(`/api/sessions/${state.session.id}/export?format=markdown${token}`, '_blank');
}

async function compactCurrentSession() {
  if (!state.session || state.busy) {
    window.alert('Wait for the current response to finish first.');
    return;
  }
  if (!window.confirm('Compact this conversation into a summary? Older messages will be replaced.')) return;
  setBusy(true);
  addNote('Compacting conversation context…', 'warn');
  try {
    const data = await api(`/api/sessions/${state.session.id}/compact`, {
      method: 'POST',
      body: JSON.stringify({
        provider: el.provider.value || undefined,
        model: el.model.value || undefined,
      }),
    });
    const result = await api(`/api/sessions/${state.session.id}`);
    setSession(result.session);
    addNote(`Context compacted. ${String(data.summary || '').slice(0, 400)}`, 'warn');
    await loadSessions();
  } catch (err) {
    addNote(err.message, 'error');
  } finally {
    setBusy(false);
  }
}

function renderProviderOptions() {
  el.provider.innerHTML = '';
  el.setDefaultProvider.innerHTML = '';
  el.setProviderName.innerHTML = '';
  for (const provider of state.providers) {
    const option = new Option(`${provider.label || provider.name}`, provider.name);
    el.provider.add(option.cloneNode(true));
    el.setDefaultProvider.add(option.cloneNode(true));
    el.setProviderName.add(option.cloneNode(true));
  }
}

async function loadConfig() {
  const data = await api('/api/config');
  state.config = data.config;
  state.providers = data.providers || [];
  renderProviderOptions();
  const selectedProvider = state.session?.provider || data.defaultProvider || state.providers[0]?.name;
  el.provider.value = selectedProvider;
  el.model.value = state.session?.model || state.providers.find((p) => p.name === selectedProvider)?.model || '';
  el.approval.value = state.session?.approval || state.config.agent?.approval || 'auto';
  updateHeader();
}

function settingsSetStatus(message, kind = '') {
  el.settingsStatus.textContent = message;
  el.settingsStatus.className = `status-line ${kind}`;
}

function refreshProviderStatus() {
  const name = el.setProviderName.value;
  const provider = state.providers.find((p) => p.name === name);
  if (!provider) {
    el.providerStatus.textContent = '—';
    return;
  }
  const keyState = provider.hasApiKey ? 'key set' : provider.local ? 'local endpoint' : 'no key';
  el.providerStatus.textContent = `${provider.type || 'openai'} · ${keyState} · ${provider.baseUrl || ''}`;
}

function openSettings() {
  const cfg = state.config || {};
  el.setDefaultProvider.value = cfg.defaultProvider || state.providers[0]?.name || '';
  el.setApproval.value = cfg.agent?.approval || 'auto';
  el.setMaxSteps.value = cfg.agent?.maxSteps || 40;
  el.setCwd.value = localStorage.getItem(CWD_KEY) || '';
  el.setSystem.value = cfg.agent?.systemPrompt || '';
  el.setProviderName.value = state.session?.provider || cfg.defaultProvider || state.providers[0]?.name || '';
  const provider = state.providers.find((p) => p.name === el.setProviderName.value);
  el.setModel.value = state.session?.model || provider?.model || '';
  el.setBaseUrl.value = provider?.baseUrl || '';
  el.setApiKey.value = '';
  el.setToken.value = state.token || '';
  settingsSetStatus('');
  refreshProviderStatus();
  el.dialog.showModal();
}

async function saveSettings() {
  const name = el.setProviderName.value;
  if (!name || !el.setModel.value.trim() || !el.setBaseUrl.value.trim()) {
    settingsSetStatus('Provider, model and base URL are required.', 'err');
    return;
  }
  const body = {
    defaultProvider: el.setDefaultProvider.value,
    agent: {
      approval: el.setApproval.value,
      maxSteps: Number(el.setMaxSteps.value) || 40,
      systemPrompt: el.setSystem.value,
    },
    providers: {
      [name]: {
        model: el.setModel.value.trim(),
        baseUrl: el.setBaseUrl.value.trim(),
        ...(el.setApiKey.value.trim() ? { apiKey: el.setApiKey.value.trim() } : {}),
      },
    },
    server: {},
  };
  if (el.setToken.value.trim() && el.setToken.value.trim() !== state.token) {
    body.server.token = el.setToken.value.trim();
  }
  try {
    settingsSetStatus('Saving…');
    await api('/api/config', { method: 'PUT', body: JSON.stringify(body) });
    if (body.server.token) {
      state.token = body.server.token;
      localStorage.setItem(TOKEN_KEY, state.token);
    }
    const cwd = el.setCwd.value.trim();
    if (cwd) localStorage.setItem(CWD_KEY, cwd);
    else localStorage.removeItem(CWD_KEY);
    await loadConfig();
    await loadAgentOptions();
    await loadSlashCommands();
    if (state.session) {
      state.session.provider = name;
      state.session.model = el.setModel.value.trim() || state.session.model;
      await api(`/api/sessions/${state.session.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ provider: name, model: el.setModel.value.trim(), approval: el.setApproval.value }),
      }).catch(() => {});
    }
    settingsSetStatus('Saved.', 'ok');
    setTimeout(() => el.dialog.close(), 450);
  } catch (err) {
    settingsSetStatus(err.message, 'err');
  }
}

function renderAttachments() {
  el.attachments.innerHTML = '';
  for (const [index, attachment] of state.attachments.entries()) {
    const chip = document.createElement('span');
    chip.className = 'attach-chip';
    if (attachment.kind === 'image' && attachment.dataUrl) {
      const img = document.createElement('img');
      img.src = attachment.dataUrl;
      chip.appendChild(img);
    }
    const label = document.createElement('span');
    label.textContent = attachment.name;
    chip.appendChild(label);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.addEventListener('click', () => {
      state.attachments.splice(index, 1);
      renderAttachments();
    });
    chip.appendChild(remove);
    el.attachments.appendChild(chip);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function addFiles(fileList) {
  for (const file of fileList) {
    if (!file) continue;
    if (file.size > 12 * 1024 * 1024) {
      window.alert(`${file.name} is larger than 12MB.`);
      continue;
    }
    const dataUrl = await readFileAsDataUrl(file);
    if (file.type.startsWith('image/')) {
      state.attachments.push({ kind: 'image', name: file.name, mediaType: file.type, dataUrl });
    } else {
      try {
        const saved = await api('/api/upload', {
          method: 'POST',
          body: JSON.stringify({ name: file.name, dataUrl, cwd: state.session?.cwd }),
        });
        state.attachments.push({ kind: 'file', name: file.name, path: saved.path });
      } catch (err) {
        window.alert(`Upload failed: ${err.message}`);
      }
    }
  }
  renderAttachments();
}

function parseSSEBlock(block) {
  let event = 'message';
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

function handleEvent(event, data) {
  if (event === 'ready') {
    if (state.session) {
      state.session.title = data.title;
      state.session.provider = data.provider;
      state.session.model = data.model;
      if (data.agent) {
        state.session.agent = data.agent;
        if ([...el.agent.options].some((option) => option.value === data.agent)) el.agent.value = data.agent;
      }
    }
    updateHeader();
    return;
  }
  if (event === 'step') {
    state.live = null;
    return;
  }
  if (event === 'text-delta') {
    if (!state.live) {
      const wrap = addMessageShell('assistant', 'chan_code');
      const reasoning = document.createElement('div');
      reasoning.className = 'reasoning';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      wrap.append(reasoning, bubble);
      state.live = { wrap, bubble, reasoning, text: '', reasoningText: '' };
    }
    state.live.text += data.text;
    state.live.bubble.textContent = state.live.text;
    scrollDown();
    return;
  }
  if (event === 'reasoning-delta') {
    if (!state.live) return;
    state.live.reasoningText += data.text;
    state.live.reasoning.textContent = state.live.reasoningText;
    state.live.reasoning.classList.add('visible');
    scrollDown();
    return;
  }
  if (event === 'assistant') {
    const message = data.message || {};
    if (state.live) {
      if (message.reasoning) {
        state.live.reasoning.textContent = message.reasoning;
        state.live.reasoning.classList.add('visible');
      }
      state.live.bubble.innerHTML = renderMarkdown(message.content || state.live.text || '');
      state.live = null;
    } else if (message.content) {
      renderAssistantMessage(message);
    }
    return;
  }
  if (event === 'tool-call') {
    state.lastTool = createToolCard(data.name, data.arguments);
    return;
  }
  if (event === 'tool-result') {
    if (state.lastTool) {
      renderToolResult(state.lastTool, data.ok, data.output);
      state.lastTool = null;
    }
    return;
  }
  if (event === 'approval-request') {
    renderApproval(data);
    return;
  }
  if (event === 'warning') {
    addNote(data.message, 'warn');
    return;
  }
  if (event === 'error') {
    addNote(data.message, 'error');
    return;
  }
  if (event === 'aborted') {
    addNote('Generation stopped.', 'warn');
    return;
  }
  if (event === 'session') {
    if (data.session) {
      state.session = { ...state.session, ...data.session };
      updateHeader();
    }
    return;
  }
  if (event === 'end') {
    loadSessions();
  }
}

function addNote(text, kind = '') {
  const note = document.createElement('div');
  note.className = `note ${kind}`.trim();
  note.textContent = text;
  el.messages.appendChild(note);
  scrollDown();
}

function renderApproval(request) {
  const box = document.createElement('div');
  box.className = 'approval';
  const title = document.createElement('div');
  const reason = request.danger || request.reason || 'tool execution';
  title.innerHTML = `<strong>Approval required</strong> · ${escapeHtml(reason)}`;
  const cmd = document.createElement('code');
  cmd.textContent = request.command || `${request.action || request.tool || ''} ${request.resource || ''}`.trim();
  const actions = document.createElement('div');
  actions.className = 'approval-actions';
  const approve = document.createElement('button');
  approve.className = 'btn primary small';
  approve.textContent = 'Approve';
  const always = document.createElement('button');
  always.className = 'btn small';
  always.textContent = 'Always allow';
  const deny = document.createElement('button');
  deny.className = 'btn small';
  deny.textContent = 'Deny';
  const finish = async (approved, remember = false) => {
    approve.disabled = true;
    always.disabled = true;
    deny.disabled = true;
    try {
      const result = await api('/api/approve', {
        method: 'POST',
        body: JSON.stringify({ callId: request.callId, approved, remember }),
      });
      const suffix = result?.remembered && result.rule ? ` · saved ${result.rule}` : '';
      title.innerHTML = `<strong>${approved ? 'Approved' : 'Denied'}</strong> · ${escapeHtml(request.tool || 'tool')}${escapeHtml(suffix)}`;
    } catch (err) {
      addNote(err.message, 'error');
    }
  };
  approve.addEventListener('click', () => finish(true));
  always.addEventListener('click', () => finish(true, true));
  deny.addEventListener('click', () => finish(false));
  actions.append(approve);
  if (request.permission) actions.append(always);
  actions.append(deny);
  box.append(title, cmd, actions);
  el.messages.appendChild(box);
  scrollDown(true);
}

async function ensureSession() {
  if (state.session) return state.session;
  const body = {
    provider: el.provider.value || undefined,
    model: el.model.value || undefined,
    agent: el.agent.value || undefined,
    approval: el.approval.value,
  };
  const cwd = localStorage.getItem(CWD_KEY);
  if (cwd) body.cwd = cwd;
  const { session } = await api('/api/sessions', { method: 'POST', body: JSON.stringify(body) });
  state.session = session;
  state.sessions.unshift({
    id: session.id,
    title: session.title,
    provider: session.provider,
    model: session.model,
    updatedAt: session.updatedAt,
  });
  renderSessions();
  return session;
}

async function sendMessage() {
  if (state.busy) return;
  const text = el.input.value.trim();
  const images = state.attachments.filter((a) => a.kind === 'image');
  const files = state.attachments.filter((a) => a.kind === 'file');
  if (!text && !images.length && !files.length) return;

  let message = text;
  if (files.length) {
    const attachmentNote = files.map((f) => `Attached file: ${f.path}`).join('\n');
    message = message ? `${message}\n\n${attachmentNote}` : attachmentNote;
  }

  showEmpty(false);
  renderUserMessage({ content: message, images });
  el.input.value = '';
  el.input.style.height = 'auto';
  hideSlashMenu();
  state.attachments = [];
  renderAttachments();
  setBusy(true);
  state.live = null;
  state.lastTool = null;
  updateHeader();

  const controller = new AbortController();
  state.abort = controller;

  try {
    const session = await ensureSession();
    const response = await rawFetch(`/api/sessions/${session.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        images: images.map((image) => ({ name: image.name, mediaType: image.mediaType, dataUrl: image.dataUrl })),
        provider: el.provider.value || undefined,
        model: el.model.value || undefined,
        agent: el.agent.value || undefined,
        approval: el.approval.value,
      }),
      signal: controller.signal,
    });

    if (response.status === 401) {
      const entered = window.prompt('Server token required. Enter it now:');
      if (entered) {
        state.token = entered.trim();
        localStorage.setItem(TOKEN_KEY, state.token);
      }
      throw new Error('unauthorized — reload and try again with a token');
    }
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        detail = body.error || detail;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    if (el.approval.value === 'ask') addNote('Approval mode: ask — risky commands will request your approval.', 'warn');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSSEBlock(block);
        if (parsed) handleEvent(parsed.event, parsed.data);
      }
    }
    if (buffer.trim()) {
      const parsed = parseSSEBlock(buffer);
      if (parsed) handleEvent(parsed.event, parsed.data);
    }
  } catch (err) {
    if (err.name === 'AbortError') addNote('Stopped by user.', 'warn');
    else addNote(err.message, 'error');
  } finally {
    setBusy(false);
    state.abort = null;
    state.live = null;
    updateHeader();
    loadSessions();
  }
}

function closeSidebarOnMobile() {
  el.sidebar.classList.remove('open');
}

function autoResize() {
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(el.input.scrollHeight, 220)}px`;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

function bindEvents() {
  el.send.addEventListener('click', sendMessage);
  el.stop.addEventListener('click', () => state.abort?.abort());
  el.newSession.addEventListener('click', () => {
    startNewSession();
    closeSidebarOnMobile();
  });
  el.menu.addEventListener('click', () => el.sidebar.classList.toggle('open'));
  el.provider.addEventListener('change', () => applyProviderSelection(el.provider.value));
  el.model.addEventListener('change', () => updateHeader());
  el.agent.addEventListener('change', () => {
    updateHeader();
    if (state.session) {
      api(`/api/sessions/${state.session.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ agent: el.agent.value }),
      }).catch(() => {});
    }
  });
  el.forkBtn.addEventListener('click', forkCurrentSession);
  el.exportBtn.addEventListener('click', exportCurrentSession);
  el.compactBtn.addEventListener('click', compactCurrentSession);
  el.approval.addEventListener('change', () => {
    if (state.session) {
      api(`/api/sessions/${state.session.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ approval: el.approval.value }),
      }).catch(() => {});
    }
  });
  el.settingsBtn.addEventListener('click', openSettings);
  document.getElementById('settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings();
  });
  el.settingsSave.addEventListener('click', saveSettings);
  el.settingsCancel.addEventListener('click', () => el.dialog.close());
  el.setProviderName.addEventListener('change', () => {
    const provider = state.providers.find((p) => p.name === el.setProviderName.value);
    if (provider) {
      el.setModel.value = provider.model || '';
      el.setBaseUrl.value = provider.baseUrl || '';
    }
    el.setApiKey.value = '';
    refreshProviderStatus();
  });
  el.themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
  });
  el.attachImage.addEventListener('click', () => el.imageInput.click());
  el.attachFile.addEventListener('click', () => el.fileInput.click());
  el.imageInput.addEventListener('change', async () => {
    await addFiles(el.imageInput.files);
    el.imageInput.value = '';
  });
  el.fileInput.addEventListener('change', async () => {
    await addFiles(el.fileInput.files);
    el.fileInput.value = '';
  });
  el.input.addEventListener('input', () => {
    autoResize();
    updateSlashMenu();
  });
  el.input.addEventListener('blur', () => setTimeout(hideSlashMenu, 120));
  el.input.addEventListener('keydown', (event) => {
    if (!el.slashMenu.hidden && state.slashItems.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        state.slashIndex = (state.slashIndex + delta + state.slashItems.length) % state.slashItems.length;
        renderSlashMenu();
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        applySlashCommand(state.slashItems[state.slashIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideSlashMenu();
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  el.input.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  });
  for (const target of [el.messages, document.querySelector('.composer')]) {
    target.addEventListener('dragover', (event) => event.preventDefault());
    target.addEventListener('drop', (event) => {
      event.preventDefault();
      if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
    });
  }
  for (const button of document.querySelectorAll('.suggestion')) {
    button.addEventListener('click', () => {
      el.input.value = button.textContent;
      autoResize();
      el.input.focus();
    });
  }
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'n') {
      event.preventDefault();
      startNewSession();
    }
  });
}

async function boot() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
  await ensureToken();
  bindEvents();
  try {
    await loadConfig();
    await loadSessions();
    if (state.sessions.length) {
      const { session } = await api(`/api/sessions/${state.sessions[0].id}`);
      setSession(session);
    } else {
      setSession(null);
    }
  } catch (err) {
    addNote(`Could not connect to chan_code: ${err.message}`, 'error');
  }
  el.input.focus();
}

boot();
