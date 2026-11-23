import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SESSIONS_DIR } from './config.js';
import { titleFromPrompt } from './util/text.js';

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
};

function workspaceKey(cwd) {
  return crypto.createHash('sha1').update(path.resolve(cwd)).digest('hex').slice(0, 12);
}

function stripImageForDisk(image) {
  if (!image) return image;
  if (image.path) return { mediaType: image.mediaType, name: image.name, path: image.path };
  return image;
}

function rehydrateImage(image, cwd) {
  if (!image) return image;
  if (image.dataUrl) return image;
  const candidates = [];
  if (image.path) {
    candidates.push(path.isAbsolute(image.path) ? image.path : path.resolve(cwd, image.path));
  }
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const stat = fs.statSync(candidate);
      if (stat.size > 8 * 1024 * 1024) continue;
      const data = fs.readFileSync(candidate).toString('base64');
      const mediaType = image.mediaType || MIME_BY_EXT[path.extname(candidate).toLowerCase()] || 'application/octet-stream';
      return { ...image, mediaType, dataUrl: `data:${mediaType};base64,${data}` };
    } catch {
      /* ignore */
    }
  }
  return image;
}

export function serializeSession(session) {
  const messages = (session.messages || []).map((message) => {
    if (!message.images?.length) return message;
    return { ...message, images: message.images.map(stripImageForDisk) };
  });
  return { ...session, messages };
}

export function hydrateSession(session) {
  if (!session) return session;
  const messages = (session.messages || []).map((message) => {
    if (!message.images?.length) return message;
    return { ...message, images: message.images.map((image) => rehydrateImage(image, session.cwd)) };
  });
  return { ...session, messages, todos: session.todos || [] };
}

export class SessionStore {
  constructor({ cwd = process.cwd(), baseDir = SESSIONS_DIR } = {}) {
    this.cwd = path.resolve(cwd);
    this.dir = path.join(baseDir, workspaceKey(this.cwd));
  }

  ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  file(id) {
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(String(id))) throw new Error('invalid session id');
    return path.join(this.dir, `${id}.json`);
  }

  create({ provider = null, model = null, approval = null, cwd = this.cwd, title = 'New session' } = {}) {
    const now = new Date().toISOString();
    const session = {
      id: crypto.randomUUID(),
      title,
      cwd,
      provider,
      model,
      approval,
      createdAt: now,
      updatedAt: now,
      messages: [],
      todos: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
    this.save(session);
    return session;
  }

  save(session) {
    this.ensureDir();
    session.updatedAt = new Date().toISOString();
    if (!session.title || session.title === 'New session') {
      const firstUser = (session.messages || []).find((m) => m.role === 'user');
      if (firstUser) session.title = titleFromPrompt(firstUser.content);
    }
    fs.writeFileSync(this.file(session.id), `${JSON.stringify(serializeSession(session), null, 2)}\n`, 'utf8');
    return session;
  }

  get(id) {
    if (!id) return null;
    try {
      const raw = fs.readFileSync(this.file(id), 'utf8');
      return hydrateSession(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  list() {
    try {
      this.ensureDir();
      const entries = fs.readdirSync(this.dir).filter((name) => name.endsWith('.json'));
      const sessions = [];
      for (const entry of entries) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(this.dir, entry), 'utf8'));
          sessions.push({
            id: data.id,
            title: data.title,
            cwd: data.cwd,
            provider: data.provider,
            model: data.model,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            messageCount: (data.messages || []).length,
            usage: data.usage,
          });
        } catch {
          /* skip corrupt */
        }
      }
      sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return sessions;
    } catch {
      return [];
    }
  }

  delete(id) {
    try {
      fs.unlinkSync(this.file(id));
      return true;
    } catch {
      return false;
    }
  }
}
