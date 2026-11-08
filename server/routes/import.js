import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { createDocument, UPLOADS_DIR, escapeHtml } from '../services/library.js';
import { saveVersion } from '../services/versions.js';

const upload = multer({ dest: UPLOADS_DIR });

export const importRouter = express.Router();

function plainToHtml(text, title) {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<h1>${escapeHtml(title)}</h1>${paras || '<p></p>'}`;
}

importRouter.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const folderId = req.body.folderId || 'root';
  const original = req.file.originalname || 'Imported document';
  const ext = path.extname(original).toLowerCase();
  const baseTitle = path.basename(original, ext) || 'Imported document';

  try {
    let html;
    let title = baseTitle;

    if (ext === '.docx' || ext === '.doc') {
      const result = await mammoth.convertToHtml({ path: req.file.path });
      html = result.value || '<p></p>';
      if (!html.includes('<h1')) {
        html = `<h1>${escapeHtml(title)}</h1>${html}`;
      }
    } else if (ext === '.pdf') {
      const data = await pdfParse(fs.readFileSync(req.file.path));
      html = plainToHtml(data.text || '', title);
    } else if (ext === '.html' || ext === '.htm') {
      html = fs.readFileSync(req.file.path, 'utf8');
      // strip full document wrappers if present
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bodyMatch) html = bodyMatch[1];
    } else if (ext === '.txt' || ext === '.md' || ext === '.rtf') {
      let text = fs.readFileSync(req.file.path, 'utf8');
      if (ext === '.rtf') {
        text = text
          .replace(/\\par[d]?/g, '\n')
          .replace(/\\'[0-9a-fA-F]{2}/g, '')
          .replace(/\\[a-z]+\d* ?/gi, '')
          .replace(/[{}]/g, '');
      }
      html = plainToHtml(text, title);
    } else {
      return res.status(400).json({
        error: 'Unsupported file type. Use .docx, .pdf, .html, .txt, .md, or .rtf',
      });
    }

    const doc = createDocument({ title, folderId, html });
    saveVersion(doc.id, {
      name: `Imported from ${original}`,
      html: doc.html,
      meta: doc,
      auto: false,
    });
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    try {
      fs.unlinkSync(req.file.path);
    } catch {
      /* ignore */
    }
  }
});
