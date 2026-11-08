import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
export const DATA_DIR = path.join(ROOT, 'data');
export const DOCS_DIR = path.join(ROOT, 'documents');
export const VERSIONS_DIR = path.join(DATA_DIR, 'versions');
export const UPLOADS_DIR = path.join(DOCS_DIR, '.uploads');
export const LIBRARY_PATH = path.join(DATA_DIR, 'library.json');

export function ensureDataDirs() {
  for (const dir of [DATA_DIR, DOCS_DIR, VERSIONS_DIR, UPLOADS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(LIBRARY_PATH)) {
    const seed = {
      folders: [
        {
          id: 'root',
          name: 'My Drive',
          parentId: null,
          createdAt: new Date().toISOString(),
        },
      ],
      documents: [],
      notes: [],
      tasks: [],
    };
    fs.writeFileSync(LIBRARY_PATH, JSON.stringify(seed, null, 2));
  }
}

export function readLibrary() {
  ensureDataDirs();
  return JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));
}

export function writeLibrary(lib) {
  ensureDataDirs();
  fs.writeFileSync(LIBRARY_PATH, JSON.stringify(lib, null, 2));
}

export function docPath(id) {
  return path.join(DOCS_DIR, `${id}.html`);
}

export function metaPath(id) {
  return path.join(DOCS_DIR, `${id}.meta.json`);
}

export function readDocMeta(id) {
  const p = metaPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeDocMeta(id, meta) {
  fs.writeFileSync(metaPath(id), JSON.stringify(meta, null, 2));
}

export function readDocHtml(id) {
  const p = docPath(id);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

export function formatDocHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/\r\n/g, '\n')
    .replace(/>\s*</g, '>\n<')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function writeDocHtml(id, html) {
  fs.writeFileSync(docPath(id), formatDocHtml(html), 'utf8');
}

export function defaultPageSetup() {
  return {
    mode: 'paginated',
    paperSize: 'a4',
    orientation: 'portrait',
    margins: { top: 76, right: 76, bottom: 76, left: 76 },
    backgroundColor: '#ffffff',
    columns: 1,
    columnGap: 24,
    columnDivider: false,
    header: { enabled: true, content: '', differentFirst: false, differentOddEven: false, overrides: {} },
    footer: { enabled: true, content: '', showPageNumbers: false, overrides: {} },
    watermark: { enabled: false, type: 'text', text: '', image: '', opacity: 0.15 },
  };
}

export function blankDocumentHtml(title = 'Untitled document') {
  return `<h1>${escapeHtml(title)}</h1><p></p>`;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function createDocument({ title = 'Untitled document', folderId = 'root', html } = {}) {
  const lib = readLibrary();
  const id = nanoid(12);
  const now = new Date().toISOString();
  const content = html || blankDocumentHtml(title);
  const meta = {
    id,
    title,
    folderId,
    createdAt: now,
    updatedAt: now,
    pageSetup: defaultPageSetup(),
    comments: [],
    reactions: [],
    suggestions: [],
    citations: [],
    wordCount: 0,
    charCount: 0,
    editMode: 'editing',
  };
  writeDocHtml(id, content);
  writeDocMeta(id, meta);
  lib.documents.push({
    id,
    title,
    folderId,
    createdAt: now,
    updatedAt: now,
    starred: false,
  });
  writeLibrary(lib);
  return { ...meta, html: content };
}

export function updateLibraryDoc(id, patch) {
  const lib = readLibrary();
  const idx = lib.documents.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  lib.documents[idx] = { ...lib.documents[idx], ...patch, updatedAt: new Date().toISOString() };
  writeLibrary(lib);
  return lib.documents[idx];
}

export function deleteDocument(id) {
  const lib = readLibrary();
  lib.documents = lib.documents.filter((d) => d.id !== id);
  writeLibrary(lib);
  for (const p of [docPath(id), metaPath(id)]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const versionDir = path.join(VERSIONS_DIR, id);
  if (fs.existsSync(versionDir)) {
    fs.rmSync(versionDir, { recursive: true, force: true });
  }
}

export function countWords(html) {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = text ? text.split(/\s+/).length : 0;
  return { words, chars: text.length };
}
