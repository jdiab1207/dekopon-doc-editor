# Dekopon Docs

**Open-source local document editor built for AI agents.**

A Google Docs–style workspace that runs entirely on your machine. Your agent can read, edit, version, import, and export documents through a local HTTP API — with optional Cursor agent prompt injection so the same project stays in sync with your IDE chat.

Documents never leave your computer unless you choose to share them. This repository ships the editor and agent tooling only — no sample user docs.

## Why agents

Most doc tools are cloud UIs. Dekopon is a **local document MCP-style surface** for agents:

| Capability | What your agent gets |
|---|---|
| Library & folders | Create, move, and organize docs |
| Rich HTML documents | Read/write TipTap-backed content |
| Version history | Snapshot, browse, and restore drafts |
| Import / export | `.docx`, `.pdf`, `.html`, `.md`, `.txt`, `.rtf`, `.epub`, `.odt`, … |
| Cursor agent bridge | Inject a scoped prompt into the Cursor desktop agent for this project |

Point your agent at `http://localhost:3847/api` and treat the editor as a durable doc store with a real human UI.

## Quick start

```bash
npm install
npm run setup   # installs Puppeteer Chrome for PDF export
npm run dev
```

- App UI: http://localhost:5173  
- API: http://localhost:3847  

Production:

```bash
npm run build
npm start
```

Serves the built client from Express on port `3847`.

## Agent / API surface

Health check:

```http
GET /api/health
```

Core routes (all local):

- `/api/documents` — CRUD for documents
- `/api/folders` — library folders
- `/api/versions` — version history
- `/api/import` / `/api/export` — file conversion
- `/api/ai` — Cursor agent prompt injection + chat history
- `/api/notes` — document notes

Wire these endpoints into an MCP server, Cursor custom tool, or any agent runtime that can call HTTP. The app keeps a live UI so you can review agent edits like a normal doc.

### Cursor agent sidebar

The in-app AI panel builds a document-scoped prompt and injects it into the **Cursor desktop app** (clipboard + window focus + hotkey — not the Cursor CLI):

1. Build prompt (`In the document [Title] do the following: …`)
2. Copy to clipboard (Base64-safe on Windows)
3. Focus the Cursor window whose title matches this project
4. `Esc` → open chat (`Ctrl+I` by default) → paste → Enter

Optional env vars:

- `CURSOR_WINDOW_TITLE` — substring of the Cursor window title (default: folder name)
- `CURSOR_PROMPT_HOTKEY` — SendKeys hotkey to open chat (default: `^i` = Ctrl+I)

## Local storage layout

On first run the server creates:

```
documents/          # *.html + *.meta.json (your content — gitignored)
data/
  library.json      # folder tree
  versions/         # snapshots
  ai-chats.json     # local AI panel history
```

These paths are **gitignored** so clones stay empty of personal content.

## Import / export

- **Import:** `.docx`, `.pdf`, `.html`, `.txt`, `.md`, `.rtf`
- **Export:** `.pdf`, `.docx`, `.rtf`, `.epub`, `.odt`, `.html` (zip), `.txt`

## Privacy

- No accounts, no cloud sync, no telemetry in this project
- User documents, library state, AI chat logs, and version history stay local
- Do not commit `documents/` or `data/` if you fork and publish your own instance

## License

MIT — see [LICENSE](LICENSE).
