import fs from 'fs';
import path from 'path';
import { DOCS_DIR, ensureDataDirs } from './library.js';

/** @type {Map<string, Set<import('express').Response>>} */
const subscribers = new Map();

let watching = false;
let debounceTimers = new Map();

function docIdFromFilename(filename) {
  if (!filename) return null;
  if (filename.endsWith('.html')) return filename.slice(0, -5);
  if (filename.endsWith('.meta.json')) return filename.slice(0, -10);
  return null;
}

export function getDocRevision(id) {
  ensureDataDirs();
  const htmlPath = path.join(DOCS_DIR, `${id}.html`);
  const metaPath = path.join(DOCS_DIR, `${id}.meta.json`);
  let mtime = 0;
  try {
    if (fs.existsSync(htmlPath)) mtime = Math.max(mtime, fs.statSync(htmlPath).mtimeMs);
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(metaPath)) mtime = Math.max(mtime, fs.statSync(metaPath).mtimeMs);
  } catch {
    /* ignore */
  }
  return Math.round(mtime);
}

function notify(docId, reason = 'changed') {
  const set = subscribers.get(docId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify({
    type: 'changed',
    id: docId,
    revision: getDocRevision(docId),
    reason,
    at: new Date().toISOString(),
  });
  for (const res of set) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      set.delete(res);
    }
  }
}

function scheduleNotify(docId) {
  clearTimeout(debounceTimers.get(docId));
  debounceTimers.set(
    docId,
    setTimeout(() => {
      debounceTimers.delete(docId);
      notify(docId);
    }, 250)
  );
}

export function startDocumentWatcher() {
  if (watching) return;
  watching = true;
  ensureDataDirs();

  try {
    fs.watch(DOCS_DIR, { persistent: true }, (_event, filename) => {
      const id = docIdFromFilename(filename);
      if (!id || id.startsWith('.')) return;
      scheduleNotify(id);
    });
    console.log(`Watching documents at ${DOCS_DIR}`);
  } catch (err) {
    console.warn('Document file watch unavailable:', err.message);
  }
}

export function subscribeDocument(docId, res) {
  if (!subscribers.has(docId)) subscribers.set(docId, new Set());
  subscribers.get(docId).add(res);

  res.write(
    `data: ${JSON.stringify({
      type: 'connected',
      id: docId,
      revision: getDocRevision(docId),
    })}\n\n`
  );

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    const set = subscribers.get(docId);
    if (set) {
      set.delete(res);
      if (set.size === 0) subscribers.delete(docId);
    }
  };

  res.on('close', cleanup);
  res.on('error', cleanup);
}
