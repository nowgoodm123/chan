const ESC = '\u001b[';

function colorEnabled(stream) {
  if (process.env.NO_COLOR || process.env.TERM === 'dumb') return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(stream?.isTTY);
}

export function summarizeArgs(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    const parts = [];
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        const flat = value.replace(/\s+/g, ' ');
        parts.push(`${key}: ${flat.length > 80 ? `${flat.slice(0, 80)}…` : flat}`);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        parts.push(`${key}: ${value}`);
      } else {
        parts.push(`${key}: ${JSON.stringify(value).slice(0, 50)}`);
      }
      if (parts.join(', ').length > 110) break;
    }
    return parts.join(', ');
  } catch {
    return String(raw || '').slice(0, 110);
  }
}

function indent(text, prefix = '    ') {
  return String(text)
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

export class ConsoleUI {
  constructor({ out = process.stdout, err = process.stderr, color = colorEnabled(out), verbose = false } = {}) {
    this.out = out;
    this.err = err;
    this.color = color;
    this.verbose = verbose;
    this.spinnerTimer = null;
    this.atLineStart = true;
  }

  paint(code, text) {
    if (!this.color) return String(text);
    return `${ESC}${code}m${text}${ESC}0m`;
  }

  dim(text) {
    return this.paint('2', text);
  }

  bold(text) {
    return this.paint('1', text);
  }

  green(text) {
    return this.paint('32', text);
  }

  red(text) {
    return this.paint('31', text);
  }

  yellow(text) {
    return this.paint('33', text);
  }

  cyan(text) {
    return this.paint('36', text);
  }

  magenta(text) {
    return this.paint('35', text);
  }

  write(text) {
    this.stopSpinner();
    this.out.write(text);
    this.atLineStart = text.endsWith('\n');
  }

  line(text = '') {
    this.write(`${text}\n`);
  }

  info(text) {
    this.line(this.dim(text));
  }

  error(text) {
    this.stopSpinner();
    if (!this.atLineStart) this.line('');
    this.err.write(`${this.red('error:')} ${text}\n`);
    this.atLineStart = true;
  }

  warn(text) {
    this.line(this.yellow(`warning: ${text}`));
  }

  banner({ provider, model, cwd, version, approval }) {
    const width = 62;
    const top = `╭${'─'.repeat(width)}╮`;
    const bottom = `╰${'─'.repeat(width)}╯`;
    const row = (content) => `│ ${content.padEnd(width - 1).slice(0, width - 1)}│`;
    this.line(this.cyan(top));
    this.line(this.cyan(row(`chan_code v${version} ${this.dim('· open-source AI coding agent')}`)));
    this.line(this.cyan(row(`provider: ${provider || '—'}   model: ${model || '—'}`)));
    this.line(this.cyan(row(`workspace: ${cwd}`)));
    this.line(this.cyan(row(`approval: ${approval || 'auto'}   /help for commands`)));
    this.line(this.cyan(bottom));
  }

  toolStart(name, argsText) {
    this.stopSpinner();
    if (!this.atLineStart) this.line('');
    const label = summarizeArgs(argsText);
    this.line(`${this.magenta('●')} ${this.bold(name)} ${this.dim(label)}`);
    this.startSpinner('running');
  }

  toolResult(ok, output, durationMs) {
    this.stopSpinner();
    const status = ok ? this.green('✓') : this.red('✗');
    const ms = durationMs != null ? this.dim(` ${durationMs}ms`) : '';
    const text = String(output || '');
    const lines = text.split('\n');
    const previewLines = this.verbose ? lines : lines.slice(0, 10);
    const preview = indent(previewLines.join('\n')).trimEnd();
    this.line(`${status}${ms}${preview ? `\n${this.dim(preview)}` : ''}`);
    if (!this.verbose && lines.length > 10) this.line(this.dim(`    … ${lines.length - 10} more lines`));
  }

  usage(usage) {
    if (!usage) return;
    const format = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));
    this.line(
      this.dim(`tokens: in ${format(usage.inputTokens)} · out ${format(usage.outputTokens)} · total ${format(usage.totalTokens)}`),
    );
  }

  startSpinner(label) {
    if (!this.color || !this.out.isTTY || this.spinnerTimer) return;
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let index = 0;
    this.spinnerTimer = setInterval(() => {
      this.out.write(`\r${this.dim(`${frames[index % frames.length]} ${label}`)}`);
      index += 1;
    }, 80);
    this.spinnerTimer.unref?.();
  }

  stopSpinner() {
    if (!this.spinnerTimer) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = null;
    if (this.out.isTTY) this.out.write('\r\u001b[K');
  }

  stop() {
    this.stopSpinner();
  }
}
