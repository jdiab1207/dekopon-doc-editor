import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const CELL_COLORS = [
  'transparent',
  '#ffffff',
  '#f1f3f4',
  '#e8f0fe',
  '#e6f4ea',
  '#fef7e0',
  '#fce8e6',
  '#f3e8fd',
  '#e0f2f1',
];

const BORDER_COLORS = ['#c9d0d6', '#202124', '#1a73e8', '#188038', '#b06000', '#c5221f', '#ffffff'];

function ToolBtn({ onClick, title, active, danger, children, disabled }) {
  return (
    <button
      type="button"
      className={`table-tool ${active ? 'active' : ''} ${danger ? 'danger' : ''}`}
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="table-tool-sep" />;
}

function applyCellAttr(editor, key, value) {
  if (typeof editor.commands.setCellAttribute === 'function') {
    editor.chain().focus().setCellAttribute(key, value).run();
    return;
  }
  const cellType = editor.isActive('tableHeader') ? 'tableHeader' : 'tableCell';
  editor.chain().focus().updateAttributes(cellType, { [key]: value }).run();
}

function findTableNode(editor) {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d);
    if (node.type.name === 'table') return node;
  }
  return null;
}

export default function TableBubbleMenu({ editor }) {
  const [pos, setPos] = useState(null);
  const [tick, setTick] = useState(0);
  const menuRef = useRef(null);
  const lastPosRef = useRef(null);

  useEffect(() => {
    if (!editor) return undefined;
    const bump = () => setTick((n) => n + 1);
    const onTransaction = ({ transaction: tr }) => {
      // Ignore decoration-only / pagination meta transactions — those caused freezes.
      if (!tr.docChanged && !tr.selectionSet) return;
      bump();
    };
    editor.on('selectionUpdate', bump);
    editor.on('transaction', onTransaction);
    editor.on('focus', bump);
    editor.on('blur', bump);
    return () => {
      editor.off('selectionUpdate', bump);
      editor.off('transaction', onTransaction);
      editor.off('focus', bump);
      editor.off('blur', bump);
    };
  }, [editor]);

  const inTable = !!editor?.isActive('table');
  const selFrom = editor?.state.selection.from ?? 0;
  const selTo = editor?.state.selection.to ?? 0;

  useLayoutEffect(() => {
    if (!editor || !inTable) {
      if (lastPosRef.current !== null) {
        lastPosRef.current = null;
        setPos(null);
      }
      return;
    }
    try {
      const { from, to } = editor.state.selection;
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(Math.max(from, to - 1));
      const menuEl = menuRef.current;
      const menuWidth = menuEl?.offsetWidth || 560;
      const menuHeight = menuEl?.offsetHeight || 110;
      const midX = (start.left + end.right) / 2;
      let left = Math.min(Math.max(12, midX - menuWidth / 2), window.innerWidth - menuWidth - 12);
      let top = start.top - menuHeight - 10;
      if (top < 12) top = Math.min(window.innerHeight - menuHeight - 12, end.bottom + 10);
      left = Math.round(left);
      top = Math.round(top);
      const prev = lastPosRef.current;
      if (prev && prev.top === top && prev.left === left) return;
      lastPosRef.current = { top, left };
      setPos({ top, left });
    } catch {
      if (lastPosRef.current !== null) {
        lastPosRef.current = null;
        setPos(null);
      }
    }
  }, [editor, inTable, selFrom, selTo, tick]);

  if (!editor || !pos || !inTable) return null;

  const inHeader = editor.isActive('tableHeader');
  const attrs = editor.getAttributes(inHeader ? 'tableHeader' : 'tableCell');

  const setColWidth = (width) => {
    applyCellAttr(editor, 'colwidth', width ? [width] : null);
  };

  const distributeColumns = () => {
    const table = findTableNode(editor);
    const colCount = table?.firstChild?.childCount || 0;
    if (!colCount) return;
    const even = Math.max(48, Math.floor(700 / colCount));
    applyCellAttr(editor, 'colwidth', [even]);
  };

  return createPortal(
    <div ref={menuRef} className="table-bubble" style={{ top: pos.top, left: pos.left }} role="toolbar">
      <div className="table-bubble-row">
        <ToolBtn title="Add column before" onClick={() => editor.chain().focus().addColumnBefore().run()}>
          +Col ←
        </ToolBtn>
        <ToolBtn title="Add column after" onClick={() => editor.chain().focus().addColumnAfter().run()}>
          +Col →
        </ToolBtn>
        <ToolBtn title="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()}>
          ⌫Col
        </ToolBtn>
        <Sep />
        <ToolBtn title="Add row before" onClick={() => editor.chain().focus().addRowBefore().run()}>
          +Row ↑
        </ToolBtn>
        <ToolBtn title="Add row after" onClick={() => editor.chain().focus().addRowAfter().run()}>
          +Row ↓
        </ToolBtn>
        <ToolBtn title="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}>
          ⌫Row
        </ToolBtn>
        <Sep />
        <ToolBtn
          title="Merge cells"
          disabled={!editor.can().mergeCells?.()}
          onClick={() => editor.chain().focus().mergeCells().run()}
        >
          Merge
        </ToolBtn>
        <ToolBtn
          title="Split cell"
          disabled={!editor.can().splitCell?.()}
          onClick={() => editor.chain().focus().splitCell().run()}
        >
          Split
        </ToolBtn>
        <ToolBtn title="Toggle header row" onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
          Header
        </ToolBtn>
        <ToolBtn
          title="Toggle header column"
          onClick={() => editor.chain().focus().toggleHeaderColumn().run()}
        >
          H-Col
        </ToolBtn>
      </div>

      <div className="table-bubble-row">
        <span className="table-tool-label">Fill</span>
        {CELL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c === 'transparent' ? 'Clear fill' : c}
            className={`table-swatch ${attrs.backgroundColor === c || (!attrs.backgroundColor && c === 'transparent') ? 'active' : ''}`}
            style={{
              background:
                c === 'transparent'
                  ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)'
                  : c,
              backgroundSize: c === 'transparent' ? '8px 8px' : undefined,
              backgroundPosition: c === 'transparent' ? '0 0, 0 4px, 4px -4px, -4px 0' : undefined,
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyCellAttr(editor, 'backgroundColor', c === 'transparent' ? null : c)}
          />
        ))}
        <Sep />
        <span className="table-tool-label">Border</span>
        {BORDER_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            className={`table-swatch border ${attrs.borderColor === c ? 'active' : ''}`}
            style={{ background: c }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyCellAttr(editor, 'borderColor', c)}
          />
        ))}
        <select
          className="table-select"
          title="Border width"
          value={attrs.borderWidth || '1px'}
          onChange={(e) => applyCellAttr(editor, 'borderWidth', e.target.value)}
        >
          <option value="0px">0px</option>
          <option value="1px">1px</option>
          <option value="2px">2px</option>
          <option value="3px">3px</option>
        </select>
        <select
          className="table-select"
          title="Vertical align"
          value={attrs.verticalAlign || 'top'}
          onChange={(e) => applyCellAttr(editor, 'verticalAlign', e.target.value)}
        >
          <option value="top">Top</option>
          <option value="middle">Middle</option>
          <option value="bottom">Bottom</option>
        </select>
      </div>

      <div className="table-bubble-row">
        <span className="table-tool-label">Pad</span>
        <select
          className="table-select"
          title="Cell padding"
          value={attrs.padding || '8px'}
          onChange={(e) => applyCellAttr(editor, 'padding', e.target.value)}
        >
          <option value="2px">S</option>
          <option value="8px">M</option>
          <option value="14px">L</option>
          <option value="20px">XL</option>
        </select>
        <Sep />
        <span className="table-tool-label">Col</span>
        <select
          className="table-select"
          title="Column width (px)"
          value={Array.isArray(attrs.colwidth) && attrs.colwidth[0] ? String(attrs.colwidth[0]) : ''}
          onChange={(e) => setColWidth(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Auto</option>
          <option value="80">80</option>
          <option value="120">120</option>
          <option value="160">160</option>
          <option value="200">200</option>
          <option value="260">260</option>
          <option value="320">320</option>
        </select>
        <ToolBtn title="Distribute columns evenly" onClick={distributeColumns}>
          Even cols
        </ToolBtn>
        <Sep />
        <ToolBtn
          title="Table full width"
          onClick={() => editor.chain().focus().updateAttributes('table', { style: 'width: 100%' }).run()}
        >
          100%
        </ToolBtn>
        <ToolBtn
          title="Table auto width"
          onClick={() => editor.chain().focus().updateAttributes('table', { style: null }).run()}
        >
          Auto
        </ToolBtn>
        <Sep />
        <ToolBtn title="Align left" onClick={() => editor.chain().focus().setTextAlign('left').run()}>
          ⫷
        </ToolBtn>
        <ToolBtn title="Align center" onClick={() => editor.chain().focus().setTextAlign('center').run()}>
          ≡
        </ToolBtn>
        <ToolBtn title="Align right" onClick={() => editor.chain().focus().setTextAlign('right').run()}>
          ⫸
        </ToolBtn>
        <Sep />
        <ToolBtn
          danger
          title="Delete table"
          onClick={() => {
            if (window.confirm('Delete this table?')) editor.chain().focus().deleteTable().run();
          }}
        >
          Delete
        </ToolBtn>
      </div>
      <div className="table-bubble-hint">Drag column borders to resize · Shift-select cells to merge</div>
    </div>,
    document.body
  );
}
