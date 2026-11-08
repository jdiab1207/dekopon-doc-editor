import { domToBlob } from 'modern-screenshot';
import { PDFDocument } from 'pdf-lib';
import { PAGE_GAP_PX } from '../editor/pageGaps';

/** CSS px at 96dpi → PDF points (72dpi). */
const PX_TO_PT = 72 / 96;

const MAX_CANVAS_EDGE = 16384;

function downloadBlob(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function shouldOmitNode(node) {
  if (!(node instanceof Element)) return false;
  const cls = node.classList;
  if (!cls) return false;
  return (
    cls.contains('doc-image-handle') ||
    cls.contains('doc-image-select-tab') ||
    cls.contains('selection-ai-bubble') ||
    cls.contains('image-bubble') ||
    cls.contains('table-bubble') ||
    cls.contains('page-chrome-unsync') ||
    cls.contains('page-chrome-placeholder') ||
    cls.contains('tippy-box')
  );
}

export function exportErrMessage(err) {
  if (!err) return 'Unknown export error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  return String(err);
}

function yieldToUi() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

function pickScale(pageWidth, pageHeight, preferred = 2) {
  const maxDim = Math.max(pageWidth, pageHeight);
  let scale = preferred;
  while (scale > 1 && maxDim * scale > MAX_CANVAS_EDGE) {
    scale -= 0.25;
  }
  return Math.max(1, scale);
}

function readStackHeight(stackEl, fallback) {
  const px = parseFloat(stackEl.style.height || '');
  if (Number.isFinite(px) && px > 0) return px;
  const rect = stackEl.getBoundingClientRect();
  if (rect.height > 0) return rect.height;
  return fallback;
}

/**
 * Move the live stack into a fixed page-sized clip host, shift to the target
 * page, screenshot the host, then put the stack back. Does not shrink the
 * stack's own height (that was breaking pages 2+ via layout/observers).
 */
async function capturePageSlice({
  stackEl,
  pageWidth,
  pageHeight,
  stackH,
  offsetY,
  scale,
  bg,
}) {
  const parent = stackEl.parentElement;
  if (!parent) throw new Error('Page stack has no parent');

  const placeholder = document.createComment('pdf-capture-placeholder');
  parent.insertBefore(placeholder, stackEl);

  const clip = document.createElement('div');
  clip.setAttribute('data-pdf-capture-clip', 'true');
  Object.assign(clip.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${pageWidth}px`,
    height: `${pageHeight}px`,
    overflow: 'hidden',
    background: bg,
    zIndex: '2147483646',
    pointerEvents: 'none',
  });

  const shifter = document.createElement('div');
  Object.assign(shifter.style, {
    position: 'relative',
    width: `${pageWidth}px`,
    height: `${stackH}px`,
    transform: `translateY(-${offsetY}px)`,
    transformOrigin: 'top left',
  });

  shifter.appendChild(stackEl);
  clip.appendChild(shifter);
  document.body.appendChild(clip);

  try {
    void clip.offsetHeight;
    await new Promise((r) => requestAnimationFrame(r));

    const blob = await domToBlob(clip, {
      width: pageWidth,
      height: pageHeight,
      scale,
      backgroundColor: bg,
      font: false,
      filter: (node) => !shouldOmitNode(node),
    });

    if (!blob || blob.size < 32) {
      throw new Error('empty page image');
    }
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    // Put the stack back exactly where React expects it.
    parent.insertBefore(stackEl, placeholder);
    placeholder.remove();
    clip.remove();
  }
}

/**
 * Capture the live paginated editor into a multi-page PDF (WYSIWYG).
 */
export async function captureEditorPdf({
  stackEl,
  pageWidth,
  pageHeight,
  pageCount,
  gap = PAGE_GAP_PX,
  filename = 'document.pdf',
  scale: preferredScale = 1.5,
  onProgress,
}) {
  if (!stackEl) throw new Error('Editor page stack not found');

  const papers = stackEl.querySelectorAll('.doc-page-paper');
  const count = Math.max(1, pageCount || papers.length || 1);
  const stackH = readStackHeight(
    stackEl,
    count * pageHeight + Math.max(0, count - 1) * gap
  );
  const bg =
    getComputedStyle(papers[0] || stackEl).backgroundColor ||
    stackEl.style.background ||
    '#ffffff';
  const scale = pickScale(pageWidth, pageHeight, preferredScale);

  document.documentElement.classList.add('exporting-pdf');
  // Freeze scroll so moving the stack doesn't jump the viewport oddly.
  const wrap = stackEl.closest('.doc-canvas-wrap');
  const prevOverflow = wrap?.style.overflow;
  if (wrap) wrap.style.overflow = 'hidden';

  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const pdf = await PDFDocument.create();
    const pageWpt = pageWidth * PX_TO_PT;
    const pageHpt = pageHeight * PX_TO_PT;
    const pngPages = [];

    // Capture all pages first (no React progress setState between DOM moves).
    for (let i = 0; i < count; i++) {
      onProgress?.(i + 1, count);
      const offsetY = i * (pageHeight + gap);
      try {
        const bytes = await capturePageSlice({
          stackEl,
          pageWidth,
          pageHeight,
          stackH,
          offsetY,
          scale,
          bg,
        });
        pngPages.push(bytes);
      } catch (e) {
        throw new Error(`Page ${i + 1} of ${count} failed: ${exportErrMessage(e)}`);
      }
      await yieldToUi();
    }

    for (const pngBytes of pngPages) {
      const image = await pdf.embedPng(pngBytes);
      const page = pdf.addPage([pageWpt, pageHpt]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: pageWpt,
        height: pageHpt,
      });
    }

    const bytes = await pdf.save();
    downloadBlob(bytes, filename, 'application/pdf');
  } finally {
    if (wrap) wrap.style.overflow = prevOverflow || '';
    document.documentElement.classList.remove('exporting-pdf');
  }
}

export function safePdfFilename(title) {
  const base = String(title || 'document')
    .replace(/[^\w\s\-]+/g, '')
    .trim();
  return `${base || 'document'}.pdf`;
}
