import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import '../styles/library.css';

const DEFAULT_FOLDER_COLOR = '#F4B400';
const LAST_FOLDER_KEY = 'dekopon.lastFolderId';
const FOLDER_COLORS = [
  '#F28B82', '#FF9E80', '#F4B400', '#FDD663', '#FCFF8F',
  '#CCFF90', '#7CB342', '#0F9D58', '#A7FFEB', '#0097A7',
  '#CBF0F8', '#AECBFA', '#1A73E8', '#3F51B5', '#D7AEFB',
  '#7E57C2', '#AB47BC', '#FDCFE8', '#D81B60', '#E6C9A8',
  '#D93025', '#E8710A', '#F9AB00', '#E8EAED', '#5F6368',
];

function FolderIcon({ color }) {
  return (
    <div className="tile-icon folder-icon" style={{ '--folder-color': color }}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.75 5.25h5.1l1.7 2h9.7v11.5H3.75z" />
        <path d="M3.75 5.25h5.1l1.7 2H3.75z" opacity="0.72" />
      </svg>
    </div>
  );
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function getLastFolderId() {
  try {
    return window.localStorage.getItem(LAST_FOLDER_KEY) || 'root';
  } catch {
    return 'root';
  }
}

export default function LibraryPage() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState(getLastFolderId);
  const [view, setView] = useState('drive');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [menuId, setMenuId] = useState(null);

  async function refresh() {
    const [docs, folds] = await Promise.all([api.listDocuments(), api.listFolders()]);
    setDocuments(docs);
    setFolders(folds);
    setFolderId((current) => folds.some((folder) => folder.id === current) ? current : 'root');
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LAST_FOLDER_KEY, folderId);
    } catch {
      return;
    }
  }, [folderId]);

  const crumbs = useMemo(() => {
    const trail = [];
    let current = folders.find((f) => f.id === folderId);
    while (current) {
      trail.unshift(current);
      current = folders.find((f) => f.id === current.parentId);
    }
    return trail;
  }, [folders, folderId]);

  const visibleFolders = folders.filter((f) => f.parentId === folderId && f.id !== 'root');
  const visibleDocs = documents
    .filter((d) => {
      if (view === 'starred') return d.starred;
      if (view === 'recent') return true;
      return d.folderId === folderId;
    })
    .filter((d) => !query || d.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  async function createDoc() {
    setBusy(true);
    try {
      const doc = await api.createDocument({ title: 'Untitled document', folderId });
      navigate(`/doc/${doc.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createFolder() {
    const name = window.prompt('Folder name');
    if (!name) return;
    setBusy(true);
    try {
      await api.createFolder({ name, parentId: folderId });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onImport(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const doc = await api.importFile(file, folderId);
      navigate(`/doc/${doc.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function moveDoc(id) {
    const target = window.prompt('Move to folder id (see folders), or leave blank for root', folderId);
    if (target === null) return;
    await api.updateDocument(id, { folderId: target || 'root' });
    await refresh();
    setMenuId(null);
  }

  return (
    <div className="library">
      <aside className="library-side">
        <h1 className="brand">
          Dekopon <span>Docs</span>
        </h1>
        <p className="brand-sub">Local documents · Cursor-powered</p>
        <nav className="side-nav">
          <button className={view === 'drive' ? 'active' : ''} onClick={() => { setView('drive'); setFolderId('root'); }}>
            My Drive
          </button>
          <button className={view === 'recent' ? 'active' : ''} onClick={() => setView('recent')}>
            Recent
          </button>
          <button className={view === 'starred' ? 'active' : ''} onClick={() => setView('starred')}>
            Starred
          </button>
        </nav>
      </aside>

      <main className="library-main">
        <div className="library-top">
          <div>
            <h2>{view === 'starred' ? 'Starred' : view === 'recent' ? 'Recent' : 'My Drive'}</h2>
            <p>Write locally. Export anywhere. Edit with Cursor from the sidebar.</p>
          </div>
          <div className="library-actions">
            <input
              className="field"
              style={{ width: 220 }}
              placeholder="Search documents…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="btn" disabled={busy} onClick={createFolder}>
              New folder
            </button>
            <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              Import
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={createDoc}>
              Blank document
            </button>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              accept=".docx,.doc,.pdf,.html,.htm,.txt,.md,.rtf"
              onChange={onImport}
            />
          </div>
        </div>

        {view === 'drive' && (
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ' / '}
                <button onClick={() => setFolderId(c.id)}>{c.name}</button>
              </span>
            ))}
          </div>
        )}

        {error && (
          <p style={{ color: 'var(--danger)', marginBottom: 16 }} onClick={() => setError('')}>
            {error}
          </p>
        )}

        {!visibleFolders.length && !visibleDocs.length ? (
          <div className="empty">
            <p>No documents here yet. Create a blank doc or import a PDF / DOCX.</p>
          </div>
        ) : (
          <div className="grid">
            {view === 'drive' &&
              visibleFolders.map((folder) => (
                <div
                  key={folder.id}
                  className="tile folder"
                  onDoubleClick={() => setFolderId(folder.id)}
                  onClick={() => setFolderId(folder.id)}
                  role="button"
                  tabIndex={0}
                >
                  <FolderIcon color={folder.color || DEFAULT_FOLDER_COLOR} />
                  <h3>{folder.name}</h3>
                  <div className="meta">Folder</div>
                  <div className="tile-menu">
                    <button
                      className="btn btn-icon btn-ghost"
                      aria-label={`Folder settings for ${folder.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuId(menuId === folder.id ? null : folder.id);
                      }}
                    >
                      ⋯
                    </button>
                    {menuId === folder.id && (
                      <div className="menu folder-menu" style={{ right: 0, top: 36 }} onClick={(e) => e.stopPropagation()}>
                        <div className="folder-color-label">Folder color</div>
                        <div className="folder-color-grid">
                          {FOLDER_COLORS.map((color) => (
                            <button
                              key={color}
                              className={(folder.color || DEFAULT_FOLDER_COLOR) === color ? 'selected' : ''}
                              style={{ '--swatch-color': color }}
                              title={color}
                              aria-label={`Set folder color to ${color}`}
                              aria-pressed={(folder.color || DEFAULT_FOLDER_COLOR) === color}
                              onClick={async () => {
                                await api.updateFolder(folder.id, { color });
                                await refresh();
                                setMenuId(null);
                              }}
                            />
                          ))}
                        </div>
                        <div className="folder-menu-divider" />
                        <button
                          onClick={async () => {
                            const name = window.prompt('Rename folder', folder.name);
                            if (!name) return;
                            await api.updateFolder(folder.id, { name });
                            await refresh();
                            setMenuId(null);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          onClick={async () => {
                            if (!window.confirm('Delete this folder?')) return;
                            try {
                              await api.deleteFolder(folder.id);
                              await refresh();
                            } catch (err) {
                              setError(err.message);
                            }
                            setMenuId(null);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

            {visibleDocs.map((doc) => (
              <div
                key={doc.id}
                className="tile"
                onClick={() => navigate(`/doc/${doc.id}`)}
                role="button"
                tabIndex={0}
              >
                <div className="tile-icon">📄</div>
                <h3>{doc.title}</h3>
                <div className="meta">Updated {formatDate(doc.updatedAt)}</div>
                <div className="tile-menu">
                  <button
                    className="btn btn-icon btn-ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuId(menuId === doc.id ? null : doc.id);
                    }}
                  >
                    ⋯
                  </button>
                  {menuId === doc.id && (
                    <div className="menu" style={{ right: 0, top: 36 }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={async () => {
                          await api.starDocument(doc.id);
                          await refresh();
                          setMenuId(null);
                        }}
                      >
                        {doc.starred ? 'Unstar' : 'Star'}
                      </button>
                      <button onClick={() => moveDoc(doc.id)}>Move</button>
                      <button
                        onClick={async () => {
                          const copy = await api.duplicateDocument(doc.id);
                          navigate(`/doc/${copy.id}`);
                        }}
                      >
                        Duplicate
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm('Delete this document?')) return;
                          await api.deleteDocument(doc.id);
                          await refresh();
                          setMenuId(null);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
