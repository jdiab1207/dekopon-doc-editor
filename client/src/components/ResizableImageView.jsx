import { NodeViewWrapper } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PAGE_GAP_PX, pageLayoutRef, pausePageGaps } from '../editor/pageGaps';

const INCH = 96;
const MIN_W = 48;
const MAX_W = 900;
const DEFAULT_LAYER_W = 240;
const DRAG_THRESHOLD_PX = 3;

function normalizeWrap(raw) {
  if (raw === 'wrap-left' || raw === 'wrap-right') return 'wrap';
  return raw || 'inline';
}

function getCloneHost() {
  return document.querySelector('.doc-page-image-clones');
}

function getPageStack() {
  return document.querySelector('.doc-page-stack');
}

/** Reposition an inline image at the document coords under the pointer. */
function relocateImageToCoords(editor, fromPos, clientX, clientY) {
  const { view } = editor;
  const node = view.state.doc.nodeAt(fromPos);
  if (!node || node.type.name !== 'image') return false;

  const drop = view.posAtCoords({ left: clientX, top: clientY });
  if (!drop) return false;

  let insertPos = drop.inside >= 0 ? drop.inside : drop.pos;
  // Prefer dropping into a textblock when the hit is on a block boundary.
  try {
    const $pos = view.state.doc.resolve(Math.min(insertPos, view.state.doc.content.size));
    if (!$pos.parent.isTextblock && $pos.parent.inlineContent) {
      insertPos = $pos.pos;
    } else if (!$pos.parent.isTextblock) {
      if ($pos.nodeBefore?.isTextblock) {
        insertPos = $pos.pos - 1;
      } else if ($pos.nodeAfter?.isTextblock) {
        insertPos = $pos.pos + 1;
      }
    }
  } catch {
    /* use raw insertPos */
  }

  if (insertPos >= fromPos && insertPos <= fromPos + node.nodeSize) return false;

  let tr = view.state.tr;
  if (insertPos > fromPos) {
    tr = tr.delete(fromPos, fromPos + node.nodeSize);
    insertPos = tr.mapping.map(insertPos);
  } else {
    tr = tr.delete(fromPos, fromPos + node.nodeSize);
  }

  insertPos = Math.max(0, Math.min(insertPos, tr.doc.content.size));
  tr = tr.insert(insertPos, node);
  try {
    tr = tr.setSelection(NodeSelection.create(tr.doc, insertPos));
  } catch {
    /* optional */
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Google Docs–style image node view.
 *
 * Wrap text = CSS float on the TipTap nodeview so following copy runs beside,
 * then under the image. Drag uses pointer relocate (HTML5 drag is unreliable
 * on floated node views). Behind/front use free offset dragging.
 */
export default function ResizableImageView({
  node,
  selected,
  updateAttributes,
  editor,
  getPos,
}) {
  const imgRef = useRef(null);
  const frameRef = useRef(null);
  const wrapperRef = useRef(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [liveSize, setLiveSize] = useState(null);
  const [liveOffset, setLiveOffset] = useState(null);
  const [pageClones, setPageClones] = useState([]);
  const [cloneHost, setCloneHost] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef(null);
  const ensuredSizeRef = useRef(false);

  const wrap = normalizeWrap(node.attrs.wrap);
  const wrapAlign = node.attrs.wrapAlign === 'right' ? 'right' : 'left';
  const marginIn = node.attrs.marginIn ?? 0.125;
  const marginPx = Math.round(marginIn * INCH);
  const positionMode = node.attrs.positionMode === 'fixed' ? 'fixed' : 'move-with-text';
  const offsetX = Number(node.attrs.offsetX) || 0;
  const offsetY = Number(node.attrs.offsetY) || 0;
  const width = node.attrs.width ? Number(node.attrs.width) : null;
  const height = node.attrs.height ? Number(node.attrs.height) : null;
  const opacityAttr = node.attrs.opacity;
  const opacity =
    opacityAttr != null && Number.isFinite(Number(opacityAttr))
      ? Number(opacityAttr)
      : wrap === 'behind'
        ? 0.5
        : 1;
  const isLayer = wrap === 'behind' || wrap === 'front';
  const repeatOnPages = !!node.attrs.repeatOnPages && wrap === 'behind';

  useEffect(() => {
    if (!isLayer || !editor.isEditable) {
      ensuredSizeRef.current = false;
      return;
    }
    if (width) {
      ensuredSizeRef.current = false;
      return;
    }
    if (ensuredSizeRef.current) return;
    ensuredSizeRef.current = true;

    const el = imgRef.current;
    let w = DEFAULT_LAYER_W;
    let h = null;
    if (el) {
      const nw = el.naturalWidth || 0;
      const nh = el.naturalHeight || 0;
      if (nw > 0) {
        w = Math.min(MAX_W, Math.max(MIN_W, nw > 400 ? Math.round(nw * 0.35) : nw));
        if (nh > 0) h = Math.round((w / nw) * nh);
      } else {
        const r = el.getBoundingClientRect();
        if (r.width > 8) {
          w = Math.round(r.width);
          h = Math.round(r.height);
        }
      }
    }
    pausePageGaps(400);
    updateAttributes({ width: w, ...(h ? { height: h } : {}) });
  }, [isLayer, width, editor.isEditable, updateAttributes, node.attrs.src]);

  const onImgLoad = () => {
    const el = imgRef.current;
    if (!el) return;
    setNatural({ w: el.naturalWidth || el.width, h: el.naturalHeight || el.height });
  };

  const startResize = useCallback(
    (corner, e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!editor.isEditable) return;
      const el = imgRef.current;
      if (!el) return;

      pausePageGaps(2000);
      const startW = el.getBoundingClientRect().width || width || DEFAULT_LAYER_W;
      const startH = el.getBoundingClientRect().height || height || startW;
      const ratio = startH > 0 ? startW / startH : natural.w && natural.h ? natural.w / natural.h : 1;

      dragRef.current = { type: 'resize', corner, startX: e.clientX, startW, ratio };

      const onMove = (ev) => {
        const d = dragRef.current;
        if (!d || d.type !== 'resize') return;
        pausePageGaps(2000);
        const dx = ev.clientX - d.startX;
        const sign = d.corner.includes('e') ? 1 : -1;
        const nextW = Math.max(MIN_W, Math.min(MAX_W, d.startW + sign * dx));
        const size = { w: Math.round(nextW), h: Math.round(nextW / d.ratio) };
        d.final = size;
        setLiveSize(size);
        if (imgRef.current) {
          imgRef.current.style.width = `${size.w}px`;
          imgRef.current.style.height = `${size.h}px`;
          imgRef.current.style.maxWidth = 'none';
        }
      };

      const onUp = () => {
        const final = dragRef.current?.final;
        dragRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setLiveSize(null);
        if (final) {
          pausePageGaps(500);
          updateAttributes({ width: final.w, height: final.h });
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [editor.isEditable, height, natural.h, natural.w, updateAttributes, width]
  );

  const beginLayerMove = useCallback(
    (clientX, clientY, { alreadySelected = false } = {}) => {
      if (!isLayer || !editor.isEditable) return;
      if (dragRef.current?.type === 'move') return;

      const pos = typeof getPos === 'function' ? getPos() : null;
      if (!alreadySelected && typeof pos === 'number') {
        queueMicrotask(() => {
          if (!editor.isDestroyed) editor.chain().setNodeSelection(pos).run();
        });
      }

      pausePageGaps(2000);
      const ox = liveOffset?.x ?? offsetX;
      const oy = liveOffset?.y ?? offsetY;
      dragRef.current = {
        type: 'move',
        startX: clientX,
        startY: clientY,
        origX: ox,
        origY: oy,
      };
      setIsDragging(true);

      const onMove = (ev) => {
        const d = dragRef.current;
        if (!d || d.type !== 'move') return;
        pausePageGaps(2000);
        const next = {
          x: Math.round(d.origX + (ev.clientX - d.startX)),
          y: Math.round(d.origY + (ev.clientY - d.startY)),
        };
        d.final = next;
        setLiveOffset(next);
      };

      const onUp = () => {
        const final = dragRef.current?.final;
        dragRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setLiveOffset(null);
        setIsDragging(false);
        if (final) {
          pausePageGaps(500);
          updateAttributes({ offsetX: final.x, offsetY: final.y });
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [editor, getPos, isLayer, liveOffset, offsetX, offsetY, updateAttributes]
  );

  const startMove = useCallback(
    (e) => {
      if (!isLayer || !editor.isEditable) return;
      if (e.target?.closest?.('.doc-image-handle')) return;
      if (e.target?.closest?.('.doc-image-select-tab')) return;
      e.preventDefault?.();
      e.stopPropagation?.();
      beginLayerMove(e.clientX, e.clientY);
    },
    [beginLayerMove, editor.isEditable, isLayer]
  );

  /** Wrap / inline / break: pointer-drag relocates the node in the text stream. */
  const startFlowMove = useCallback(
    (e) => {
      if (isLayer || !editor.isEditable) return;
      if (e.target.closest('.doc-image-handle')) return;
      // Stop native HTML5 drag — it does not work reliably on floated node views.
      e.preventDefault();
      e.stopPropagation();

      const fromPos = typeof getPos === 'function' ? getPos() : null;
      if (typeof fromPos !== 'number') return;

      queueMicrotask(() => {
        if (!editor.isDestroyed) editor.chain().setNodeSelection(fromPos).run();
      });
      pausePageGaps(2500);

      dragRef.current = {
        type: 'flow',
        startX: e.clientX,
        startY: e.clientY,
        fromPos,
        moved: false,
      };

      const onMove = (ev) => {
        const d = dragRef.current;
        if (!d || d.type !== 'flow') return;
        const dx = ev.clientX - d.startX;
        const dy = ev.clientY - d.startY;
        if (!d.moved && dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        if (!d.moved) {
          d.moved = true;
          setIsDragging(true);
        }
        pausePageGaps(2500);
        d.clientX = ev.clientX;
        d.clientY = ev.clientY;
      };

      const onUp = (ev) => {
        const d = dragRef.current;
        dragRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setIsDragging(false);
        if (!d || d.type !== 'flow' || !d.moved) return;
        pausePageGaps(600);
        const latestPos = typeof getPos === 'function' ? getPos() : d.fromPos;
        if (typeof latestPos !== 'number') return;
        relocateImageToCoords(editor, latestPos, ev.clientX, ev.clientY);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [editor, getPos, isLayer]
  );

  useLayoutEffect(() => {
    if (!isLayer) return undefined;
    const root = frameRef.current?.closest('.doc-image-node');
    if (!root) return undefined;
    const onLayerDrag = (ev) => {
      const { clientX, clientY } = ev.detail || {};
      if (clientX == null || clientY == null) return;
      queueMicrotask(() => {
        beginLayerMove(clientX, clientY, { alreadySelected: true });
      });
    };
    root.addEventListener('doc-image-layer-drag', onLayerDrag);
    return () => root.removeEventListener('doc-image-layer-drag', onLayerDrag);
  }, [beginLayerMove, isLayer, selected, node.attrs.src]);

  useEffect(() => {
    if (wrap !== 'wrap' || !editor.isEditable) return;
    if (width) return;
    const el = imgRef.current;
    let w = DEFAULT_LAYER_W;
    let h = null;
    if (el) {
      const nw = el.naturalWidth || 0;
      const nh = el.naturalHeight || 0;
      if (nw > 0) {
        w = Math.min(MAX_W, Math.max(MIN_W, nw > 400 ? Math.round(nw * 0.35) : nw));
        if (nh > 0) h = Math.round((w / nw) * nh);
      } else {
        const r = el.getBoundingClientRect();
        if (r.width > 8) {
          w = Math.round(r.width);
          h = Math.round(r.height);
        }
      }
    }
    pausePageGaps(400);
    updateAttributes({ width: w, ...(h ? { height: h } : {}) });
  }, [wrap, width, editor.isEditable, updateAttributes, node.attrs.src]);

  useEffect(() => {
    if (imgRef.current?.complete) onImgLoad();
  }, [node.attrs.src]);

  const displayW = liveSize?.w ?? width ?? (isLayer || wrap === 'wrap' ? DEFAULT_LAYER_W : null);
  const displayH = liveSize?.h ?? height;
  const displayOX = liveOffset?.x ?? offsetX;
  const displayOY = liveOffset?.y ?? offsetY;
  const displayOpacity =
    wrap === 'behind' ? Math.min(1, Math.max(0.05, opacity)) : opacity;

  /**
   * Critical: float the TipTap chrome (.doc-image-nodeview), because THAT is the
   * element sitting in the ProseMirror text stream. Floating only the inner React
   * wrapper leaves an empty inline shell and text will not wrap.
   */
  useLayoutEffect(() => {
    const outer =
      wrapperRef.current?.closest?.('.doc-image-nodeview') ||
      frameRef.current?.closest?.('.doc-image-nodeview');
    if (!outer) return undefined;

    const reset = () => {
      outer.style.float = '';
      outer.style.clear = '';
      outer.style.display = '';
      outer.style.width = '';
      outer.style.maxWidth = '';
      outer.style.margin = '';
      outer.style.lineHeight = '';
      outer.style.verticalAlign = '';
    };

    if (wrap === 'wrap') {
      outer.style.float = wrapAlign === 'right' ? 'right' : 'left';
      outer.style.clear = 'none';
      outer.style.display = 'block';
      outer.style.lineHeight = '0';
      outer.style.verticalAlign = 'top';
      outer.style.maxWidth = '100%';
      outer.style.width = displayW ? `${displayW}px` : '';
      outer.style.margin =
        wrapAlign === 'right'
          ? `${marginPx}px 0 ${marginPx}px ${marginPx}px`
          : `${marginPx}px ${marginPx}px ${marginPx}px 0`;
    } else if (wrap === 'break') {
      reset();
      outer.style.display = 'block';
      outer.style.float = 'none';
      outer.style.clear = 'both';
      outer.style.width = '100%';
      outer.style.margin = `${marginPx}px 0`;
      outer.style.lineHeight = '0';
      outer.style.textAlign = 'center';
    } else if (isLayer) {
      reset();
      outer.style.display = 'inline-block';
      outer.style.width = '0';
      outer.style.height = '0';
      outer.style.overflow = 'visible';
      outer.style.verticalAlign = 'top';
      outer.style.lineHeight = '0';
    } else {
      reset();
      outer.style.display = 'inline-block';
      outer.style.verticalAlign = 'bottom';
      outer.style.lineHeight = '0';
      if (displayW) outer.style.width = `${displayW}px`;
    }

    return () => {
      reset();
    };
  }, [wrap, wrapAlign, marginPx, displayW, isLayer, isDragging]);

  const imgStyle = {
    width: displayW ? `${displayW}px` : undefined,
    height: displayH ? `${displayH}px` : 'auto',
    maxWidth: isLayer ? 'none' : '100%',
    opacity: displayOpacity,
  };

  const layerZ = selected ? 8 : wrap === 'front' ? 5 : 0;

  const wrapperClass = [
    'doc-image-node',
    wrap,
    wrap === 'wrap' ? `align-${wrapAlign}` : '',
    positionMode === 'fixed' ? 'pos-fixed' : 'pos-flow',
    isLayer ? 'layer' : '',
    repeatOnPages ? 'repeat-pages' : '',
    selected ? 'is-selected' : '',
    isDragging ? 'is-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const wrapperStyle = isLayer
    ? positionMode === 'fixed'
      ? {
          position: 'absolute',
          left: displayOX,
          top: displayOY,
          width: 0,
          height: 0,
          overflow: 'visible',
          zIndex: layerZ,
        }
      : {
          position: 'relative',
          display: 'inline-block',
          width: 0,
          height: 0,
          overflow: 'visible',
          verticalAlign: 'top',
          zIndex: layerZ,
        }
    : {
        display: 'block',
        width: displayW ? `${displayW}px` : wrap === 'break' ? '100%' : undefined,
        maxWidth: '100%',
        lineHeight: 0,
        cursor: editor.isEditable ? (isDragging ? 'grabbing' : 'grab') : undefined,
        zIndex: selected || isDragging ? 4 : undefined,
      };

  const frameStyle = isLayer
    ? {
        position: 'absolute',
        left: positionMode === 'fixed' ? 0 : displayOX,
        top: positionMode === 'fixed' ? 0 : displayOY,
        width: displayW ? `${displayW}px` : undefined,
        zIndex: layerZ,
        overflow: 'visible',
        cursor: editor.isEditable ? (isDragging ? 'grabbing' : 'grab') : 'default',
      }
    : {
        display: wrap === 'break' ? 'inline-block' : 'block',
        width: displayW ? `${displayW}px` : undefined,
        maxWidth: '100%',
        lineHeight: 0,
        cursor: editor.isEditable ? (isDragging ? 'grabbing' : 'grab') : undefined,
      };

  useLayoutEffect(() => {
    if (!repeatOnPages) {
      setPageClones([]);
      setCloneHost(null);
      return undefined;
    }

    const measure = () => {
      const frame = frameRef.current;
      const stack = getPageStack();
      const host = getCloneHost();
      setCloneHost(host);
      if (!frame || !stack || !host) {
        setPageClones([]);
        return;
      }

      const pageH = pageLayoutRef.current?.pageHeight || 1123;
      const gap = pageLayoutRef.current?.gap ?? PAGE_GAP_PX;
      const unit = pageH + gap;
      const paperCount = Math.max(1, document.querySelectorAll('.doc-page-paper').length);

      const stackRect = stack.getBoundingClientRect();
      const fr = frame.getBoundingClientRect();
      const absX = fr.left - stackRect.left;
      const absY = fr.top - stackRect.top;
      const sourcePage = Math.max(0, Math.min(paperCount - 1, Math.floor(absY / unit)));
      const localX = Math.round(absX);
      const localY = Math.round(absY - sourcePage * unit);

      const next = [];
      for (let i = 0; i < paperCount; i++) {
        if (i === sourcePage) continue;
        next.push({
          key: `page-clone-${i}`,
          left: localX,
          top: Math.round(i * unit + localY),
          width: displayW,
          height: displayH,
        });
      }
      setPageClones(next);
    };

    measure();
    const host = getCloneHost();
    const stack = getPageStack();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && stack) ro.observe(stack);
    if (ro && frameRef.current) ro.observe(frameRef.current);
    if (ro && host) ro.observe(host);
    window.addEventListener('resize', measure);
    const mo =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(measure)
        : null;
    if (mo && stack) {
      mo.observe(stack, { childList: true, subtree: false });
    }
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [
    repeatOnPages,
    displayW,
    displayH,
    displayOX,
    displayOY,
    positionMode,
    selected,
    node.attrs.src,
  ]);

  return (
    <NodeViewWrapper
      as="span"
      ref={wrapperRef}
      className={wrapperClass}
      style={wrapperStyle}
      // Always false: we use pointer relocate for wrap/inline/break and offset-drag for layers.
      // Native HTML5 drag is unreliable on floated TipTap node views.
      draggable={false}
      onMouseDown={(e) => {
        if (e.target.closest('.doc-image-handle')) return;
        if (isLayer) {
          startMove(e);
          return;
        }
        startFlowMove(e);
      }}
    >
      <span className="doc-image-frame" ref={frameRef} style={frameStyle}>
        <img
          ref={imgRef}
          src={node.attrs.src}
          alt={node.attrs.alt || ''}
          title={node.attrs.title || ''}
          className="doc-image-el"
          style={imgStyle}
          draggable={false}
          onLoad={onImgLoad}
        />
        {isLayer && !selected && editor.isEditable && (
          <button
            type="button"
            className="doc-image-select-tab"
            title="Select image"
            contentEditable={false}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const pos = typeof getPos === 'function' ? getPos() : null;
              if (typeof pos === 'number') editor.chain().setNodeSelection(pos).run();
            }}
          >
            Select
          </button>
        )}
        {selected && editor.isEditable && (
          <>
            <span className="doc-image-handle nw" onMouseDown={(e) => startResize('nw', e)} />
            <span className="doc-image-handle ne" onMouseDown={(e) => startResize('ne', e)} />
            <span className="doc-image-handle sw" onMouseDown={(e) => startResize('sw', e)} />
            <span className="doc-image-handle se" onMouseDown={(e) => startResize('se', e)} />
          </>
        )}
      </span>

      {repeatOnPages &&
        cloneHost &&
        pageClones.length > 0 &&
        createPortal(
          pageClones.map((c) => (
            <span
              key={c.key}
              className="doc-image-page-clone"
              style={{
                left: c.left,
                top: c.top,
                width: c.width ? `${c.width}px` : undefined,
                height: c.height ? `${c.height}px` : undefined,
              }}
            >
              <img
                src={node.attrs.src}
                alt=""
                draggable={false}
                style={{
                  width: c.width ? `${c.width}px` : undefined,
                  height: c.height ? `${c.height}px` : 'auto',
                  opacity: displayOpacity,
                }}
              />
            </span>
          )),
          cloneHost
        )}
    </NodeViewWrapper>
  );
}
