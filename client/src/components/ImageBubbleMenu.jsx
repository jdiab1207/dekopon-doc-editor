import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pausePageGaps } from '../editor/pageGaps';
import { IMAGE_MARGIN_OPTIONS } from '../editor/resizableImage';

const WRAPS = [
  { id: 'inline', label: 'In line', title: 'Treats the image like a character in the paragraph' },
  { id: 'wrap', label: 'Wrap text', title: 'Text flows around the image' },
  { id: 'break', label: 'Break text', title: 'Text sits only above and below the image' },
  { id: 'behind', label: 'Behind text', title: 'Image sits behind the text; drag to position' },
  { id: 'front', label: 'In front of text', title: 'Image sits over the text; drag to position' },
];

function normalizeWrap(raw) {
  if (raw === 'wrap-left' || raw === 'wrap-right') return 'wrap';
  return raw || 'inline';
}

function ToolBtn({ onClick, title, active, danger, children, disabled }) {
  return (
    <button
      type="button"
      className={`image-tool ${active ? 'active' : ''} ${danger ? 'danger' : ''}`}
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
  return <span className="image-tool-sep" />;
}

export default function ImageBubbleMenu({ editor }) {
  const [pos, setPos] = useState(null);
  const [tick, setTick] = useState(0);
  const menuRef = useRef(null);
  const lastPosRef = useRef(null);

  useEffect(() => {
    if (!editor) return undefined;
    const bump = () => setTick((n) => n + 1);
    const onTransaction = ({ transaction: tr }) => {
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

  const active = !!editor?.isActive('image');
  const selFrom = editor?.state.selection.from ?? 0;

  useLayoutEffect(() => {
    if (!editor || !active) {
      if (lastPosRef.current !== null) {
        lastPosRef.current = null;
        setPos(null);
      }
      return;
    }
    try {
      const { from } = editor.state.selection;
      const start = editor.view.coordsAtPos(from);
      // Prefer the visible image frame for layered images
      const frame = editor.view.dom.querySelector('.doc-image-node.is-selected .doc-image-frame');
      const box = frame?.getBoundingClientRect();
      const menuEl = menuRef.current;
      const menuWidth = menuEl?.offsetWidth || 560;
      const menuHeight = menuEl?.offsetHeight || 88;
      const anchorLeft = box ? box.left : start.left;
      const anchorTop = box ? box.top : start.top;
      const anchorBottom = box ? box.bottom : start.bottom;
      let left = Math.min(Math.max(12, anchorLeft), window.innerWidth - menuWidth - 12);
      let top = anchorTop - menuHeight - 10;
      if (top < 12) top = Math.min(window.innerHeight - menuHeight - 12, anchorBottom + 10);
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
  }, [editor, active, selFrom, tick]);

  if (!editor || !pos || !active) return null;

  const attrs = editor.getAttributes('image');
  const wrap = normalizeWrap(attrs.wrap);
  const wrapAlign = attrs.wrapAlign === 'right' ? 'right' : 'left';
  const marginIn = attrs.marginIn ?? 0.125;
  const positionMode = attrs.positionMode === 'fixed' ? 'fixed' : 'move-with-text';
  const width = attrs.width ? Number(attrs.width) : null;
  const repeatOnPages = !!attrs.repeatOnPages;
  const opacityPct = Math.round(
    (attrs.opacity != null ? Number(attrs.opacity) : wrap === 'behind' ? 0.5 : 1) * 100
  );
  const showMargin = wrap === 'wrap' || wrap === 'behind' || wrap === 'front';
  // Offset / fix-on-page only apply to layered (behind / front) images.
  const showPosition = wrap === 'behind' || wrap === 'front';
  const showAlign = wrap === 'wrap';
  const showRepeatOnPages = wrap === 'behind';
  const showOpacity = wrap === 'behind';

  const patch = (attrsPatch) => {
    pausePageGaps(500);
    editor.chain().focus().updateAttributes('image', attrsPatch).run();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="image-bubble"
      style={{ top: pos.top, left: pos.left }}
      role="toolbar"
    >
      <div className="image-bubble-section-label">Text wrapping</div>
      <div className="image-bubble-row">
        {WRAPS.map((w) => (
          <ToolBtn
            key={w.id}
            title={w.title}
            active={wrap === w.id}
            onClick={() => {
              pausePageGaps(500);
              editor.chain().focus().setImageWrap(w.id).run();
            }}
          >
            {w.label}
          </ToolBtn>
        ))}
      </div>

      {(showAlign || showMargin || showPosition) && (
        <div className="image-bubble-row">
          {showAlign && (
            <>
              <span className="image-tool-label">Align</span>
              <ToolBtn
                title="Float left — text wraps on the right"
                active={wrapAlign === 'left'}
                onClick={() => editor.chain().focus().setImageWrapAlign('left').run()}
              >
                Left
              </ToolBtn>
              <ToolBtn
                title="Float right — text wraps on the left"
                active={wrapAlign === 'right'}
                onClick={() => editor.chain().focus().setImageWrapAlign('right').run()}
              >
                Right
              </ToolBtn>
              <Sep />
            </>
          )}
          {showMargin && (
            <label className="image-tool-size" title="Space between image and text">
              Margin
              <select
                value={String(marginIn)}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  pausePageGaps(400);
                  editor.chain().focus().setImageMarginIn(Number(e.target.value)).run();
                }}
              >
                {IMAGE_MARGIN_OPTIONS.map((opt) => (
                  <option key={opt.inches} value={opt.inches}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {showPosition && (
            <>
              <Sep />
              <span className="image-tool-label">Position</span>
              <ToolBtn
                title="Anchors to the paragraph — moves as you type"
                active={positionMode === 'move-with-text'}
                onClick={() => editor.chain().focus().setImagePositionMode('move-with-text').run()}
              >
                Move with text
              </ToolBtn>
              <ToolBtn
                title="Pins to a fixed spot on the page"
                active={positionMode === 'fixed'}
                onClick={() => editor.chain().focus().setImagePositionMode('fixed').run()}
              >
                Fix on page
              </ToolBtn>
            </>
          )}
          {showRepeatOnPages && (
            <>
              <Sep />
              <label
                className="image-tool-check"
                title="Paint this behind-text image at the same place on every page"
              >
                <input
                  type="checkbox"
                  checked={repeatOnPages}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    pausePageGaps(400);
                    editor
                      .chain()
                      .focus()
                      .updateAttributes('image', { repeatOnPages: e.target.checked })
                      .run();
                  }}
                />
                Repeat on all pages
              </label>
            </>
          )}
          {showOpacity && (
            <>
              <Sep />
              <label
                className="image-tool-opacity"
                title="Opacity of the behind-text image"
              >
                Opacity
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={1}
                  value={opacityPct}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const pct = Number(e.target.value);
                    pausePageGaps(400);
                    patch({ opacity: Math.min(1, Math.max(0.05, pct / 100)) });
                  }}
                />
                <span className="image-tool-opacity-val">{opacityPct}%</span>
              </label>
            </>
          )}
        </div>
      )}

      <div className="image-bubble-row">
        <label className="image-tool-size" title="Width (px)">
          W
          <input
            type="number"
            min={48}
            max={900}
            value={width || ''}
            placeholder="auto"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : null;
              pausePageGaps(400);
              if (v == null) {
                editor.chain().focus().resetImageSize().run();
                return;
              }
              const ratio =
                attrs.height && attrs.width ? Number(attrs.height) / Number(attrs.width) : null;
              patch({
                width: v,
                height: ratio ? Math.round(v * ratio) : attrs.height,
              });
            }}
          />
        </label>
        <ToolBtn
          title="Reset to original size"
          onClick={() => editor.chain().focus().resetImageSize().run()}
        >
          Reset size
        </ToolBtn>
        <Sep />
        <ToolBtn
          danger
          title="Delete image"
          onClick={() => editor.chain().focus().deleteSelection().run()}
        >
          Delete
        </ToolBtn>
      </div>
      <div className="image-bubble-hint">
        {wrap === 'behind' && repeatOnPages
          ? 'Repeats on every page · drag to reposition · corners to resize'
          : wrap === 'behind' || wrap === 'front'
            ? 'Drag the image to reposition · drag corners to resize'
            : wrap === 'wrap'
              ? 'Wrap text: drag into a paragraph with words — text flows beside, then under the image. Left/Right sets the side.'
              : wrap === 'break'
                ? 'Break text: text only above and below · drag to move · corners to resize'
                : 'Drag corners to resize · drag image to move in the document'}
      </div>
    </div>,
    document.body
  );
}
