import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { truncate } from '../util/text.js';

const DANGEROUS_PATTERNS = [
  { re: /\brm\s+(-[a-zA-Z]*\s+)*(--no-preserve-root\s+)?-?[rR][fF]\s+(\/|~|\$HOME)(\s|$)/, label: 'recursive delete of root/home' },
  { re: /\b(mkfs|fdisk|diskpart|format\s+[a-z]:)/i, label: 'disk formatting' },
  { re: /\bdd\s+if=.*of=\/dev\/(sd|nvme|disk)/i, label: 'raw disk write' },
  { re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/, label: 'fork bomb' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, label: 'system power command' },
  { re: /\bgit\s+push\s+.*(--force|-f)\b/i, label: 'force push' },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/i, label: 'pipe download into shell' },
  { re: /\bsudo\s+rm\b/i, label: 'sudo rm' },
];

export function findDangerousCommand(command) {
  const text = String(command || '');
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.re.test(text)) return pattern.label;
  }
  return null;
}

function wrapForPowerShell(command) {
  return [
    "$ErrorActionPreference = 'Continue'",
    '$LASTEXITCODE = 0',
    command,
    '$__ok = $?',
    '$__code = $LASTEXITCODE',
    'if ($__code -ne 0) { exit $__code } elseif (-not $__ok) { exit 1 } else { exit 0 }',
  ].join('\n');
}

function shellFor(platform) {
  if (platform === 'win32') {
    return {
      file: process.env.CHAN_SHELL || 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'],
    };
  }
  const bash = fs.existsSync('/bin/bash') ? '/bin/bash' : 'sh';
  return { file: process.env.CHAN_SHELL || bash, args: ['-lc'] };
}

function killTree(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

export const bashTool = {
  name: 'bash',
  description:
    'Run a shell command in the workspace directory and return its output. On Windows the command runs in PowerShell; on macOS/Linux it runs in bash. Use this for builds, tests, git and package managers.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to run.' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default from config, max 600000).' },
    },
    required: ['command'],
  },
  async run(args, ctx) {
    const command = String(args.command || '').trim();
    if (!command) throw new Error('command is required');

    const configTimeout = Number(ctx.commandTimeoutMs) || 120000;
    const requestedTimeout = Number(args.timeoutMs);
    const timeoutMs = Math.min(
      Math.max(Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : configTimeout, 1000),
      600000,
    );

    const danger = findDangerousCommand(command);
    const approvalMode = ctx.approvalMode || 'auto';
    const ruleApproved = ctx.permissionApproved === true;
    const needsApproval =
      approvalMode === 'deny' ||
      (approvalMode === 'ask' && !ruleApproved) ||
      Boolean(danger && !ctx.allowDangerous && !ruleApproved);
    if (needsApproval) {
      if (typeof ctx.approve === 'function') {
        const decision = await ctx.approve({
          tool: 'bash',
          command,
          danger,
          mode: approvalMode,
          requiresConfirmation: approvalMode !== 'auto' || Boolean(danger),
          reason: danger ? 'dangerous command' : 'approval mode',
          permission: { action: 'shell', resource: command, effect: 'allow' },
        });
        if (!decision?.approved) {
          const reason = decision?.reason || 'the user did not approve this command';
          return `Command refused${danger ? ` (${danger})` : ''}: ${reason}.`;
        }
      } else if (danger && !ctx.allowDangerous) {
        throw new Error(`command blocked: ${danger}. Set agent.allowDangerous=true to permit it.`);
      } else if (approvalMode === 'deny') {
        return 'Command refused: approval mode is deny.';
      } else {
        return 'Command refused: approval is required but no approval handler is available.';
      }
    }

    const shell = shellFor(process.platform);
    const script = process.platform === 'win32' ? wrapForPowerShell(command) : command;
    const maxChars = ctx.maxOutputChars || 20000;
    const child = spawn(shell.file, [...shell.args, script], {
      cwd: ctx.cwd,
      env: { ...process.env, CHAN: '1', ...(ctx.env || {}) },
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let killedByAbort = false;

    const onAbort = () => {
      killedByAbort = true;
      killTree(child);
    };
    ctx.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdout.length < maxChars * 2) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderr.length < maxChars) stderr += chunk.toString('utf8');
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const { code, signal } = await new Promise((resolve, reject) => {
      child.once('error', (err) => {
        clearTimeout(timer);
        ctx.signal?.removeEventListener('abort', onAbort);
        reject(new Error(`failed to start shell "${shell.file}": ${err.message}`));
      });
      child.once('close', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
    });

    clearTimeout(timer);
    ctx.signal?.removeEventListener('abort', onAbort);

    const out = truncate(stdout.trimEnd(), maxChars);
    const err = truncate(stderr.trimEnd(), Math.floor(maxChars / 2));

    const parts = [];
    parts.push(`command: ${command}`);
    parts.push(`cwd: ${ctx.cwd}`);
    parts.push(
      timedOut
        ? `status: timed out after ${timeoutMs}ms`
        : killedByAbort
          ? 'status: aborted'
          : `status: ${code === 0 ? 'success' : `exit code ${code}${signal ? ` (signal ${signal})` : ''}`}`,
    );
    if (stdoutBytes > stdout.length) parts.push(`stdout: ${stdoutBytes} bytes, showing first ${stdout.length}`);
    if (stdout) parts.push(`--- stdout ---\n${out.text}`);
    if (err.text) parts.push(`--- stderr ---\n${err.text}`);
    if (!stdout && !stderr) parts.push('(no output)');
    return parts.join('\n');
  },
};

export default bashTool;
export const name = bashTool.name;
export const description = bashTool.description;
export const parameters = bashTool.parameters;
export const run = bashTool.run;
