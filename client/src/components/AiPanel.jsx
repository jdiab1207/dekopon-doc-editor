import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { formatDocHtml, formatLineRef, plainRangeToLines } from '../editor/lineRefs';

const AiPanel = forwardRef(function AiPanel(
  { documentId, documentTitle, getHtml, onDocumentUpdated },
  ref
) {
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [references, setReferences] = useState([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    fetch(`/api/ai/history/${documentId}`)
      .then((r) => r.json())
      .then(setMessages)
      .catch(() => setMessages([]));
    setReferences([]);
    setPrompt('');
  }, [documentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  useImperativeHandle(ref, () => ({
    addReference(selection) {
      if (!selection?.text?.trim()) return;
      const id = `r${Date.now().toString(36)}`;
      const html = formatDocHtml(getHtml?.() || '');
      const range = plainRangeToLines(html, selection.plainFrom, selection.plainTo);
      const label = formatLineRef(range);
      const refItem = {
        id,
        text: selection.text,
        plainFrom: selection.plainFrom,
        plainTo: selection.plainTo,
        preview: selection.text.replace(/\s+/g, ' ').trim().slice(0, 80),
        label,
      };
      setReferences((prev) => {
        const exists = prev.some(
          (r) => r.plainFrom === refItem.plainFrom && r.plainTo === refItem.plainTo
        );
        return exists ? prev : [...prev, refItem];
      });
      setPrompt((p) => {
        const token = `{{ref:${id}}}`;
        if (p.includes(token)) return p;
        const spacer = p && !p.endsWith(' ') && !p.endsWith('\n') ? ' ' : '';
        return `${p}${spacer}${token}`;
      });
      textareaRef.current?.focus();
    },
  }));

  function removeReference(id) {
    setReferences((prev) => prev.filter((r) => r.id !== id));
    setPrompt((p) =>
      p
        .replace(`{{ref:${id}}}`, '')
        .replace(/  +/g, ' ')
        .trimStart()
    );
  }

  function displayPrompt(text) {
    let out = text;
    for (const r of references) {
      out = out.split(`{{ref:${r.id}}}`).join(r.label);
    }
    return out;
  }

  async function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setStatus('Injecting into Cursor…');

    const refsSnapshot = [...references];
    const display = displayPrompt(text);

    setPrompt('');
    setReferences([]);
    setMessages((m) => [
      ...m,
      {
        id: `local-${Date.now()}`,
        role: 'user',
        content: display,
        at: new Date().toISOString(),
      },
    ]);

    const injectedPreview = `In the document [${documentTitle}] do the following:\n${display}`;
    setStatus(`Injecting into Cursor chat…`);

    try {
      const res = await fetch('/api/ai/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          prompt: text,
          references: refsSnapshot,
          html: getHtml?.() || '',
          stream: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to reach Cursor');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistant = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const payload = JSON.parse(line.slice(5).trim());
          if (payload.type === 'prompt') {
            setStatus(`Prompt: In the document [${documentTitle}] do the following: …`);
          } else if (payload.type === 'chunk') {
            assistant += payload.text;
            setStatus(assistant.slice(-400) || 'Running…');
          } else if (payload.type === 'done') {
            setMessages((m) => [
              ...m,
              payload.message,
              ...(payload.result?.ok
                ? []
                : [
                    {
                      id: `prompt-${Date.now()}`,
                      role: 'assistant',
                      content: `Injected prompt (saved to data/last-cursor-prompt.txt):\n\n${
                        payload.result?.prompt || injectedPreview
                      }\n\n${
                        payload.result?.error ? `Note: ${payload.result.error}\n\n` : ''
                      }If nothing appeared in Cursor: open this project in Cursor, check the window title contains "Dekopon Doc Editor", and that Ctrl+I opens chat (or set CURSOR_PROMPT_HOTKEY).`,
                      at: new Date().toISOString(),
                    },
                  ]),
            ]);
            if (payload.document) onDocumentUpdated?.(payload.document);
            setStatus(
              payload.result?.ok
                ? 'Cursor finished. Document reloaded.'
                : payload.result?.error ||
                    payload.result?.stderr ||
                    'Agent finished with warnings — prompt saved to data/last-cursor-prompt.txt'
            );
          } else if (payload.type === 'error') {
            setStatus(payload.error);
          }
        }
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: err.message,
          ok: false,
          at: new Date().toISOString(),
        },
      ]);
      setStatus(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="ai-pane">
      <h3 className="pane-title">Cursor AI</h3>
      <p className="ai-hint">
        Select text → <strong>Add to AI</strong> for line refs. Send pastes the prompt into the{' '}
        <strong>Cursor</strong> window for this project (clipboard + Ctrl+I → paste → Enter).
      </p>

      <div className="ai-messages">
        {messages.length === 0 && (
          <div className="ai-msg assistant">
            Ask Cursor to edit this document. Example: “clean up the formatting and fix any grammar
            errors”
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`ai-msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {status && <div className="ai-hint ai-status">{status}</div>}

      <div className="ai-compose">
        {references.length > 0 && (
          <div className="ai-refs">
            {references.map((r) => (
              <button
                key={r.id}
                type="button"
                className="ai-ref-chip"
                title={r.preview}
                onClick={() => removeReference(r.id)}
              >
                {r.label}
                <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="field"
          placeholder="Tell Cursor what to do with this document…"
          value={displayPrompt(prompt)}
          disabled={busy}
          onChange={(e) => {
            // Keep underlying tokens when user edits visible labels — map labels back if possible
            let next = e.target.value;
            for (const r of references) {
              if (next.includes(r.label) && !next.includes(`{{ref:${r.id}}}`)) {
                next = next.split(r.label).join(`{{ref:${r.id}}}`);
              }
            }
            setPrompt(next);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn btn-primary" disabled={busy || !prompt.trim()} onClick={send}>
          {busy ? 'Injecting…' : 'Send to Cursor'}
        </button>
      </div>
    </aside>
  );
});

export default AiPanel;
