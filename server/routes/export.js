import express from 'express';
import { exportDocument } from '../services/export.js';

export const exportRouter = express.Router();

const FORMATS = ['pdf', 'docx', 'rtf', 'epub', 'odt', 'html', 'txt'];

exportRouter.get('/formats', (_req, res) => {
  res.json(FORMATS);
});

exportRouter.get('/:id/:format', async (req, res) => {
  const format = req.params.format.toLowerCase();
  if (!FORMATS.includes(format)) {
    return res.status(400).json({ error: `Format must be one of: ${FORMATS.join(', ')}` });
  }
  try {
    const { buffer, filename, mime } = await exportDocument(req.params.id, format);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error(`[export ${format}]`, err);
    res.status(err.status || 500).json({ error: err.message || 'Export failed' });
  }
});
