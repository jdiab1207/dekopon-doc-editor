import { useEffect, useRef, useState } from 'react';

/**
 * Compact insert-table size picker for the main toolbar.
 */
export function TableInsertPicker({ editor }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState({ r: 3, c: 3 });
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!editor) return null;

  return (
    <div className="table-insert" ref={rootRef}>
      <button
        type="button"
        className={`tool ${open ? 'active' : ''}`}
        title="Insert table"
        onClick={() => setOpen((v) => !v)}
      >
        Table ▾
      </button>
      {open && (
        <div className="table-insert-pop">
          <div className="table-insert-label">
            {hover.r} × {hover.c}
          </div>
          <div className="table-insert-grid">
            {Array.from({ length: 6 }, (_, r) =>
              Array.from({ length: 6 }, (_, c) => (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  className={`table-insert-cell ${r < hover.r && c < hover.c ? 'hot' : ''}`}
                  onMouseEnter={() => setHover({ r: r + 1, c: c + 1 })}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    editor
                      .chain()
                      .focus()
                      .insertTable({ rows: r + 1, cols: c + 1, withHeaderRow: true })
                      .run();
                    setOpen(false);
                  }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
