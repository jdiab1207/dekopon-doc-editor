import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { documentsRouter } from './routes/documents.js';
import { foldersRouter } from './routes/folders.js';
import { exportRouter } from './routes/export.js';
import { importRouter } from './routes/import.js';
import { aiRouter } from './routes/ai.js';
import { versionsRouter } from './routes/versions.js';
import { notesRouter } from './routes/notes.js';
import { ensureDataDirs } from './services/library.js';
import { startDocumentWatcher } from './services/docWatch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3847;
const isProd = process.env.NODE_ENV === 'production';

ensureDataDirs();
startDocumentWatcher();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'Dekopon Doc Editor', port: PORT });
});

app.use('/api/documents', documentsRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/export', exportRouter);
app.use('/api/import', importRouter);
app.use('/api/ai', aiRouter);
app.use('/api/versions', versionsRouter);
app.use('/api/notes', notesRouter);
app.use('/documents', express.static(path.join(ROOT, 'documents')));

if (isProd) {
  const dist = path.join(ROOT, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'));
    });
  }
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Dekopon Doc Editor running at http://localhost:${PORT}`);
  if (!isProd) {
    console.log('Vite client expected at http://localhost:5173');
  }
});
