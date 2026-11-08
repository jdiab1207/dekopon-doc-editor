import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { VERSIONS_DIR, ensureDataDirs } from './library.js';

function versionDir(docId) {
  return path.join(VERSIONS_DIR, docId);
}

function indexPath(docId) {
  return path.join(versionDir(docId), 'index.json');
}

function readIndex(docId) {
  ensureDataDirs();
  const p = indexPath(docId);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeIndex(docId, index) {
  fs.mkdirSync(versionDir(docId), { recursive: true });
  fs.writeFileSync(indexPath(docId), JSON.stringify(index, null, 2));
}

export function saveVersion(docId, { name, html, meta, auto = false }) {
  ensureDataDirs();
  fs.mkdirSync(versionDir(docId), { recursive: true });
  let index = readIndex(docId);

  // Keep last 30 autosaves; named versions are kept forever
  if (auto) {
    const autos = index.filter((v) => v.auto);
    if (autos.length >= 30) {
      const oldest = autos[0];
      const file = path.join(versionDir(docId), `${oldest.id}.json`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      index = index.filter((v) => v.id !== oldest.id);
    }
  }

  const id = nanoid(10);
  const entry = {
    id,
    name,
    auto,
    createdAt: new Date().toISOString(),
  };
  const payload = { ...entry, html, metaSnapshot: meta };
  fs.writeFileSync(path.join(versionDir(docId), `${id}.json`), JSON.stringify(payload, null, 2));
  index.push(entry);
  writeIndex(docId, index);
  return entry;
}

export function listVersions(docId) {
  return readIndex(docId).slice().reverse();
}

export function getVersion(docId, versionId) {
  const p = path.join(versionDir(docId), `${versionId}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function renameVersion(docId, versionId, name) {
  const index = readIndex(docId);
  const entry = index.find((v) => v.id === versionId);
  if (!entry) return null;
  entry.name = name;
  entry.auto = false;
  writeIndex(docId, index);
  const full = getVersion(docId, versionId);
  if (full) {
    full.name = name;
    full.auto = false;
    fs.writeFileSync(path.join(versionDir(docId), `${versionId}.json`), JSON.stringify(full, null, 2));
  }
  return entry;
}
