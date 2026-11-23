import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { hydrateSession, serializeSession, SessionStore } from '../src/sessions.js';

const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chan-sessions-'));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chan-ws-'));

test('session store creates, saves, lists and deletes sessions', () => {
  const store = new SessionStore({ cwd, baseDir });
  const session = store.create({ cwd, provider: 'deepseek', model: 'deepseek-chat' });
  assert.ok(session.id);
  assert.equal(session.title, 'New session');

  session.messages.push({ role: 'user', content: 'Implement login with tests' });
  store.save(session);
  assert.equal(session.title, 'Implement login with tests');

  const loaded = store.get(session.id);
  assert.equal(loaded.messages[0].content, 'Implement login with tests');
  assert.equal(loaded.provider, 'deepseek');

  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, session.id);
  assert.equal(list[0].messageCount, 1);

  assert.equal(store.delete(session.id), true);
  assert.equal(store.get(session.id), null);
  assert.equal(store.list().length, 0);
});

test('session store isolates sessions per workspace', () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'chan-ws2-'));
  const storeA = new SessionStore({ cwd, baseDir });
  const storeB = new SessionStore({ cwd: other, baseDir });
  const session = storeA.create({ cwd });
  assert.equal(storeB.list().length, 0);
  assert.equal(storeA.list().length, 1);
  storeA.delete(session.id);
});

test('session store rejects invalid ids', () => {
  const store = new SessionStore({ cwd, baseDir });
  assert.throws(() => store.file('../etc/passwd'), /invalid session id/);
});

test('image data URLs are stripped on disk and rehydrated from uploaded paths', () => {
  const store = new SessionStore({ cwd, baseDir });
  const session = store.create({ cwd });
  const uploadDir = path.join(cwd, '.chan', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const file = path.join(uploadDir, 'pic.png');
  const buffer = Buffer.from('fake-image-bytes');
  fs.writeFileSync(file, buffer);
  session.messages.push({
    role: 'user',
    content: 'see image',
    images: [{ name: 'pic.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA', path: '.chan/uploads/pic.png' }],
  });
  store.save(session);

  const raw = fs.readFileSync(store.file(session.id), 'utf8');
  assert.doesNotMatch(raw, /data:image\/png;base64,AAAA/);
  const hydrated = store.get(session.id);
  assert.match(hydrated.messages[0].images[0].dataUrl, /^data:image\/png;base64,/);
  assert.equal(Buffer.from(hydrated.messages[0].images[0].dataUrl.split(',')[1], 'base64').toString(), 'fake-image-bytes');
});

test('serializeSession and hydrateSession are inverse for text messages', () => {
  const session = {
    id: 'abc12345',
    cwd,
    messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }],
    todos: [],
  };
  const round = hydrateSession(JSON.parse(JSON.stringify(serializeSession(session))));
  assert.deepEqual(round.messages, session.messages);
});
