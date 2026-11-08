import { useEffect, useRef, useState } from 'react';

function pageKey(index) {
  return String(index);
}

function isUnsynced(section, pageIndex) {
  const overrides = section?.overrides;
  if (!overrides || typeof overrides !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(overrides, pageKey(pageIndex));
}

function getSectionText(section, pageIndex, fallback = '') {
  if (isUnsynced(section, pageIndex)) {
    return section.overrides[pageKey(pageIndex)] ?? '';
  }
  return section?.content ?? fallback;
}

/**
 * Interactive header/footer for one paper sheet.
 * Synced by default; footer (and header) can be unsynced per page via checkbox.
 */
export default function PageChrome({
  pageIndex,
  pageCount,
  top,
  width,
  height,
  margins,
  pageSetup,
  documentTitle,
  onPageSetup,
}) {
  const [editing, setEditing] = useState(null); // 'header' | 'footer' | null
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const header = pageSetup.header || {};
  const footer = pageSetup.footer || {};
  const headerUnsynced = isUnsynced(header, pageIndex);
  const footerUnsynced = isUnsynced(footer, pageIndex);
  const headerText = getSectionText(header, pageIndex, '');
  const footerText = getSectionText(footer, pageIndex, '');

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select?.();
    }
  }, [editing]);

  function patchSection(which, patch) {
    const current = pageSetup[which] || {};
    onPageSetup({
      ...pageSetup,
      [which]: {
        ...current,
        enabled: true,
        ...patch,
      },
    });
  }

  function startEdit(which) {
    const section = which === 'header' ? header : footer;
    const text = getSectionText(section, pageIndex, which === 'header' ? documentTitle || '' : '');
    setDraft(text);
    setEditing(which);
  }

  function commitEdit() {
    if (!editing) return;
    const which = editing;
    const section = which === 'header' ? header : footer;
    const value = draft;

    if (isUnsynced(section, pageIndex)) {
      patchSection(which, {
        overrides: {
          ...(section.overrides || {}),
          [pageKey(pageIndex)]: value,
        },
      });
    } else {
      patchSection(which, { content: value });
    }
    setEditing(null);
  }

  function cancelEdit() {
    setEditing(null);
  }

  function setUnsynced(which, enabled) {
    const section = which === 'header' ? header : footer;
    const overrides = { ...(section.overrides || {}) };
    const key = pageKey(pageIndex);

    if (enabled) {
      overrides[key] = getSectionText(section, pageIndex, which === 'header' ? documentTitle || '' : '');
      patchSection(which, { overrides });
    } else {
      delete overrides[key];
      patchSection(which, { overrides });
    }
  }

  const pad = {
    paddingLeft: margins.left,
    paddingRight: margins.right,
  };

  return (
    <div
      className="page-chrome"
      style={{
        top,
        width,
        height,
      }}
    >
      <div
        className={`page-chrome-header ${headerUnsynced ? 'unsynced' : ''} ${editing === 'header' ? 'editing' : ''} ${headerText ? 'has-content' : ''}`}
        style={pad}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          startEdit('header');
        }}
      >
        {editing === 'header' ? (
          <input
            ref={inputRef}
            className="page-chrome-input"
            value={draft}
            placeholder="Header"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="page-chrome-text">
            {headerText || <span className="page-chrome-placeholder">Double-click to add header</span>}
          </span>
        )}
        <label
          className="page-chrome-unsync"
          title={headerUnsynced ? 'Re-sync with other headers' : 'Make this header different from other pages'}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={headerUnsynced}
            onChange={(e) => setUnsynced('header', e.target.checked)}
          />
          <span>Different</span>
        </label>
      </div>

      <div
        className={`page-chrome-footer ${footerUnsynced ? 'unsynced' : ''} ${editing === 'footer' ? 'editing' : ''} ${footerText || footer.showPageNumbers === true ? 'has-content' : ''}`}
        style={pad}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          startEdit('footer');
        }}
      >
        <div className="page-chrome-footer-main">
          {editing === 'footer' ? (
            <input
              ref={inputRef}
              className="page-chrome-input"
              value={draft}
              placeholder="Footer"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitEdit();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="page-chrome-text">
              {footerText || <span className="page-chrome-placeholder">Double-click to add footer</span>}
            </span>
          )}
          {footer.showPageNumbers === true && (
            <span className="page-chrome-pagenum">
              Page {pageIndex + 1} of {pageCount}
            </span>
          )}
        </div>
        <label
          className="page-chrome-unsync footer-unsync"
          title={footerUnsynced ? 'Re-sync with other footers' : 'Make this footer different from other pages'}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={footerUnsynced}
            onChange={(e) => setUnsynced('footer', e.target.checked)}
          />
          <span>Different</span>
        </label>
      </div>
    </div>
  );
}
