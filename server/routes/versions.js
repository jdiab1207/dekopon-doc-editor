import express from 'express';
import {
  listVersions,
  getVersion,
  renameVersion,
  saveVersion,
} from '../services/versions.js';
import {
  readDocHtml,
  readDocMeta,
  writeDocHtml,
  writeDocMeta,
  updateLibraryDoc,
} from '../services/library.js';

export const versionsRouter = express.Router();

versionsRouter.get('/:docId', (req, res) => {
  res.json(listVersions(req.params.docId));
});

versionsRouter.get('/:docId/:versionId', (req, res) => {
  const version = getVersion(req.params.docId, req.params.versionId);
  if (!version) return res.status(404).json({ error: 'Version not found' });
  res.json(version);
});

versionsRouter.patch('/:docId/:versionId', (req, res) => {
  const entry = renameVersion(req.params.docId, req.params.versionId, req.body.name || 'Named version');
  if (!entry) return res.status(404).json({ error: 'Version not found' });
  res.json(entry);
});

versionsRouter.post('/:docId/:versionId/restore', (req, res) => {
  const { docId, versionId } = req.params;
  const version = getVersion(docId, versionId);
  const meta = readDocMeta(docId);
  if (!version || !meta) return res.status(404).json({ error: 'Not found' });

  // Snapshot current before restore
  saveVersion(docId, {
    name: `Before restore ${new Date().toLocaleString()}`,
    html: readDocHtml(docId),
    meta,
    auto: false,
  });

  writeDocHtml(docId, version.html);
  if (version.metaSnapshot?.pageSetup) {
    meta.pageSetup = version.metaSnapshot.pageSetup;
  }
  meta.updatedAt = new Date().toISOString();
  writeDocMeta(docId, meta);
  updateLibraryDoc(docId, { updatedAt: meta.updatedAt });

  res.json({ ...meta, html: version.html });
});

versionsRouter.post('/:docId/name', (req, res) => {
  const meta = readDocMeta(req.params.docId);
  const html = readDocHtml(req.params.docId);
  if (!meta || html === null) return res.status(404).json({ error: 'Document not found' });
  const entry = saveVersion(req.params.docId, {
    name: req.body.name || `Named version ${new Date().toLocaleString()}`,
    html,
    meta,
    auto: false,
  });
  res.status(201).json(entry);
});
