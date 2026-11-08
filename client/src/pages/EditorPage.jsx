import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import FontFamily from '@tiptap/extension-font-family';
import LinkExt from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import TableRow from '@tiptap/extension-table-row';
import { CustomTable, CustomTableCell, CustomTableHeader } from '../editor/tableExtensions';
import { ResizableImage } from '../editor/resizableImage';
import TableBubbleMenu from '../components/TableBubbleMenu';
import ImageBubbleMenu from '../components/ImageBubbleMenu';
import PageChrome from '../components/PageChrome';
import {
  FontSize,
  LineHeight,
  ParagraphStyle,
  PageBreak,
  HorizontalRuleStyled,
  CommentMark,
  SuggestionMark,
  ReactionMark,
  Footnote,
  ChartBlock,
  TextStyle,
} from '../editor/extensions';
import { PageGaps, PAGE_GAP_PX, pageLayoutRef, refreshPageGaps } from '../editor/pageGaps';
import { replaceEditorHtml } from '../editor/replaceEditorHtml';
import { api } from '../api';
import Toolbar from '../components/Toolbar';
import AiPanel from '../components/AiPanel';
import OutlinePanel from '../components/OutlinePanel';
import { captureEditorPdf, safePdfFilename, exportErrMessage } from '../export/captureEditorPdf';
import '../styles/editor.css';

const PAPER = {
  a4: {
    portrait: { width: 794, height: 1123 }, // 210 × 297 mm at 96dpi
    landscape: { width: 1123, height: 794 },
  },
  letter: {
    portrait: { width: 816, height: 1056 }, // 8.5 × 11 in at 96dpi
    landscape: { width: 1056, height: 816 },
  },
};

function getPaperDims(pageSetup) {
  const sizeKey = pageSetup?.paperSize === 'letter' ? 'letter' : 'a4';
  const orient = pageSetup?.orientation === 'landscape' ? 'landscape' : 'portrait';
  return PAPER[sizeKey][orient];
}

const SPECIALS = '©®™§¶†‡•…–—‘’“”«»¿¡°±×÷≠≤≥∞≈µΩαβπ€£¥¢←→↑↓★☆✓✗♪♠♣♥♦';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function EditorPage() {
  const { id } = useParams();
  const [doc, setDoc] = useState(null);
  const [title, setTitle] = useState('');
  const [pageSetup, setPageSetup] = useState(null);
  const [editMode, setEditMode] = useState('editing');
  const [saveState, setSaveState] = useState('Loading…');
  const [error, setError] = useState('');
  const [showOutline, setShowOutline] = useState(true);
  const [showAi, setShowAi] = useState(true);
  const [drawer, setDrawer] = useState(null);
  const [versions, setVersions] = useState([]);
  const [notesData, setNotesData] = useState({ notes: [], tasks: [] });
  const [paintFormat, setPaintFormat] = useState(null);
  const [modal, setModal] = useState(null);
  const [exportBusy, setExportBusy] = useState('');
  const [exportError, setExportError] = useState('');
  const exportProgressRef = useRef(null);
  const [wordCount, setWordCount] = useState({ words: 0, chars: 0 });
  const [textSelection, setTextSelection] = useState(null);
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const saveTimer = useRef(null);
  const pageStackRef = useRef(null);
  const idleSaveTimer = useRef(null);
  const fileImageRef = useRef(null);
  const readyRef = useRef(false);
  const aiPanelRef = useRef(null);
  const paintFormatRef = useRef(null);
  const dirtyRef = useRef(false);
  const lastSavedWordsRef = useRef(0);
  const pendingSaveRef = useRef(null);
  const saveInFlightRef = useRef(false);
  const docRef = useRef(null);
  const metaRef = useRef({});
  const flushSaveRef = useRef(async () => {});
  const lastRevisionRef = useRef(0);
  const skipWatchUntilRef = useRef(0);
  const pendingRemoteRef = useRef(false);
  const applyRemoteRef = useRef(async () => {});
  /** HTML waiting to be applied after EditorContent has mounted (avoids TipTap flushSync warning). */
  const pendingHtmlRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ horizontalRule: false }),
      Underline,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      LineHeight,
      ParagraphStyle,
      Highlight.configure({ multicolor: true }),
      Superscript,
      Subscript,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      ResizableImage,
      LinkExt.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CustomTable,
      TableRow,
      CustomTableHeader,
      CustomTableCell,
      PageBreak,
      HorizontalRuleStyled,
      CommentMark,
      SuggestionMark,
      ReactionMark,
      Footnote,
      ChartBlock,
      PageGaps,
    ],
    content: '',
    editable: true,
    onUpdate: ({ editor: ed }) => {
      if (!readyRef.current) return;
      const text = ed.getText();
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      setWordCount({ words, chars: text.length });
      dirtyRef.current = true;
      pendingSaveRef.current = { html: ed.getHTML() };

      // Autosave after every ~2 new words
      if (words >= lastSavedWordsRef.current + 2) {
        flushSaveRef.current({ html: ed.getHTML() });
        return;
      }

      // Otherwise idle-autosave shortly after typing pauses
      clearTimeout(idleSaveTimer.current);
      idleSaveTimer.current = setTimeout(() => {
        if (dirtyRef.current) {
          flushSaveRef.current({ html: ed.getHTML() });
        }
      }, 4000);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      if (from === to) {
        setTextSelection(null);
      } else {
        const text = ed.state.doc.textBetween(from, to, '\n', '\n');
        if (text.trim()) {
          const plainFrom = ed.state.doc.textBetween(0, from, '\n', '\n').length;
          const plainTo = ed.state.doc.textBetween(0, to, '\n', '\n').length;
          let coords = null;
          try {
            const start = ed.view.coordsAtPos(from);
            const end = ed.view.coordsAtPos(to);
            coords = {
              top: Math.min(start.top, end.top),
              right: Math.max(start.right, end.right),
              left: Math.min(start.left, end.left),
              bottom: Math.max(start.bottom, end.bottom),
            };
          } catch {
            coords = null;
          }
          setTextSelection({ text, from, to, plainFrom, plainTo, coords });
        } else {
          setTextSelection(null);
        }
      }

      const paint = paintFormatRef.current;
      if (!paint || from === to) return;
      ed.chain()
        .focus()
        .setMark('textStyle', paint.textStyle || {})
        .run();
      if (paint.bold) ed.chain().focus().setBold().run();
      if (paint.italic) ed.chain().focus().setItalic().run();
      if (paint.underline) ed.chain().focus().setUnderline().run();
      if (paint.strike) ed.chain().focus().setStrike().run();
      if (paint.color) ed.chain().focus().setColor(paint.color).run();
      if (paint.highlight) ed.chain().focus().setHighlight({ color: paint.highlight }).run();
      paintFormatRef.current = null;
      setPaintFormat(null);
    },
  });

  useEffect(() => {
    paintFormatRef.current = paintFormat;
  }, [paintFormat]);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    metaRef.current = { title, pageSetup, editMode };
  }, [title, pageSetup, editMode]);

  const flushSave = useCallback(
    async (patch = {}) => {
      clearTimeout(saveTimer.current);
      clearTimeout(idleSaveTimer.current);
      if (saveInFlightRef.current) {
        pendingSaveRef.current = { ...(pendingSaveRef.current || {}), ...patch };
        return;
      }
      saveInFlightRef.current = true;
      setSaveState('Saving…');
      try {
        const currentDoc = docRef.current;
        const meta = metaRef.current;
        const body = {
          title: meta.title,
          pageSetup: meta.pageSetup,
          editMode: meta.editMode,
          comments: currentDoc?.comments || [],
          reactions: currentDoc?.reactions || [],
          suggestions: currentDoc?.suggestions || [],
          citations: currentDoc?.citations || [],
          ...(pendingSaveRef.current || {}),
          ...patch,
        };
        pendingSaveRef.current = null;
        const updated = await api.updateDocument(id, body);
        setDoc(updated);
        dirtyRef.current = false;
        if (updated.revision) lastRevisionRef.current = updated.revision;
        skipWatchUntilRef.current = Date.now() + 800;
        const text = (body.html || updated.html || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        lastSavedWordsRef.current = text ? text.split(/\s+/).length : 0;
        setSaveState(`Saved ${new Date().toLocaleTimeString()}`);
        if (pendingRemoteRef.current) {
          pendingRemoteRef.current = false;
          setTimeout(() => applyRemoteRef.current(), 150);
        }
      } catch (e) {
        setSaveState('Save failed');
        setError(e.message);
      } finally {
        saveInFlightRef.current = false;
        if (pendingSaveRef.current) {
          const leftover = pendingSaveRef.current;
          pendingSaveRef.current = null;
          flushSave(leftover);
        }
      }
    },
    [id]
  );

  flushSaveRef.current = flushSave;

  const scheduleSave = useCallback(
    (patch) => {
      dirtyRef.current = true;
      pendingSaveRef.current = { ...(pendingSaveRef.current || {}), ...patch };
      setSaveState('Saving…');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        flushSave(patch);
      }, 600);
      clearTimeout(idleSaveTimer.current);
      idleSaveTimer.current = setTimeout(() => {
        if (dirtyRef.current) flushSave();
      }, 10000);
    },
    [flushSave]
  );

  // Periodic safety net: if dirty for a while, save
  useEffect(() => {
    const tick = setInterval(() => {
      if (dirtyRef.current) flushSave();
    }, 15000);
    return () => clearInterval(tick);
  }, [flushSave]);

  useEffect(() => {
    let cancelled = false;
    readyRef.current = false;
    pendingHtmlRef.current = null;
    // Drop previous doc from the editor while the next one loads (EditorContent already mounted).
    if (editor && !editor.isDestroyed) {
      replaceEditorHtml(editor, '<p></p>', { clearHistory: true });
    }
    (async () => {
      try {
        const data = await api.getDocument(id);
        if (cancelled) return;
        // Stash HTML and apply only after EditorContent mounts (see effect below).
        // Setting React node-view content during the same turn as the first mount
        // makes TipTap call flushSync inside componentDidMount → React warning.
        pendingHtmlRef.current = data.html || '<p></p>';
        setDoc(data);
        setTitle(data.title);
        setPageSetup(data.pageSetup);
        setEditMode(data.editMode || 'editing');
        setWordCount({ words: data.wordCount || 0, chars: data.charCount || 0 });
        lastSavedWordsRef.current = data.wordCount || 0;
        lastRevisionRef.current = data.revision || 0;
        dirtyRef.current = false;
        setSaveState('Ready');
      } catch (e) {
        setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(saveTimer.current);
      clearTimeout(idleSaveTimer.current);
    };
  }, [id, editor]);

  // Apply document HTML after EditorContent is in the tree (post-commit), not during mount.
  useEffect(() => {
    if (!doc || !editor) return undefined;
    const html = pendingHtmlRef.current;
    if (html == null) return undefined;
    pendingHtmlRef.current = null;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled || editor.isDestroyed) return;
      readyRef.current = false;
      replaceEditorHtml(editor, html, { clearHistory: true });
      readyRef.current = true;
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [doc, editor]);

  const normalizeHtml = useCallback((html) => {
    return String(html || '')
      .replace(/>\s+</g, '><')
      .replace(/\s+/g, ' ')
      .trim();
  }, []);

  const applyRemoteDocument = useCallback(async () => {
    if (!editor || !id) return;
    if (Date.now() < skipWatchUntilRef.current) return;
    if (dirtyRef.current || saveInFlightRef.current) {
      pendingRemoteRef.current = true;
      return;
    }
    try {
      const fresh = await api.getDocument(id);
      if (fresh.revision && fresh.revision === lastRevisionRef.current) return;

      const sameHtml =
        normalizeHtml(fresh.html) === normalizeHtml(editor.getHTML());
      const sameTitle = fresh.title === metaRef.current.title;
      lastRevisionRef.current = fresh.revision || Date.now();

      if (sameHtml && sameTitle) {
        setDoc((prev) => ({ ...prev, ...fresh, html: prev?.html ?? fresh.html }));
        return;
      }

      readyRef.current = false;
      replaceEditorHtml(editor, fresh.html || '<p></p>', { clearHistory: true });
      readyRef.current = true;
      setDoc(fresh);
      setTitle(fresh.title);
      if (fresh.pageSetup) setPageSetup(fresh.pageSetup);
      setWordCount({ words: fresh.wordCount || 0, chars: fresh.charCount || 0 });
      lastSavedWordsRef.current = fresh.wordCount || 0;
      dirtyRef.current = false;
      setSaveState('Updated from disk');
    } catch {
      /* ignore transient errors */
    }
  }, [editor, id, normalizeHtml]);

  applyRemoteRef.current = applyRemoteDocument;

  // Live-reload when Cursor (or anything) changes the document files on disk
  useEffect(() => {
    if (!id || !editor) return undefined;

    const onRemoteChange = () => {
      applyRemoteRef.current();
    };

    let es;
    try {
      es = new EventSource(api.watchDocumentUrl(id));
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'connected') {
            if (data.revision) lastRevisionRef.current = data.revision;
            return;
          }
          if (data.type === 'changed') onRemoteChange();
        } catch {
          /* ignore */
        }
      };
    } catch {
      es = null;
    }

    const poll = setInterval(onRemoteChange, 2000);
    return () => {
      es?.close();
      clearInterval(poll);
    };
  }, [id, editor]);

  useEffect(() => {
    if (!editor) return undefined;
    const onScrollOrResize = () => {
      const { from, to } = editor.state.selection;
      if (from === to) return;
      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        setTextSelection((prev) =>
          prev
            ? {
                ...prev,
                coords: {
                  top: Math.min(start.top, end.top),
                  right: Math.max(start.right, end.right),
                  left: Math.min(start.left, end.left),
                  bottom: Math.max(start.bottom, end.bottom),
                },
              }
            : prev
        );
      } catch {
        /* ignore */
      }
    };
    const wrap = editor.view.dom.closest('.doc-canvas-wrap');
    wrap?.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      wrap?.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [editor]);

  // Keep pagination plugin in sync with paper size / margins
  useEffect(() => {
    if (!pageSetup) return;
    const dims = getPaperDims(pageSetup);
    const margins = pageSetup.margins || { top: 76, right: 76, bottom: 76, left: 76 };
    pageLayoutRef.current = {
      enabled: pageSetup.mode !== 'pageless',
      pageHeight: dims.height,
      gap: PAGE_GAP_PX,
      marginTop: margins.top,
      marginBottom: margins.bottom,
      marginLeft: margins.left,
      marginRight: margins.right,
    };
    if (editor) {
      const t = setTimeout(() => refreshPageGaps(editor), 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [
    editor,
    pageSetup?.mode,
    pageSetup?.paperSize,
    pageSetup?.orientation,
    pageSetup?.margins?.left,
    pageSetup?.margins?.right,
    pageSetup?.margins?.top,
    pageSetup?.margins?.bottom,
  ]);

  // Count stacked pages from content height (gaps included in content)
  useEffect(() => {
    if (!editor) return undefined;
    if (pageSetup?.mode === 'pageless') {
      setPageCount(1);
      setCurrentPage(1);
      return undefined;
    }

    const dims = getPaperDims(pageSetup);

    const measure = () => {
      const prose = editor.view?.dom;
      if (!prose) return;
      const gaps = prose.querySelectorAll('.editor-page-gap').length;
      const count = Math.max(1, gaps + 1);
      setPageCount((prev) => (prev === count ? prev : count));

      const wrap = pageStackRef.current?.closest('.doc-canvas-wrap');
      if (wrap && pageStackRef.current) {
        const unit = dims.height + PAGE_GAP_PX;
        const stackTop = pageStackRef.current.getBoundingClientRect().top;
        const viewMid = wrap.getBoundingClientRect().top + 120;
        const y = viewMid - stackTop;
        const page = Math.min(count, Math.max(1, Math.floor(y / unit) + 1));
        setCurrentPage((prev) => (prev === page ? prev : page));
      }
    };

    measure();
    const timer = setInterval(measure, 400);
    editor.on('update', measure);
    const wrap = document.querySelector('.doc-canvas-wrap');
    wrap?.addEventListener('scroll', measure, { passive: true });
    return () => {
      clearInterval(timer);
      editor.off('update', measure);
      wrap?.removeEventListener('scroll', measure);
    };
  }, [editor, pageSetup?.mode, pageSetup?.paperSize, pageSetup?.orientation]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editMode !== 'viewing');
  }, [editor, editMode]);

  const headings = useMemo(() => {
    if (!editor) return [];
    const items = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        items.push({
          id: `h-${pos}`,
          level: node.attrs.level,
          text: node.textContent || 'Untitled',
          pos,
        });
      }
    });
    return items;
  }, [editor, doc, saveState]);

  function jumpToHeading(hid) {
    const h = headings.find((x) => x.id === hid);
    if (!h || !editor) return;
    editor.chain().focus().setTextSelection(h.pos + 1).run();
    const el = editor.view.dom.querySelectorAll('h1,h2,h3,h4,h5,h6');
    // best-effort scroll
    const idx = headings.findIndex((x) => x.id === hid);
    el[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function onTitleBlur() {
    scheduleSave({ title });
  }

  function handlePageSetup(next) {
    setPageSetup(next);
    scheduleSave({ pageSetup: next });
  }

  function capturePaintFormat() {
    if (!editor) return;
    if (paintFormat) {
      setPaintFormat(null);
      paintFormatRef.current = null;
      return;
    }
    const next = {
      textStyle: editor.getAttributes('textStyle'),
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      color: editor.getAttributes('textStyle').color,
      highlight: editor.getAttributes('highlight').color,
    };
    paintFormatRef.current = next;
    setPaintFormat(next);
  }

  function insertImageFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      if (!src.startsWith('data:image/')) {
        window.alert('Could not read that image file.');
        return;
      }
      editor
        .chain()
        .focus()
        .setImage({
          src,
          wrap: 'wrap',
          wrapAlign: 'left',
          marginIn: 0.125,
          positionMode: 'move-with-text',
          offsetX: 0,
          offsetY: 0,
        })
        .run();
    };
    reader.onerror = () => {
      window.alert('Failed to import image.');
    };
    reader.readAsDataURL(file);
  }

  async function openVersions() {
    const list = await api.listVersions(id);
    setVersions(list);
    setDrawer('versions');
  }

  async function openNotes() {
    const data = await api.getNotes();
    setNotesData(data);
    setDrawer('notes');
  }

  function addComment() {
    if (!editor || editor.state.selection.empty) {
      window.alert('Select text to comment on.');
      return;
    }
    const text = window.prompt('Comment');
    if (!text) return;
    const commentId = uid();
    editor.chain().focus().setMark('comment', { commentId }).run();
    const comments = [
      ...(doc.comments || []),
      {
        id: commentId,
        text,
        resolved: false,
        assigned: false,
        replies: [],
        createdAt: new Date().toISOString(),
        quote: editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to),
      },
    ];
    setDoc({ ...doc, comments });
    scheduleSave({ comments, html: editor.getHTML() });
    setDrawer('comments');
  }

  function addReaction() {
    if (!editor || editor.state.selection.empty) {
      window.alert('Select text to react to.');
      return;
    }
    const emoji = window.prompt('Emoji reaction', '👍');
    if (!emoji) return;
    editor.chain().focus().setMark('reaction', { emoji }).run();
    const reactions = [
      ...(doc.reactions || []),
      {
        id: uid(),
        emoji,
        createdAt: new Date().toISOString(),
        quote: editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to),
      },
    ];
    setDoc({ ...doc, reactions });
    scheduleSave({ reactions, html: editor.getHTML() });
  }

  function markSuggestion(type = 'insert') {
    if (!editor || editor.state.selection.empty) {
      window.alert('Select text to mark as a suggestion.');
      return;
    }
    const suggestionId = uid();
    const quote = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);
    editor.chain().focus().setMark('suggestion', { suggestionId, type }).run();
    const suggestions = [
      ...(doc.suggestions || []),
      {
        id: suggestionId,
        type,
        quote,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    ];
    setDoc({ ...doc, suggestions });
    scheduleSave({ suggestions, html: editor.getHTML() });
    setDrawer('suggestions');
  }

  async function onDocumentUpdated(fresh) {
    if (!fresh) {
      await applyRemoteDocument();
      return;
    }
    if (fresh.revision) lastRevisionRef.current = fresh.revision;
    setDoc(fresh);
    setTitle(fresh.title);
    setPageSetup(fresh.pageSetup);
    if (editor && fresh.html != null) {
      readyRef.current = false;
      replaceEditorHtml(editor, fresh.html, { clearHistory: true });
      readyRef.current = true;
    }
    dirtyRef.current = false;
    setSaveState('Updated by Cursor');
    // Keep watching — Cursor may still be writing after inject returns
    skipWatchUntilRef.current = Date.now() + 400;
    setTimeout(() => applyRemoteRef.current(), 1200);
    setTimeout(() => applyRemoteRef.current(), 3000);
    setTimeout(() => applyRemoteRef.current(), 6000);
  }

  if (error && !doc) {
    return (
      <div style={{ padding: 40 }}>
        <p>{error}</p>
        <Link to="/">Back to Drive</Link>
      </div>
    );
  }

  if (!doc || !pageSetup || !editor) {
    return <div style={{ padding: 40 }}>Loading document…</div>;
  }

  const paper = getPaperDims(pageSetup);
  const pageWidth = paper.width;
  const pageHeight = paper.height;
  const margins = pageSetup.margins || { top: 76, right: 76, bottom: 76, left: 76 };
  const colClass =
    pageSetup.columns > 1
      ? `columns-${pageSetup.columns}${pageSetup.columnDivider ? ' columns-divider' : ''}`
      : '';
  const isPageless = pageSetup.mode === 'pageless';
  const stackHeight = isPageless
    ? undefined
    : pageCount * pageHeight + Math.max(0, pageCount - 1) * PAGE_GAP_PX;

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <div className="left">
          <Link className="btn btn-ghost" to="/">
            ← Drive
          </Link>
          <span className="save-state">{saveState}</span>
        </div>
        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={onTitleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <div className="right">
          {editMode === 'suggesting' && (
            <>
              <button className="btn" type="button" onClick={() => markSuggestion('insert')}>
                Suggest insert
              </button>
              <button className="btn" type="button" onClick={() => markSuggestion('delete')}>
                Suggest delete
              </button>
            </>
          )}
          <button className="btn" type="button" onClick={addReaction}>
            React
          </button>
          <button className="btn" type="button" onClick={addComment}>
            Comment
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={async () => {
              setSaveState('Saving…');
              const updated = await api.updateDocument(id, {
                title,
                html: editor.getHTML(),
                pageSetup,
                editMode,
                comments: doc.comments,
                reactions: doc.reactions,
                suggestions: doc.suggestions,
                citations: doc.citations,
                createVersion: true,
                versionName: `Manual save ${new Date().toLocaleString()}`,
              });
              setDoc(updated);
              setSaveState('Saved');
            }}
          >
            Save
          </button>
        </div>
      </header>

      <Toolbar
        editor={editor}
        pageSetup={pageSetup}
        onPageSetup={handlePageSetup}
        editMode={editMode}
        onEditMode={(m) => {
          setEditMode(m);
          scheduleSave({ editMode: m });
        }}
        paintFormat={!!paintFormat}
        onPaintFormat={capturePaintFormat}
        onInsertImage={() => fileImageRef.current?.click()}
        onInsertSpecial={() => setModal('special')}
        onOpenPageSetup={() => setModal('page')}
        onOpenExport={() => {
          setExportError('');
          setExportBusy('');
          setModal('export');
        }}
        onOpenVersions={openVersions}
        onOpenComments={() => setDrawer('comments')}
        onOpenNotes={openNotes}
        onToggleOutline={() => setShowOutline((v) => !v)}
        onToggleAi={() => setShowAi((v) => !v)}
      />

      <div
        className={`editor-body ${showOutline ? '' : 'no-outline'} ${showAi ? '' : 'no-ai'}`}
      >
        {showOutline && <OutlinePanel headings={headings} onJump={jumpToHeading} />}

        {editor && <TableBubbleMenu editor={editor} />}
        {editor && <ImageBubbleMenu editor={editor} />}

        <div className={`doc-canvas-wrap ${isPageless ? 'pageless' : ''}`}>
          {textSelection?.coords && (
            <button
              type="button"
              className="selection-ai-bubble"
              style={{
                top: Math.max(8, textSelection.coords.top - 34),
                left: textSelection.coords.right,
                transform: 'translateX(-100%)',
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                aiPanelRef.current?.addReference(textSelection);
                if (!showAi) setShowAi(true);
              }}
            >
              Add to AI
            </button>
          )}

          {isPageless ? (
            <div
              className={`doc-page pageless ${colClass}`}
              style={{
                background: pageSetup.backgroundColor || '#fff',
                '--col-gap': `${pageSetup.columnGap || 24}px`,
              }}
            >
              <div style={{ padding: 8 }}>
                <EditorContent editor={editor} />
              </div>
            </div>
          ) : (
            <div
              ref={pageStackRef}
              className={`doc-page-stack ${colClass}`}
              style={{
                width: pageWidth,
                height: stackHeight,
                '--col-gap': `${pageSetup.columnGap || 24}px`,
                '--page-gap': `${PAGE_GAP_PX}px`,
                '--page-height': `${pageHeight}px`,
              }}
            >
              {Array.from({ length: pageCount }, (_, i) => (
                <div
                  key={i}
                  className="doc-page-paper"
                  style={{
                    width: pageWidth,
                    height: pageHeight,
                    top: i * (pageHeight + PAGE_GAP_PX),
                    background: pageSetup.backgroundColor || '#fff',
                  }}
                >
                  {pageSetup.watermark?.enabled && i === 0 && (
                    <div
                      className="doc-watermark"
                      style={{ opacity: pageSetup.watermark.opacity ?? 0.15 }}
                    >
                      {pageSetup.watermark.text || 'DRAFT'}
                    </div>
                  )}
                </div>
              ))}

              {Array.from({ length: pageCount }, (_, i) => (
                <PageChrome
                  key={`chrome-${i}`}
                  pageIndex={i}
                  pageCount={pageCount}
                  top={i * (pageHeight + PAGE_GAP_PX)}
                  width={pageWidth}
                  height={pageHeight}
                  margins={margins}
                  pageSetup={pageSetup}
                  documentTitle={title}
                  onPageSetup={handlePageSetup}
                />
              ))}

              {/* Behind-text images with "repeat on all pages" portal clones here (outside ProseMirror). */}
              <div className="doc-page-image-clones" aria-hidden="true" />

              <div
                className="doc-flow-content"
                style={{
                  width: pageWidth,
                  paddingTop: margins.top,
                  paddingRight: margins.right,
                  paddingBottom: margins.bottom,
                  paddingLeft: margins.left,
                }}
              >
                <EditorContent editor={editor} />
              </div>
            </div>
          )}
        </div>
        {drawer === 'suggestions' && (
          <aside className="side-drawer">
            <h3 className="pane-title">Suggestions</h3>
            {(doc.suggestions || []).length === 0 && <p className="ai-hint">No pending suggestions.</p>}
            {(doc.suggestions || []).map((s) => (
              <div key={s.id} className="comment-card">
                <div>
                  <strong>{s.type}</strong> · {s.status}
                </div>
                <div className="meta">“{s.quote}”</div>
                {s.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        const suggestions = doc.suggestions.map((x) =>
                          x.id === s.id ? { ...x, status: 'accepted' } : x
                        );
                        // Accept: remove suggestion mark styling by rewriting HTML roughly
                        const html = editor
                          .getHTML()
                          .replace(
                            new RegExp(
                              `<span[^>]*data-suggestion="${s.id}"[^>]*data-type="delete"[^>]*>([\\s\\S]*?)</span>`,
                              'g'
                            ),
                            ''
                          )
                          .replace(
                            new RegExp(
                              `<span([^>]*)data-suggestion="${s.id}"([^>]*)>`,
                              'g'
                            ),
                            '<span>'
                          );
                        readyRef.current = false;
                        editor.commands.setContent(html, false);
                        readyRef.current = true;
                        setDoc({ ...doc, suggestions });
                        scheduleSave({ suggestions, html: editor.getHTML() });
                      }}
                    >
                      Accept
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        const suggestions = doc.suggestions.map((x) =>
                          x.id === s.id ? { ...x, status: 'rejected' } : x
                        );
                        const html = editor
                          .getHTML()
                          .replace(
                            new RegExp(
                              `<span[^>]*data-suggestion="${s.id}"[^>]*data-type="insert"[^>]*>([\\s\\S]*?)</span>`,
                              'g'
                            ),
                            ''
                          )
                          .replace(
                            new RegExp(
                              `<span([^>]*)data-suggestion="${s.id}"([^>]*)>`,
                              'g'
                            ),
                            '<span>'
                          );
                        readyRef.current = false;
                        editor.commands.setContent(html, false);
                        readyRef.current = true;
                        setDoc({ ...doc, suggestions });
                        scheduleSave({ suggestions, html: editor.getHTML() });
                      }}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
            <button className="btn" type="button" onClick={() => setDrawer(null)}>
              Close
            </button>
          </aside>
        )}

        {drawer === 'comments' && (
          <aside className="side-drawer">
            <h3 className="pane-title">Comments</h3>
            {(doc.comments || []).length === 0 && <p className="ai-hint">No comments yet.</p>}
            {(doc.comments || []).map((c) => (
              <div key={c.id} className="comment-card">
                <div>{c.text}</div>
                <div className="meta">“{c.quote}”</div>
                <div className="meta">{new Date(c.createdAt).toLocaleString()}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      const reply = window.prompt('Reply');
                      if (!reply) return;
                      const comments = doc.comments.map((x) =>
                        x.id === c.id
                          ? { ...x, replies: [...(x.replies || []), { id: uid(), text: reply, at: new Date().toISOString() }] }
                          : x
                      );
                      setDoc({ ...doc, comments });
                      scheduleSave({ comments });
                    }}
                  >
                    Reply
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={async () => {
                      await api.createTask({ title: c.text, documentId: id, commentId: c.id });
                      const comments = doc.comments.map((x) =>
                        x.id === c.id ? { ...x, assigned: true } : x
                      );
                      setDoc({ ...doc, comments });
                      scheduleSave({ comments });
                    }}
                  >
                    To task
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      const comments = doc.comments.map((x) =>
                        x.id === c.id ? { ...x, resolved: !x.resolved } : x
                      );
                      setDoc({ ...doc, comments });
                      scheduleSave({ comments });
                    }}
                  >
                    {c.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                </div>
                {(c.replies || []).map((r) => (
                  <div key={r.id} className="meta" style={{ marginTop: 6 }}>
                    ↳ {r.text}
                  </div>
                ))}
              </div>
            ))}
            <button className="btn" type="button" onClick={() => setDrawer(null)}>
              Close
            </button>
          </aside>
        )}

        {drawer === 'versions' && (
          <aside className="side-drawer">
            <h3 className="pane-title">Version history</h3>
            <button
              className="btn btn-primary"
              type="button"
              style={{ marginBottom: 10 }}
              onClick={async () => {
                const name = window.prompt('Name this version', `Version ${new Date().toLocaleString()}`);
                if (!name) return;
                await api.updateDocument(id, {
                  html: editor.getHTML(),
                  title,
                  pageSetup,
                  createVersion: true,
                  versionName: name,
                });
                setVersions(await api.listVersions(id));
              }}
            >
              Name current version
            </button>
            {versions.map((v) => (
              <div key={v.id} className="version-card">
                <strong>{v.name}</strong>
                <div className="meta">
                  {new Date(v.createdAt).toLocaleString()} {v.auto ? '· autosave' : ''}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={async () => {
                      const restored = await api.restoreVersion(id, v.id);
                      await onDocumentUpdated(restored);
                    }}
                  >
                    Restore
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={async () => {
                      const name = window.prompt('Rename version', v.name);
                      if (!name) return;
                      await api.renameVersion(id, v.id, name);
                      setVersions(await api.listVersions(id));
                    }}
                  >
                    Rename
                  </button>
                </div>
              </div>
            ))}
            <button className="btn" type="button" onClick={() => setDrawer(null)}>
              Close
            </button>
          </aside>
        )}

        {drawer === 'notes' && (
          <aside className="side-drawer">
            <h3 className="pane-title">Notes & tasks</h3>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                const content = window.prompt('Note content');
                if (!content) return;
                await api.createNote({ title: 'Note', content });
                setNotesData(await api.getNotes());
              }}
            >
              New note
            </button>
            {(notesData.notes || []).map((n) => (
              <div key={n.id} className="note-card">
                <div>{n.content}</div>
                <button
                  className="btn"
                  type="button"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    editor.chain().focus().insertContent(`<p>${n.content}</p>`).run();
                  }}
                >
                  Insert into doc
                </button>
              </div>
            ))}
            <h4 style={{ marginTop: 16 }}>Tasks</h4>
            {(notesData.tasks || []).map((t) => (
              <div key={t.id} className="note-card">
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={!!t.done}
                    onChange={async (e) => {
                      await api.updateTask(t.id, { done: e.target.checked });
                      setNotesData(await api.getNotes());
                    }}
                  />
                  {t.title}
                </label>
              </div>
            ))}
            <button className="btn" type="button" onClick={() => setDrawer(null)}>
              Close
            </button>
          </aside>
        )}

        {showAi && !drawer && (
          <AiPanel
            ref={aiPanelRef}
            documentId={id}
            documentTitle={title}
            getHtml={() => editor?.getHTML() || ''}
            onDocumentUpdated={onDocumentUpdated}
          />
        )}
      </div>

      <div className="status-bar">
        {wordCount.words} words · {wordCount.chars} characters
        {!isPageless ? ` · Page ${currentPage} of ${pageCount}` : ''}
        {editMode === 'suggesting' ? ' · Suggesting mode' : ''}
      </div>

      <input ref={fileImageRef} type="file" accept="image/*" className="sr-only" onChange={insertImageFile} />

      {modal === 'export' && (
        <div className="modal-backdrop" onClick={() => !exportBusy && setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Export</h3>
            <p className="ai-hint">
              PDF captures the paginated editor exactly as you see it. Other formats download from the
              saved file.
            </p>
            {exportError && (
              <p className="ai-hint" style={{ color: 'var(--danger, #c62828)' }}>
                {exportError}
              </p>
            )}
            {exportBusy === 'pdf' && (
              <p className="ai-hint" ref={exportProgressRef}>
                Preparing PDF…
              </p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['pdf', 'docx', 'rtf', 'epub', 'odt', 'html', 'txt'].map((fmt) => (
                <button
                  key={fmt}
                  className="btn"
                  type="button"
                  disabled={!!exportBusy}
                  onClick={async () => {
                    setExportError('');
                    setExportBusy(fmt);
                    try {
                      if (fmt === 'pdf' && !isPageless && pageStackRef.current) {
                        try {
                          editor?.chain().setTextSelection(1).blur().run();
                        } catch {
                          editor?.commands?.blur?.();
                        }
                        await flushSave({ html: editor.getHTML() });
                        // Wait a tick so React can paint the progress node before capture.
                        await new Promise((r) => requestAnimationFrame(r));
                        await captureEditorPdf({
                          stackEl: pageStackRef.current,
                          pageWidth,
                          pageHeight,
                          pageCount,
                          gap: PAGE_GAP_PX,
                          filename: safePdfFilename(title),
                          onProgress: (page, total) => {
                            // Avoid setState mid-capture (re-renders break the page stack).
                            if (exportProgressRef.current) {
                              exportProgressRef.current.textContent = `Capturing page ${page} of ${total}…`;
                            }
                          },
                        });
                        setModal(null);
                      } else {
                        await api.downloadExport(id, fmt);
                      }
                    } catch (err) {
                      console.error('Export failed', err);
                      setExportError(exportErrMessage(err) || `Failed to export .${fmt}`);
                    } finally {
                      setExportBusy('');
                    }
                  }}
                >
                  {exportBusy === fmt ? `Exporting .${fmt}…` : `.${fmt}`}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button
                className="btn"
                type="button"
                disabled={!!exportBusy}
                onClick={() => {
                  setExportError('');
                  setModal(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'special' && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Special characters</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 20 }}>
              {[...SPECIALS].map((ch, i) => (
                <button
                  key={`${ch}-${i}`}
                  className="btn btn-icon"
                  type="button"
                  onClick={() => {
                    editor.chain().focus().insertContent(ch).run();
                    setModal(null);
                  }}
                >
                  {ch}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'page' && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Page setup</h3>
            <div style={{ display: 'grid', gap: 10 }}>
              <label>
                Paper
                <select
                  className="field"
                  value={pageSetup.paperSize}
                  onChange={(e) => handlePageSetup({ ...pageSetup, paperSize: e.target.value })}
                >
                  <option value="a4">A4 (210 × 297 mm)</option>
                  <option value="letter">Letter (8.5 × 11 in)</option>
                </select>
              </label>
              <label>
                Orientation
                <select
                  className="field"
                  value={pageSetup.orientation}
                  onChange={(e) => handlePageSetup({ ...pageSetup, orientation: e.target.value })}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label>
                Background
                <input
                  className="field"
                  type="color"
                  value={pageSetup.backgroundColor || '#ffffff'}
                  onChange={(e) => handlePageSetup({ ...pageSetup, backgroundColor: e.target.value })}
                />
              </label>
              {['top', 'right', 'bottom', 'left'].map((side) => (
                <label key={side}>
                  Margin {side} (px)
                  <input
                    className="field"
                    type="number"
                    value={pageSetup.margins?.[side] ?? 96}
                    onChange={(e) =>
                      handlePageSetup({
                        ...pageSetup,
                        margins: { ...pageSetup.margins, [side]: Number(e.target.value) },
                      })
                    }
                  />
                </label>
              ))}
              <label>
                Header text
                <input
                  className="field"
                  value={pageSetup.header?.content || ''}
                  onChange={(e) =>
                    handlePageSetup({
                      ...pageSetup,
                      header: { ...pageSetup.header, enabled: true, content: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                Footer text
                <input
                  className="field"
                  value={pageSetup.footer?.content || ''}
                  onChange={(e) =>
                    handlePageSetup({
                      ...pageSetup,
                      footer: { ...pageSetup.footer, enabled: true, content: e.target.value },
                    })
                  }
                />
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={!!pageSetup.footer?.showPageNumbers}
                  onChange={(e) =>
                    handlePageSetup({
                      ...pageSetup,
                      footer: { ...pageSetup.footer, showPageNumbers: e.target.checked },
                    })
                  }
                />
                Show page numbers
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={!!pageSetup.columnDivider}
                  onChange={(e) => handlePageSetup({ ...pageSetup, columnDivider: e.target.checked })}
                />
                Column divider
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={!!pageSetup.watermark?.enabled}
                  onChange={(e) =>
                    handlePageSetup({
                      ...pageSetup,
                      watermark: {
                        ...pageSetup.watermark,
                        enabled: e.target.checked,
                        type: 'text',
                        text: pageSetup.watermark?.text || 'DRAFT',
                      },
                    })
                  }
                />
                Watermark
              </label>
              {pageSetup.watermark?.enabled && (
                <input
                  className="field"
                  value={pageSetup.watermark.text || ''}
                  onChange={(e) =>
                    handlePageSetup({
                      ...pageSetup,
                      watermark: { ...pageSetup.watermark, text: e.target.value },
                    })
                  }
                  placeholder="Watermark text"
                />
              )}
              <button
                className="btn"
                type="button"
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .insertContent(
                      `<h2>Table of Contents</h2><ul>${headings
                        .map((h) => `<li style="margin-left:${(h.level - 1) * 16}px">${h.text}</li>`)
                        .join('')}</ul>`
                    )
                    .run();
                  setModal(null);
                }}
              >
                Insert table of contents
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  const style = window.prompt('Citation style: APA, MLA, or Chicago', 'APA');
                  const cite = window.prompt('Citation text');
                  if (!cite) return;
                  const citations = [...(doc.citations || []), { id: uid(), style, text: cite }];
                  setDoc({ ...doc, citations });
                  editor.chain().focus().insertContent(`<sup>[${citations.length}]</sup>`).run();
                  editor.chain().focus().insertFootnote(`[${citations.length}] (${style}) ${cite}`).run();
                  scheduleSave({ citations, html: editor.getHTML() });
                }}
              >
                Add citation
              </button>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" type="button" onClick={() => setModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
