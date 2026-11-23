import path from 'node:path';

export function normalizeSlashes(value) {
  return String(value).replace(/\\/g, '/');
}

export function isInside(root, target) {
  const resolve = (p) => {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const rel = path.relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export class PathSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PathSafetyError';
  }
}

export function resolveWorkspacePath(cwd, input, { allowOutside = false } = {}) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new PathSafetyError('path is required');
  }
  const cleaned = input.trim().replace(/^["']|["']$/g, '');
  const absolute = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(cwd, cleaned);
  if (!allowOutside && !isInside(cwd, absolute)) {
    throw new PathSafetyError(
      `path "${input}" is outside the workspace (${cwd}). Set agent.allowOutsideWorkspace=true to allow.`,
    );
  }
  return absolute;
}

export function toWorkspaceRelative(cwd, absolute) {
  const rel = path.relative(cwd, absolute);
  return rel === '' ? '.' : normalizeSlashes(rel);
}

export function sanitizeFilename(name) {
  const base = path.basename(String(name || 'file'));
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 120) || 'file';
}
