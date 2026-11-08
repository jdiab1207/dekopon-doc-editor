import express from 'express';
import { nanoid } from 'nanoid';
import { readLibrary, writeLibrary } from '../services/library.js';

export const foldersRouter = express.Router();

const DEFAULT_FOLDER_COLOR = '#F4B400';
const FOLDER_COLORS = new Set([
  '#F28B82', '#FF9E80', '#F4B400', '#FDD663', '#FCFF8F',
  '#CCFF90', '#7CB342', '#0F9D58', '#A7FFEB', '#0097A7',
  '#CBF0F8', '#AECBFA', '#1A73E8', '#3F51B5', '#D7AEFB',
  '#7E57C2', '#AB47BC', '#FDCFE8', '#D81B60', '#E6C9A8',
  '#D93025', '#E8710A', '#F9AB00', '#E8EAED', '#5F6368',
]);

foldersRouter.get('/', (_req, res) => {
  const lib = readLibrary();
  res.json(lib.folders);
});

foldersRouter.post('/', (req, res) => {
  const { name = 'Untitled folder', parentId = 'root', color = DEFAULT_FOLDER_COLOR } = req.body || {};
  if (!FOLDER_COLORS.has(color)) {
    return res.status(400).json({ error: 'Invalid folder color' });
  }
  const lib = readLibrary();
  const parent = lib.folders.find((f) => f.id === parentId);
  if (!parent && parentId !== null) {
    return res.status(400).json({ error: 'Parent folder not found' });
  }
  const folder = {
    id: nanoid(10),
    name,
    parentId,
    color,
    createdAt: new Date().toISOString(),
  };
  lib.folders.push(folder);
  writeLibrary(lib);
  res.status(201).json(folder);
});

foldersRouter.patch('/:id', (req, res) => {
  const lib = readLibrary();
  const folder = lib.folders.find((f) => f.id === req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });
  if (folder.id === 'root') return res.status(400).json({ error: 'Cannot update root' });
  if (req.body.name !== undefined) folder.name = req.body.name;
  if (req.body.color !== undefined) {
    if (!FOLDER_COLORS.has(req.body.color)) {
      return res.status(400).json({ error: 'Invalid folder color' });
    }
    folder.color = req.body.color;
  }
  if (req.body.parentId !== undefined) {
    if (req.body.parentId === folder.id) {
      return res.status(400).json({ error: 'Cannot move folder into itself' });
    }
    folder.parentId = req.body.parentId;
  }
  writeLibrary(lib);
  res.json(folder);
});

foldersRouter.delete('/:id', (req, res) => {
  const lib = readLibrary();
  const id = req.params.id;
  if (id === 'root') return res.status(400).json({ error: 'Cannot delete root' });
  const folder = lib.folders.find((f) => f.id === id);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });

  const collect = (fid) => {
    const kids = lib.folders.filter((f) => f.parentId === fid).map((f) => f.id);
    return [fid, ...kids.flatMap(collect)];
  };
  const toRemove = new Set(collect(id));
  const hasDocs = lib.documents.some((d) => toRemove.has(d.folderId));
  if (hasDocs) {
    return res.status(400).json({ error: 'Move or delete documents in this folder first' });
  }
  lib.folders = lib.folders.filter((f) => !toRemove.has(f.id));
  writeLibrary(lib);
  res.json({ ok: true });
});
