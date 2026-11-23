import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_IGNORES = new Set([
  '.git',
  'node_modules',
  '.chan',
  '.idea',
  '.vscode',
  '__pycache__',
  '.venv',
  'venv',
  '.pytest_cache',
  '.mypy_cache',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.turbo',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svgz', '.pdf',
  '.zip', '.gz', '.tar', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.woff', '.woff2', '.ttf', '.otf',
  '.pyc', '.class', '.jar', '.bin', '.dat', '.db', '.sqlite',
]);

export function isProbablyBinary(buffer) {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

export function isBinaryPath(filePath) {
  return BINARY_EXTENSIONS.has(path.extname(String(filePath)).toLowerCase());
}

export async function* walkFiles(root, { ignore = DEFAULT_IGNORES, maxFiles = 20000, signal } = {}) {
  let count = 0;
  const stack = [root];
  while (stack.length) {
    if (signal?.aborted) return;
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        count += 1;
        if (count > maxFiles) return;
        yield full;
      }
    }
  }
}
