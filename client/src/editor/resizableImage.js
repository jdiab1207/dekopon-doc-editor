import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import ResizableImageView from '../components/ResizableImageView';

/** 96dpi: 1 inch = 96px (matches editor paper math). */
export const INCH = 96;

export const IMAGE_MARGIN_OPTIONS = [
  { label: '0″', inches: 0 },
  { label: '⅛″', inches: 0.125 },
  { label: '¼″', inches: 0.25 },
  { label: '⅜″', inches: 0.375 },
  { label: '½″', inches: 0.5 },
  { label: '¾″', inches: 0.75 },
  { label: '1″', inches: 1 },
];

function normalizeWrap(raw) {
  if (!raw || raw === 'inline') return 'inline';
  if (raw === 'wrap-left' || raw === 'wrap-right') return 'wrap';
  if (raw === 'wrap' || raw === 'break' || raw === 'behind' || raw === 'front') return raw;
  return 'inline';
}

function imagePosFromDom(view, el) {
  const root = el.closest?.('.doc-image-nodeview') || el.closest?.('.doc-image-node') || el;
  if (!root || !view.dom.contains(root)) return null;
  try {
    const pos = view.posAtDOM(root, 0);
    for (const p of [pos, Math.max(0, pos - 1), pos + 1]) {
      if (p < 0 || p > view.state.doc.content.size) continue;
      if (view.state.doc.nodeAt(p)?.type.name === 'image') return p;
    }
    const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
    if ($pos.nodeAfter?.type.name === 'image') return $pos.pos;
    if ($pos.nodeBefore?.type.name === 'image') {
      return $pos.pos - $pos.nodeBefore.nodeSize;
    }
  } catch {
    /* ignore */
  }
  return null;
}

const imageHitKey = new PluginKey('imageLayerHitTest');

/** Select behind/front images even when text sits on top of them. */
function imageLayerHitTestPlugin() {
  return new Plugin({
    key: imageHitKey,
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (event.button !== 0) return false;
          if (event.target.closest?.('.doc-image-select-tab')) return false;
          if (event.target.closest?.('.doc-image-handle')) return false;
          // Direct clicks on an image are handled by the React node view (select + drag).
          if (event.target.closest?.('.doc-image-node, .doc-image-nodeview')) {
            return false;
          }

          const { clientX: x, clientY: y } = event;
          const candidates = view.dom.querySelectorAll(
            '.doc-image-node.behind, .doc-image-node.front'
          );
          let best = null;
          let bestZ = -Infinity;
          candidates.forEach((el) => {
            const frame = el.querySelector('.doc-image-frame') || el;
            const r = frame.getBoundingClientRect();
            if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
            const z = Number(el.style.zIndex || (el.classList.contains('front') ? 5 : 0));
            if (!best || z >= bestZ) {
              best = el;
              bestZ = z;
            }
          });
          if (!best) return false;
          // Prefer front over behind when both overlap
          if (
            best.classList.contains('behind') &&
            event.target.closest?.('.doc-image-node.front')
          ) {
            return false;
          }

          const pos = imagePosFromDom(view, best);
          if (pos == null) return false;
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
          event.preventDefault();
          // Click-through text on a layered image: start drag in the same gesture.
          best.dispatchEvent(
            new CustomEvent('doc-image-layer-drag', {
              bubbles: true,
              detail: { clientX: x, clientY: y },
            })
          );
          return true;
        },
      },
    },
  });
}

/**
 * Google Docs–style image node: wrap presets, margin, move-with-text / fixed.
 */
export const ResizableImage = Image.extend({
  name: 'image',
  // Keep true for schema; node view sets draggable={false} and uses pointer drag instead
  // because HTML5 drag breaks on floated React node views.
  draggable: true,
  // Avoid <em>/<span mark> wrappers around images (breaks float + import).
  marks: '',

  parseHTML() {
    return [
      {
        tag: 'img[src]',
      },
    ];
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const w = el.getAttribute('width') || el.style.width;
          if (!w) return null;
          const n = parseInt(String(w), 10);
          return Number.isFinite(n) ? n : null;
        },
        renderHTML: (attrs) => (attrs.width ? { width: String(attrs.width) } : {}),
      },
      height: {
        default: null,
        parseHTML: (el) => {
          const h = el.getAttribute('height') || el.style.height;
          if (!h) return null;
          const n = parseInt(String(h), 10);
          return Number.isFinite(n) ? n : null;
        },
        renderHTML: (attrs) => (attrs.height ? { height: String(attrs.height) } : {}),
      },
      wrap: {
        default: 'inline',
        parseHTML: (el) => {
          const data = el.getAttribute('data-wrap');
          if (data) return normalizeWrap(data);
          const cls = el.getAttribute('class') || '';
          if (cls.includes('wrap-left') || cls.includes('wrap-right') || /\bwrap\b/.test(cls)) {
            return 'wrap';
          }
          if (cls.includes('break')) return 'break';
          if (cls.includes('behind')) return 'behind';
          if (cls.includes('front')) return 'front';
          return 'inline';
        },
        renderHTML: (attrs) => ({ 'data-wrap': normalizeWrap(attrs.wrap) }),
      },
      /** left | right — used by Wrap text */
      wrapAlign: {
        default: 'left',
        parseHTML: (el) => {
          const data = el.getAttribute('data-wrap-align');
          if (data === 'right' || data === 'left') return data;
          const cls = el.getAttribute('class') || '';
          if (cls.includes('wrap-right')) return 'right';
          return 'left';
        },
        renderHTML: (attrs) => ({ 'data-wrap-align': attrs.wrapAlign || 'left' }),
      },
      /** Margin between image and text, in inches */
      marginIn: {
        default: 0.125,
        parseHTML: (el) => {
          const data = el.getAttribute('data-margin-in');
          if (data != null && data !== '') {
            const n = parseFloat(data);
            return Number.isFinite(n) ? n : 0.125;
          }
          return 0.125;
        },
        renderHTML: (attrs) => ({
          'data-margin-in': String(attrs.marginIn ?? 0.125),
        }),
      },
      /** move-with-text | fixed */
      positionMode: {
        default: 'move-with-text',
        parseHTML: (el) => {
          const data = el.getAttribute('data-position');
          return data === 'fixed' ? 'fixed' : 'move-with-text';
        },
        renderHTML: (attrs) => ({
          'data-position': attrs.positionMode || 'move-with-text',
        }),
      },
      offsetX: {
        default: 0,
        parseHTML: (el) => {
          const n = parseInt(el.getAttribute('data-offset-x') || '0', 10);
          return Number.isFinite(n) ? n : 0;
        },
        renderHTML: (attrs) => ({ 'data-offset-x': String(attrs.offsetX || 0) }),
      },
      offsetY: {
        default: 0,
        parseHTML: (el) => {
          const n = parseInt(el.getAttribute('data-offset-y') || '0', 10);
          return Number.isFinite(n) ? n : 0;
        },
        renderHTML: (attrs) => ({ 'data-offset-y': String(attrs.offsetY || 0) }),
      },
      opacity: {
        default: null,
        parseHTML: (el) => {
          const o = el.getAttribute('data-opacity');
          if (o == null || o === '') {
            // Legacy inline style only (avoid treating missing as 100%)
            const styleOp = el.style?.opacity;
            if (styleOp == null || styleOp === '') return null;
            const n = parseFloat(styleOp);
            return Number.isFinite(n) ? n : null;
          }
          const n = parseFloat(o);
          return Number.isFinite(n) ? n : null;
        },
        renderHTML: (attrs) => {
          if (attrs.opacity == null) return {};
          return { 'data-opacity': String(attrs.opacity) };
        },
      },
      /** Behind-text images: paint the same page-local placement on every sheet */
      repeatOnPages: {
        default: false,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-repeat-on-pages');
          return raw === 'true' || raw === '' || raw === '1';
        },
        renderHTML: (attrs) =>
          attrs.repeatOnPages ? { 'data-repeat-on-pages': 'true' } : {},
      },
      class: {
        default: null,
        parseHTML: (el) => el.getAttribute('class'),
        renderHTML: () => ({}),
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const wrap = normalizeWrap(node.attrs.wrap);
    const styles = [];
    if (node.attrs.width) styles.push(`width: ${node.attrs.width}px`);
    if (node.attrs.height) styles.push(`height: ${node.attrs.height}px`);
    if (node.attrs.opacity != null) {
      styles.push(`opacity: ${node.attrs.opacity}`);
    } else if (wrap === 'behind') {
      styles.push('opacity: 0.5');
    }
    const marginPx = Math.round((node.attrs.marginIn ?? 0.125) * INCH);
    if (wrap === 'wrap') {
      const align = node.attrs.wrapAlign === 'right' ? 'right' : 'left';
      styles.push(`float: ${align}`);
      styles.push(
        align === 'right'
          ? `margin: ${marginPx}px 0 ${marginPx}px ${marginPx}px`
          : `margin: ${marginPx}px ${marginPx}px ${marginPx}px 0`
      );
    }
    if (wrap === 'break') {
      styles.push('display: block');
      styles.push(`margin: ${marginPx}px auto`);
    }

    const attrs = { ...HTMLAttributes };
    if (styles.length) {
      attrs.style = [HTMLAttributes.style, styles.join('; ')].filter(Boolean).join('; ');
    }
    attrs['data-wrap'] = wrap;
    attrs['data-wrap-align'] = node.attrs.wrapAlign || 'left';
    attrs['data-margin-in'] = String(node.attrs.marginIn ?? 0.125);
    attrs['data-position'] = node.attrs.positionMode || 'move-with-text';
    attrs['data-offset-x'] = String(node.attrs.offsetX || 0);
    attrs['data-offset-y'] = String(node.attrs.offsetY || 0);
    if (node.attrs.repeatOnPages && wrap === 'behind') {
      attrs['data-repeat-on-pages'] = 'true';
    }
    attrs.class = [HTMLAttributes.class, wrap === 'inline' ? null : wrap].filter(Boolean).join(' ') || undefined;
    if (node.attrs.width) attrs.width = String(node.attrs.width);
    if (node.attrs.height) attrs.height = String(node.attrs.height);
    return ['img', attrs];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView, {
      className: 'doc-image-nodeview',
    });
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() || []), imageLayerHitTestPlugin()];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImageWrap:
        (wrap) =>
        ({ commands, editor }) => {
          const next = normalizeWrap(wrap);
          const patch = { wrap: next };
          if (next === 'inline') {
            patch.positionMode = 'move-with-text';
            patch.offsetX = 0;
            patch.offsetY = 0;
            patch.repeatOnPages = false;
          }
          if (next === 'wrap' || next === 'break') {
            patch.positionMode = 'move-with-text';
            patch.offsetX = 0;
            patch.offsetY = 0;
            patch.repeatOnPages = false;
          }
          if (next === 'wrap') {
            const attrs = editor.getAttributes(this.name);
            if (!attrs.width) {
              patch.width = 240;
            }
            if (!attrs.wrapAlign) {
              patch.wrapAlign = 'left';
            }
          }
          if (next === 'front') {
            patch.repeatOnPages = false;
          }
          // Snapshot size when entering layer modes so the image can't collapse to 0×0
          if (next === 'behind' || next === 'front') {
            const attrs = editor.getAttributes(this.name);
            if (!attrs.width) {
              patch.width = 240;
            }
          }
          // Behind defaults to 50% opacity so text stays readable; user can change it.
          if (next === 'behind') {
            const attrs = editor.getAttributes(this.name);
            if (attrs.opacity == null) {
              patch.opacity = 0.5;
            }
          }
          return commands.updateAttributes(this.name, patch);
        },
      setImageRepeatOnPages:
        (enabled) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { repeatOnPages: !!enabled }),
      setImageOpacity:
        (value) =>
        ({ commands }) => {
          const n = Number(value);
          const opacity = Number.isFinite(n) ? Math.min(1, Math.max(0.05, n)) : 0.5;
          return commands.updateAttributes(this.name, { opacity });
        },
      setImageMarginIn:
        (inches) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { marginIn: inches }),
      setImagePositionMode:
        (mode) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, {
            positionMode: mode === 'fixed' ? 'fixed' : 'move-with-text',
          }),
      setImageWrapAlign:
        (align) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, {
            wrapAlign: align === 'right' ? 'right' : 'left',
          }),
      resetImageSize:
        () =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { width: null, height: null }),
    };
  },
}).configure({
  inline: true,
  allowBase64: true,
});
