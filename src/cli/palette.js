export const SLASH_COMMANDS = [
  { command: '/help', args: '', description: 'show the command menu' },
  { command: '/session', args: '<list|new|resume|delete|rename|show>', description: 'manage sessions' },
  { command: '/sessions', args: '', description: 'list saved sessions (alias)', hidden: true },
  { command: '/resume', args: '<id>', description: 'resume a saved session (alias)', hidden: true },
  { command: '/connect', args: '[provider]', description: 'connect a provider: type, base URL, model, API key' },
  { command: '/login', args: '[provider]', description: 'alias of /connect', hidden: true },
  { command: '/agent', args: '[name]', description: 'show or switch the main agent profile' },
  { command: '/agents', args: '', description: 'list agent profiles' },
  { command: '/skills', args: '', description: 'list discovered skills' },
  { command: '/commands', args: '', description: 'list custom commands' },
  { command: '/mcps', args: '[refresh]', description: 'show MCP servers and tools' },
  { command: '/model', args: '[name]', description: 'show or change the model' },
  { command: '/provider', args: '[name]', description: 'show or switch the provider' },
  { command: '/approval', args: '[auto|ask|deny]', description: 'set the command approval mode' },
  { command: '/attach', args: '<image path>', description: 'attach an image to the next message' },
  { command: '/detach', args: '', description: 'clear pending attachments' },
  { command: '/tools', args: '', description: 'list the agent tools' },
  { command: '/web', args: '[open|stop]', description: 'start or stop the browser UI' },
  { command: '/cwd', args: '', description: 'print the workspace directory' },
  { command: '/config', args: '', description: 'show the effective config (secrets redacted)' },
  { command: '/new', args: '', description: 'start a new session' },
  { command: '/clear', args: '', description: 'alias of /new', hidden: true },
  { command: '/about', args: '', description: 'open the landing page' },
  { command: '/exit', args: '', description: 'leave the chat' },
  { command: '/quit', args: '', description: 'alias of /exit', hidden: true },
];

const SESSION_SUBCOMMANDS = ['list', 'new', 'resume', 'delete', 'rename', 'show'];

function argOptions(command, { providers = [], files = [], agents = [] } = {}) {
  if (command === '/session') return SESSION_SUBCOMMANDS;
  if (command === '/connect' || command === '/login' || command === '/provider') return providers;
  if (command === '/agent') return agents;
  if (command === '/approval') return ['auto', 'ask', 'deny'];
  if (command === '/web') return ['open', 'stop'];
  if (command === '/mcps' || command === '/mcp') return ['refresh'];
  if (command === '/attach') return files;
  return [];
}

export function renderSlashMenu({ all = false } = {}) {
  const visible = SLASH_COMMANDS.filter((entry) => all || !entry.hidden);
  const commandWidth = Math.max(...visible.map((entry) => entry.command.length));
  const argsWidth = Math.max(...visible.map((entry) => (entry.args || '').length));
  const lines = ['chan_code commands  (Tab completes · Enter runs)'];
  for (const entry of visible) {
    const command = entry.command.padEnd(commandWidth);
    const args = (entry.args || '').padEnd(argsWidth);
    lines.push(`  ${command}  ${args}  ${entry.description}`.trimEnd());
  }
  lines.push('  type / then Enter to open this menu · /help shows all aliases');
  return lines.join('\n');
}

export function slashCompletions(line, options = {}) {
  if (typeof line !== 'string' || !line.startsWith('/')) return [[], line];
  const spaceIndex = line.indexOf(' ');
  const commandNames = SLASH_COMMANDS.map((entry) => entry.command);

  if (spaceIndex === -1) {
    const hits = commandNames.filter((command) => command.startsWith(line));
    return [hits.length ? hits : commandNames, line];
  }

  const command = line.slice(0, spaceIndex);
  const rest = line.slice(spaceIndex + 1);
  const currentWord = rest.includes(' ') ? rest.slice(rest.lastIndexOf(' ') + 1) : rest;
  const optionsForArg = argOptions(command, options);
  if (!optionsForArg.length) return [[], line];
  const hits = optionsForArg.filter((item) => item.startsWith(currentWord));
  return [hits.length ? hits : optionsForArg, line];
}
