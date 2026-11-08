import express from 'express';
import {
  readLibrary,
  createDocument,
  readDocHtml,
  readDocMeta,
  writeDocHtml,
  writeDocMeta,
  updateLibraryDoc,
  deleteDocument,
  countWords,
} from '../services/library.js';
import { saveVersion, listVersions } from '../services/versions.js';
import { getDocRevision, subscribeDocument } from '../services/docWatch.js';

export const documentsRouter = express.Router();

documentsRouter.get('/', (_req, res) => {
  const lib = readLibrary();
  res.json(lib.documents);
});

documentsRouter.get('/:id/events', (req, res) => {
  const meta = readDocMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Document not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  subscribeDocument(req.params.id, res);
});

documentsRouter.get('/:id', (req, res) => {
  const meta = readDocMeta(req.params.id);
  const html = readDocHtml(req.params.id);
  if (!meta || html === null) {
    return res.status(404).json({ error: 'Document not found' });
  }
  res.json({ ...meta, html, revision: getDocRevision(req.params.id) });
});

documentsRouter.post('/', (req, res) => {
  const { title, folderId, html } = req.body || {};
  const doc = createDocument({ title, folderId, html });
  saveVersion(doc.id, {
    name: 'Initial version',
    html: doc.html,
    meta: doc,
    auto: true,
  });
  res.status(201).json(doc);
});

documentsRouter.put('/:id', (req, res) => {
  const id = req.params.id;
  const meta = readDocMeta(id);
  if (!meta) return res.status(404).json({ error: 'Document not found' });

  const {
    title,
    html,
    folderId,
    pageSetup,
    comments,
    reactions,
    suggestions,
    citations,
    editMode,
    createVersion,
    versionName,
  } = req.body || {};

  const now = new Date().toISOString();
  if (typeof html === 'string') {
    writeDocHtml(id, html);
    const counts = countWords(html);
    meta.wordCount = counts.words;
    meta.charCount = counts.chars;
  }
  if (title !== undefined) meta.title = title;
  if (folderId !== undefined) meta.folderId = folderId;
  if (pageSetup !== undefined) meta.pageSetup = pageSetup;
  if (comments !== undefined) meta.comments = comments;
  if (reactions !== undefined) meta.reactions = reactions;
  if (suggestions !== undefined) meta.suggestions = suggestions;
  if (citations !== undefined) meta.citations = citations;
  if (editMode !== undefined) meta.editMode = editMode;
  meta.updatedAt = now;
  writeDocMeta(id, meta);

  updateLibraryDoc(id, {
    title: meta.title,
    folderId: meta.folderId,
    updatedAt: now,
  });

  if (createVersion) {
    saveVersion(id, {
      name: versionName || `Version ${new Date().toLocaleString()}`,
      html: typeof html === 'string' ? html : readDocHtml(id),
      meta,
      auto: false,
    });
  } else if (typeof html === 'string') {
    const versions = listVersions(id);
    const lastAuto = versions.find((v) => v.auto);
    const lastAt = lastAuto ? new Date(lastAuto.createdAt).getTime() : 0;
    if (Date.now() - lastAt > 120000) {
      saveVersion(id, {
        name: `Autosave ${new Date().toLocaleString()}`,
        html,
        meta,
        auto: true,
      });
    }
  }

  res.json({ ...meta, html: readDocHtml(id), revision: getDocRevision(id) });
});

documentsRouter.patch('/:id/star', (req, res) => {
  const lib = readLibrary();
  const doc = lib.documents.find((d) => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  doc.starred = !doc.starred;
  updateLibraryDoc(doc.id, { starred: doc.starred });
  res.json(doc);
});

documentsRouter.delete('/:id', (req, res) => {
  const meta = readDocMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Document not found' });
  deleteDocument(req.params.id);
  res.json({ ok: true });
});

documentsRouter.post('/:id/duplicate', (req, res) => {
  const meta = readDocMeta(req.params.id);
  const html = readDocHtml(req.params.id);
  if (!meta || html === null) return res.status(404).json({ error: 'Document not found' });
  const copy = createDocument({
    title: `${meta.title} (Copy)`,
    folderId: meta.folderId,
    html,
  });
  const fullMeta = readDocMeta(copy.id);
  fullMeta.pageSetup = meta.pageSetup;
  writeDocMeta(copy.id, fullMeta);
  res.status(201).json({ ...fullMeta, html: copy.html });
});
