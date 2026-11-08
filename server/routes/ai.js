import express from 'express';
import { buildCursorPrompt, runCursorAgent, validateDocument } from '../services/cursor.js';
import { readDocHtml, readDocMeta, writeDocHtml } from '../services/library.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const CHAT_LOG = path.join(ROOT, 'data', 'ai-chats.json');

function readChats() {
  if (!fs.existsSync(CHAT_LOG)) return {};
  return JSON.parse(fs.readFileSync(CHAT_LOG, 'utf8'));
}

function writeChats(chats) {
  fs.writeFileSync(CHAT_LOG, JSON.stringify(chats, null, 2));
}

export const aiRouter = express.Router();

aiRouter.get('/history/:docId', (req, res) => {
  const chats = readChats();
  res.json(chats[req.params.docId] || []);
});

aiRouter.post('/prompt', async (req, res) => {
  const { documentId, prompt, stream, references, html: htmlBody } = req.body || {};
  if (!documentId || !prompt?.trim()) {
    return res.status(400).json({ error: 'documentId and prompt are required' });
  }

  const meta = validateDocument(documentId);
  if (!meta) return res.status(404).json({ error: 'Document not found' });

  if (typeof htmlBody === 'string') {
    writeDocHtml(documentId, htmlBody);
  }

  const fullPrompt = buildCursorPrompt({
    documentTitle: meta.title,
    documentId,
    userPrompt: prompt,
    references: Array.isArray(references) ? references : [],
  });

  // Persist prompt for transparency / manual paste into Cursor if CLI fails
  fs.writeFileSync(path.join(ROOT, 'data', 'last-cursor-prompt.txt'), fullPrompt, 'utf8');

  const chats = readChats();
  if (!chats[documentId]) chats[documentId] = [];
  const userMsg = {
    id: Date.now().toString(36),
    role: 'user',
    content: prompt,
    injectedPrompt: fullPrompt,
    at: new Date().toISOString(),
  };
  chats[documentId].push(userMsg);

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'prompt', prompt: fullPrompt })}\n\n`);

    try {
      const result = await runCursorAgent({
        prompt: fullPrompt,
        onChunk: (chunk) => {
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
        },
      });

      const assistantMsg = {
        id: (Date.now() + 1).toString(36),
        role: 'assistant',
        content: result.ok
          ? result.stdout || 'Cursor agent finished successfully. Reloading document…'
          : result.error || result.stderr || 'Agent finished with errors.',
        ok: result.ok,
        method: result.method,
        at: new Date().toISOString(),
      };
      chats[documentId].push(assistantMsg);
      writeChats(chats);

      const fresh = readDocMeta(documentId);
      const html = readDocHtml(documentId);
      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          result,
          message: assistantMsg,
          document: fresh ? { ...fresh, html } : null,
        })}\n\n`
      );
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    }
    return;
  }

  try {
    const result = await runCursorAgent({ prompt: fullPrompt });
    const assistantMsg = {
      id: (Date.now() + 1).toString(36),
      role: 'assistant',
      content: result.ok
        ? result.stdout || 'Cursor agent finished successfully.'
        : result.error || result.stderr || 'Agent finished with errors.',
      ok: result.ok,
      method: result.method,
      at: new Date().toISOString(),
    };
    chats[documentId].push(assistantMsg);
    writeChats(chats);

    const fresh = readDocMeta(documentId);
    const html = readDocHtml(documentId);
    res.json({
      prompt: fullPrompt,
      result,
      message: assistantMsg,
      document: fresh ? { ...fresh, html } : null,
      history: chats[documentId],
    });
  } catch (err) {
    res.status(500).json({ error: err.message, prompt: fullPrompt });
  }
});

aiRouter.get('/last-prompt', (_req, res) => {
  const p = path.join(ROOT, 'data', 'last-cursor-prompt.txt');
  if (!fs.existsSync(p)) return res.json({ prompt: null });
  res.json({ prompt: fs.readFileSync(p, 'utf8') });
});
