import express from 'express';
import { nanoid } from 'nanoid';
import { readLibrary, writeLibrary } from '../services/library.js';

export const notesRouter = express.Router();

notesRouter.get('/', (_req, res) => {
  const lib = readLibrary();
  res.json({ notes: lib.notes || [], tasks: lib.tasks || [] });
});

notesRouter.post('/notes', (req, res) => {
  const lib = readLibrary();
  const note = {
    id: nanoid(8),
    title: req.body.title || 'Note',
    content: req.body.content || '',
    checklist: req.body.checklist || [],
    createdAt: new Date().toISOString(),
  };
  lib.notes = lib.notes || [];
  lib.notes.unshift(note);
  writeLibrary(lib);
  res.status(201).json(note);
});

notesRouter.patch('/notes/:id', (req, res) => {
  const lib = readLibrary();
  const note = (lib.notes || []).find((n) => n.id === req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  Object.assign(note, req.body);
  writeLibrary(lib);
  res.json(note);
});

notesRouter.delete('/notes/:id', (req, res) => {
  const lib = readLibrary();
  lib.notes = (lib.notes || []).filter((n) => n.id !== req.params.id);
  writeLibrary(lib);
  res.json({ ok: true });
});

notesRouter.post('/tasks', (req, res) => {
  const lib = readLibrary();
  const task = {
    id: nanoid(8),
    title: req.body.title || 'Task',
    done: false,
    documentId: req.body.documentId || null,
    commentId: req.body.commentId || null,
    createdAt: new Date().toISOString(),
  };
  lib.tasks = lib.tasks || [];
  lib.tasks.unshift(task);
  writeLibrary(lib);
  res.status(201).json(task);
});

notesRouter.patch('/tasks/:id', (req, res) => {
  const lib = readLibrary();
  const task = (lib.tasks || []).find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  Object.assign(task, req.body);
  writeLibrary(lib);
  res.json(task);
});

notesRouter.delete('/tasks/:id', (req, res) => {
  const lib = readLibrary();
  lib.tasks = (lib.tasks || []).filter((t) => t.id !== req.params.id);
  writeLibrary(lib);
  res.json({ ok: true });
});
