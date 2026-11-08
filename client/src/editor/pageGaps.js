import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const PAGE_GAP_PX = 40;

/**
 * Live layout config for pagination.
 * Content box height = pageHeight - marginTop - marginBottom (Word/Docs model).
 */
export const pageLayoutRef = {
  current: {
    enabled: true,
    pageHeight: 1123,
    gap: PAGE_GAP_PX,
    marginTop: 76,
    marginBottom: 76,
    marginLeft: 76,
    marginRight: 76,
    /** When > Date.now(), pagination refresh is deferred (image drag/opacity). */
    pauseUntil: 0,
  },
};

/** Pause soft page-break recalculation briefly (e.g. while resizing an image). */
export function pausePageGaps(ms = 600) {
  const until = Date.now() + ms;
  if (until > (pageLayoutRef.current.pauseUntil || 0)) {
    pageLayoutRef.current.pauseUntil = until;
  }
}

export function isPageGapsPaused() {
  return Date.now() < (pageLayoutRef.current.pauseUntil || 0);
}

const pageGapsKey = new PluginKey('pageGaps');

/** Total height of page-gap widgets whose bottom is above clientY. */
function gapHeightAbove(view, clientY) {
  let total = 0;
  view.dom.querySelectorAll('.editor-page-gap').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.bottom <= clientY + 0.5) total += el.offsetHeight;
  });
  return total;
}

/**
 * Y of a node in "content space" (page-gap spacers subtracted),
 * so packing is stable and independent of existing decorations.
 */
function contentY(view, pos) {
  try {
    const dom = view.nodeDOM(pos);
    if (!dom || dom.nodeType !== 1) return null;
    const origin = view.dom.getBoundingClientRect().top;
    const top = dom.getBoundingClientRect().top;
    const raw = top - origin + (view.dom.scrollTop || 0);
    return raw - gapHeightAbove(view, top);
  } catch {
    return null;
  }
}

function contentBottom(view, pos) {
  try {
    const dom = view.nodeDOM(pos);
    if (!dom || dom.nodeType !== 1) return null;
    const origin = view.dom.getBoundingClientRect().top;
    const rect = dom.getBoundingClientRect();
    const raw = rect.bottom - origin + (view.dom.scrollTop || 0);
    return raw - gapHeightAbove(view, rect.top);
  } catch {
    return null;
  }
}

function isListNode(node) {
  return node?.type?.name === 'bulletList' || node?.type?.name === 'orderedList';
}

/**
 * Soft-break inside lists the same way we break table rows: prefer list items,
 * and when a list item wraps a nested list (common in contracts), descend so
 * nested items can land on the next page instead of overflowing the sheet.
 */
function collectListBreakUnits(listNode, listPos, raw) {
  listNode.forEach((item, itemOffset) => {
    if (item.type.name !== 'listItem') return;
    const itemPos = listPos + 1 + itemOffset;

    let nested = false;
    item.forEach((child) => {
      if (isListNode(child)) nested = true;
    });

    // Simple items stay atomic so the marker stays with the paragraph.
    if (!nested && item.childCount <= 1) {
      raw.push({ pos: itemPos, kind: 'block' });
      return;
    }

    item.forEach((child, childOffset) => {
      const childPos = itemPos + 1 + childOffset;
      if (isListNode(child)) {
        collectListBreakUnits(child, childPos, raw);
      } else {
        raw.push({ pos: childPos, kind: 'block' });
      }
    });
  });
}

/**
 * Break units = top-level blocks, list items (incl. nested), or table rows
 * (never mid-cell / mid-paragraph). Height includes inter-block margins by
 * using content-space Y deltas.
 */
function collectBreakUnits(view) {
  const { doc } = view.state;
  const raw = [];

  doc.forEach((node, pos) => {
    if (node.type.name === 'table') {
      node.forEach((row, rowOffset) => {
        if (row.type.name !== 'tableRow') return;
        const rowPos = pos + 1 + rowOffset;
        raw.push({
          pos: rowPos,
          kind: 'row',
          colSpan: Math.max(1, row.childCount),
        });
      });
      return;
    }

    if (isListNode(node)) {
      collectListBreakUnits(node, pos, raw);
      return;
    }

    if (node.type.name === 'pageBreak') {
      raw.push({ pos, kind: 'hard' });
      return;
    }

    raw.push({ pos, kind: 'block' });
  });

  const units = raw.map((u) => {
    const y = contentY(view, u.pos);
    const bottom = contentBottom(view, u.pos);
    return {
      ...u,
      y: y ?? 0,
      bottom: bottom ?? (y ?? 0) + 1,
    };
  });

  for (let i = 0; i < units.length; i += 1) {
    if (units[i].kind === 'hard') {
      units[i].height = 0;
      continue;
    }
    // Prefer delta to next unit — captures collapsed margins between siblings.
    if (i + 1 < units.length && units[i + 1].y > units[i].y) {
      units[i].height = Math.max(1, units[i + 1].y - units[i].y);
    } else {
      units[i].height = Math.max(1, units[i].bottom - units[i].y);
    }
  }

  return units;
}

/** Expand a gap spacer to the full paper content width, even when nested in lists. */
function applyPageBleed(el, marginLeft, marginRight) {
  let applied = false;
  const sync = () => {
    if (applied) return;
    const pm = el.closest?.('.ProseMirror');
    if (!pm || !el.isConnected) return;
    // Measure from the un-bled box so a second pass can't collapse list indent.
    el.style.marginLeft = '0px';
    el.style.marginRight = '0px';
    el.style.width = '100%';
    const pmRect = pm.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const leftExtra = Math.max(0, Math.round(elRect.left - pmRect.left));
    const rightExtra = Math.max(0, Math.round(pmRect.right - elRect.right));
    el.style.marginLeft = `-${leftExtra + marginLeft}px`;
    el.style.marginRight = `-${rightExtra + marginRight}px`;
    el.style.width = `calc(100% + ${leftExtra + rightExtra + marginLeft + marginRight}px)`;
    applied = true;
  };
  sync();
  if (!applied) requestAnimationFrame(sync);
}

function buildGapWidget({
  spacerHeight,
  remaining,
  marginTop,
  marginBottom,
  gap,
  marginLeft,
  marginRight,
  asTableRow,
  colSpan,
  pageNum,
}) {
  const gapInner = () => {
    const wrap = document.createElement('div');
    wrap.className = 'editor-page-gap';
    wrap.style.height = `${spacerHeight}px`;

    // Fill rest of current page (into bottom margin). Transparent — paper shows through.
    const tail = document.createElement('div');
    tail.className = 'editor-page-gap-tail';
    tail.style.height = `${Math.max(0, remaining + marginBottom)}px`;

    // Only the inter-sheet gutter (aligns with stacked paper gap). No label —
    // page numbers live in the footer; a mid-page "Page 2" bar looked like a bug.
    const chrome = document.createElement('div');
    chrome.className = 'editor-page-gap-chrome';
    chrome.style.height = `${gap}px`;

    // Top margin of the next sheet.
    const head = document.createElement('div');
    head.className = 'editor-page-gap-head';
    head.style.height = `${marginTop}px`;

    wrap.appendChild(tail);
    wrap.appendChild(chrome);
    wrap.appendChild(head);
    return wrap;
  };

  if (asTableRow) {
    const tr = document.createElement('tr');
    tr.className = 'editor-page-gap-row';
    tr.contentEditable = 'false';
    tr.dataset.pageBreak = String(pageNum);
    const td = document.createElement('td');
    td.colSpan = colSpan;
    td.style.padding = '0';
    td.style.border = 'none';
    const inner = gapInner();
    // Tables already span the content box; only bleed into page margins.
    inner.style.marginLeft = `-${marginLeft}px`;
    inner.style.marginRight = `-${marginRight}px`;
    inner.style.width = `calc(100% + ${marginLeft + marginRight}px)`;
    td.appendChild(inner);
    tr.appendChild(td);
    return tr;
  }

  const el = gapInner();
  el.contentEditable = 'false';
  el.dataset.pageBreak = String(pageNum);
  // Nested lists indent the widget — bleed out to the full paper content edge.
  applyPageBleed(el, marginLeft, marginRight);
  return el;
}

function buildGapDecorations(view) {
  const cfg = pageLayoutRef.current;
  if (!cfg?.enabled || !view?.dom) {
    return DecorationSet.empty;
  }

  const pageHeight = cfg.pageHeight || 1123;
  const gap = cfg.gap ?? PAGE_GAP_PX;
  const marginTop = cfg.marginTop ?? 76;
  const marginBottom = cfg.marginBottom ?? 76;
  const marginLeft = cfg.marginLeft ?? 76;
  const marginRight = cfg.marginRight ?? 76;

  const contentHeight = Math.max(120, pageHeight - marginTop - marginBottom);
  const pageChrome = marginBottom + gap + marginTop;

  const units = collectBreakUnits(view);
  if (!units.length) return DecorationSet.empty;

  const decos = [];
  let pageUsed = 0;
  let pageIndex = 1;
  // Long list-heavy contracts (e.g. creator agreements) need more soft breaks
  // once list items are packable units.
  const maxBreaks = 120;

  const pushBreak = (atPos, remaining, unit) => {
    if (decos.length >= maxBreaks) return false;
    const spacerHeight = Math.max(gap, remaining + pageChrome);
    const pageNum = pageIndex;
    // Round remaining so tiny float error doesn't drift chrome into page 2.
    const rem = Math.max(0, Math.round(remaining));

    decos.push(
      Decoration.widget(
        atPos,
        () =>
          buildGapWidget({
            spacerHeight: Math.max(gap, rem + pageChrome),
            remaining: rem,
            marginTop,
            marginBottom,
            gap,
            marginLeft,
            marginRight,
            asTableRow: unit?.kind === 'row',
            colSpan: unit?.colSpan || 1,
            pageNum,
          }),
        { side: -1, key: `page-gap-${pageNum}-${atPos}-${rem}` }
      )
    );
    pageIndex += 1;
    return true;
  };

  for (const unit of units) {
    if (unit.kind === 'hard') {
      const remaining = Math.max(0, contentHeight - pageUsed);
      if (!pushBreak(unit.pos, remaining, unit)) break;
      pageUsed = 0;
      continue;
    }

    if (pageUsed > 0 && pageUsed + unit.height > contentHeight + 0.5) {
      const remaining = Math.max(0, contentHeight - pageUsed);
      if (!pushBreak(unit.pos, remaining, unit)) break;
      pageUsed = 0;
    }

    pageUsed += unit.height;

    if (unit.height > contentHeight) {
      pageUsed = contentHeight;
    } else if (pageUsed > contentHeight) {
      pageUsed = contentHeight;
    }
  }

  return DecorationSet.create(view.state.doc, decos);
}

function decoSignature(decos) {
  return decos
    .find()
    .map((d) => d.spec?.key || `${d.from}`)
    .join('|');
}

/**
 * Word/Docs-style soft pagination:
 * pack blocks (and table rows) into fixed page content boxes; insert spacers
 * so the next block starts at the top content edge of the next sheet.
 */
export const PageGaps = Extension.create({
  name: 'pageGaps',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pageGapsKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const next = tr.getMeta(pageGapsKey);
            if (next !== undefined) return next;
            if (tr.docChanged) return old.map(tr.mapping, tr.doc);
            return old;
          },
        },
        props: {
          decorations(state) {
            return pageGapsKey.getState(state);
          },
        },
        view(editorView) {
          let timer = null;
          let lastSig = '';
          let disposed = false;

          const refresh = () => {
            if (disposed || !editorView.dom?.isConnected) return;
            if (isPageGapsPaused()) {
              schedule(120);
              return;
            }
            const decos = buildGapDecorations(editorView);
            const sig = decoSignature(decos);
            if (sig === lastSig) return;
            lastSig = sig;
            const tr = editorView.state.tr.setMeta(pageGapsKey, decos).setMeta('addToHistory', false);
            editorView.dispatch(tr);
          };

          const schedule = (delay = 220) => {
            clearTimeout(timer);
            timer = setTimeout(refresh, delay);
          };

          requestAnimationFrame(() => {
            requestAnimationFrame(() => schedule(80));
          });

          return {
            update(view, prevState) {
              if (prevState.doc !== view.state.doc) {
                // Attribute-only image tweaks still change the doc; debounce longer
                // so soft page breaks don't thrash while dragging/resizing.
                schedule(isPageGapsPaused() ? 400 : 220);
              }
            },
            destroy() {
              disposed = true;
              clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});

export function refreshPageGaps(editor) {
  if (!editor?.view) return;
  const decos = buildGapDecorations(editor.view);
  const tr = editor.view.state.tr.setMeta(pageGapsKey, decos).setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}
