const BOOLEAN_FLAGS = new Set([
  'help', 'version', 'open', 'json', 'force', 'verbose', 'presets', 'print', 'yes', 'no-project',
]);
const VALUE_FLAGS = new Set([
  'provider', 'model', 'cwd', 'approval', 'max-steps', 'maxSteps', 'file', 'port', 'host', 'token', 'resume', 'system', 'session',
]);
const ALIASES = {
  p: 'provider',
  m: 'model',
  C: 'cwd',
  f: 'file',
  h: 'help',
  v: 'version',
  o: 'open',
  V: 'verbose',
};

export function parseArgs(argv = []) {
  const flags = {};
  const positionals = [];
  const assign = (key, value) => {
    if (key === 'file') {
      flags.file = Array.isArray(flags.file) ? [...flags.file, value] : [value];
    } else {
      flags[key] = value;
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      let key = (eq === -1 ? body : body.slice(0, eq)).trim();
      let value = eq === -1 ? undefined : body.slice(eq + 1);
      if (key.startsWith('no-') && BOOLEAN_FLAGS.has(key.slice(3))) {
        flags[key.slice(3)] = false;
        continue;
      }
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = value === undefined ? true : value !== 'false';
        continue;
      }
      if (VALUE_FLAGS.has(key)) {
        if (value === undefined) {
          value = argv[i + 1];
          if (value === undefined) throw new Error(`flag --${key} requires a value`);
          i += 1;
        }
        assign(key === 'maxSteps' ? 'max-steps' : key, value);
        continue;
      }
      throw new Error(`unknown flag --${key}. Run "chan --help" for usage.`);
    }
    if (/^-[a-zA-Z]$/.test(arg)) {
      const key = ALIASES[arg.slice(1)] || arg.slice(1);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      if (VALUE_FLAGS.has(key)) {
        const value = argv[i + 1];
        if (value === undefined) throw new Error(`flag ${arg} requires a value`);
        i += 1;
        assign(key, value);
        continue;
      }
      throw new Error(`unknown flag ${arg}. Run "chan --help" for usage.`);
    }
    positionals.push(arg);
  }
  return { flags, positionals };
}
