import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { convert as htmlToText } from 'html-to-text';
import HTMLtoDOCX from 'html-to-docx';
import JSZip from 'jszip';
import puppeteer from 'puppeteer';
import { readDocHtml, readDocMeta, DOCS_DIR } from './library.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

/** Match client EditorPage PAPER dims (96dpi CSS px) for viewport only. */
const PAPER_PX = {
  a4: { portrait: { width: 794, height: 1123 }, landscape: { width: 1123, height: 794 } },
  letter: { portrait: { width: 816, height: 1056 }, landscape: { width: 1056, height: 816 } },
};

const SYSTEM_CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

async function launchPdfBrowser() {
  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
  try {
    return await puppeteer.launch({ headless: true, args });
  } catch (firstErr) {
    for (const exe of SYSTEM_CHROME_CANDIDATES) {
      if (!exe || !fs.existsSync(exe)) continue;
      try {
        return await puppeteer.launch({ headless: true, args, executablePath: exe });
      } catch {
        /* try next */
      }
    }
    throw Object.assign(
      new Error(
        `${firstErr.message}\n\nInstall Chrome for PDF export with: npx puppeteer browsers install chrome`
      ),
      { status: 500 }
    );
  }
}

function normalizeMargins(pageSetup = {}) {
  const d = { top: 76, right: 76, bottom: 76, left: 76 };
  const m = pageSetup.margins || {};
  return {
    top: m.top ?? d.top,
    right: m.right ?? d.right,
    bottom: m.bottom ?? d.bottom,
    left: m.left ?? d.left,
  };
}

/**
 * Ensure data-bg / data-* cell attrs become real inline styles for print engines
 * that ignore unknown attributes.
 */
function promoteTableCellStyles(html) {
  return String(html).replace(/<(td|th)(\s[^>]*?)>/gi, (full, tag, rawAttrs) => {
    const attrs = rawAttrs || '';
    const styles = [];
    const existing = /style\s*=\s*"([^"]*)"/i.exec(attrs);
    if (existing?.[1]) styles.push(existing[1].replace(/;?\s*$/, ''));

    const take = (name, cssProp) => {
      const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i');
      const m = re.exec(attrs);
      if (!m?.[1]) return;
      const val = m[1];
      if (cssProp === 'background-color' && !/background-color\s*:/i.test(styles.join(';'))) {
        styles.push(`background-color: ${val}`);
      }
      if (cssProp === 'border-color' && !/border-color\s*:/i.test(styles.join(';'))) {
        styles.push(`border-color: ${val}`);
      }
      if (cssProp === 'border-width' && !/border-width\s*:/i.test(styles.join(';'))) {
        styles.push(`border-width: ${val}`);
        if (!/border-style\s*:/i.test(styles.join(';'))) styles.push('border-style: solid');
      }
      if (cssProp === 'padding' && !/padding\s*:/i.test(styles.join(';'))) {
        styles.push(`padding: ${val}`);
      }
      if (cssProp === 'vertical-align' && !/vertical-align\s*:/i.test(styles.join(';'))) {
        styles.push(`vertical-align: ${val}`);
      }
    };

    take('data-bg', 'background-color');
    take('data-border-color', 'border-color');
    take('data-border-width', 'border-width');
    take('data-padding', 'padding');
    take('data-valign', 'vertical-align');

    const colwidth = /colwidth\s*=\s*"([^"]*)"/i.exec(attrs);
    if (colwidth?.[1] && !/width\s*:/i.test(styles.join(';'))) {
      const w = parseInt(colwidth[1].split(',')[0], 10);
      if (w > 0) styles.push(`width: ${w}px`);
    }

    if (!styles.length) return full;

    const styleValue = styles.filter(Boolean).join('; ');
    let next = attrs;
    if (existing) {
      next = next.replace(/style\s*=\s*"[^"]*"/i, `style="${styleValue}"`);
    } else {
      next = `${next} style="${styleValue}"`;
    }
    return `<${tag}${next}>`;
  });
}

/**
 * Export stylesheet mirrored from client editor.css so PDF ≈ on-screen layout.
 */
function editorMatchedStyles(pageSetup = {}) {
  const bg = pageSetup.backgroundColor || '#ffffff';
  const margins = normalizeMargins(pageSetup);
  const sizeKey = pageSetup.paperSize === 'letter' ? 'Letter' : 'A4';
  const orient = pageSetup.orientation === 'landscape' ? 'landscape' : 'portrait';

  return `
    @page {
      size: ${sizeKey} ${orient};
      margin: ${margins.top}px ${margins.right}px ${margins.bottom}px ${margins.left}px;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: ${bg};
    }
    body {
      font-family: Georgia, "Times New Roman", "Literata", "Source Serif 4", serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1c1e;
      background: ${bg};
      position: relative;
    }
    h1 { font-size: 26pt; font-weight: 600; margin: 0.4em 0; }
    h2 { font-size: 20pt; font-weight: 600; margin: 0.4em 0; }
    h3 { font-size: 16pt; font-weight: 600; margin: 0.4em 0; }
    h4 { font-size: 14pt; font-weight: 600; margin: 0.35em 0; }
    h5 { font-size: 12pt; font-weight: 600; margin: 0.35em 0; }
    h6 { font-size: 11pt; font-weight: 600; margin: 0.35em 0; color: #5f6368; }
    p { margin: 0; }
    body > * + * { margin-top: 0.65em; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 12px 0;
      table-layout: fixed;
      overflow: hidden;
    }
    col { box-sizing: border-box; }
    td, th {
      border: 1px solid #c9d0d6;
      padding: 8px 10px;
      vertical-align: top;
      min-width: 48px;
      word-wrap: break-word;
    }
    th {
      background-color: #f1f3f4;
      font-weight: 600;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    /* Keep authored pixel sizes for layered / explicitly sized images */
    img[width],
    img[data-wrap="behind"],
    img[data-wrap="front"],
    img.pdf-layer-img {
      max-width: none !important;
    }
    img.wrap-left,
    img[data-wrap="wrap"][data-wrap-align="left"],
    img.wrap[data-wrap-align="left"] { float: left; margin: 12px 12px 12px 0; }
    img.wrap-right,
    img[data-wrap="wrap"][data-wrap-align="right"] { float: right; margin: 12px 0 12px 12px; }
    img.break,
    img[data-wrap="break"] { display: block; margin: 12px auto; clear: both; }
    img.behind,
    img[data-wrap="behind"] { /* opacity set inline to match editor */ }
    img.front,
    img[data-wrap="front"] { position: relative; z-index: 2; }
    img.pdf-layer-img {
      position: absolute !important;
      z-index: 0;
      pointer-events: none;
      margin: 0 !important;
      float: none !important;
    }
    img.pdf-layer-img.pdf-front {
      z-index: 2;
    }
    .pdf-flow {
      position: relative;
      z-index: 1;
    }
    hr.doc-hr, hr {
      border: 0;
      border-top: 1px solid #dadce0;
      margin: 12px 0;
    }
    .page-break { page-break-before: always; break-before: page; }
    blockquote {
      border-left: 3px solid #e6a23c;
      margin-left: 0;
      padding-left: 12px;
      color: #3c4043;
    }
    blockquote.footnote {
      font-size: 9pt;
      border-left: 2px solid #dadce0;
      padding-left: 8px;
      color: #5f6368;
    }
    ul, ol { padding-left: 1.4em; }
  `;
}

function getHtmlAttr(attrs, name) {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i');
  const m = re.exec(attrs);
  return m ? m[1] : '';
}

function readStylePx(style, prop) {
  if (!style) return null;
  const re = new RegExp(`${prop}\\s*:\\s*([\\d.]+)px`, 'i');
  const m = re.exec(style);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Lightweight print prep for server-side PDF fallback (pageless / API).
 * Paginated WYSIWYG PDF is captured from the live editor on the client.
 */
export function prepareHtmlForPdf(html) {
  let flow = String(html).replace(/<img\b([^>]*)>/gi, (full, rawAttrs) => {
    const attrs = rawAttrs || '';
    const wrap = getHtmlAttr(attrs, 'data-wrap') || '';
    const src = getHtmlAttr(attrs, 'src');
    if (!src) return full;

    const style = getHtmlAttr(attrs, 'style');
    const width =
      readStylePx(style, 'width') ||
      parseInt(getHtmlAttr(attrs, 'width') || '', 10) ||
      null;
    const height =
      readStylePx(style, 'height') ||
      parseInt(getHtmlAttr(attrs, 'height') || '', 10) ||
      null;
    const ox = parseInt(getHtmlAttr(attrs, 'data-offset-x') || '0', 10) || 0;
    const oy = parseInt(getHtmlAttr(attrs, 'data-offset-y') || '0', 10) || 0;
    const alt = getHtmlAttr(attrs, 'alt');
    const opacityAttr = getHtmlAttr(attrs, 'data-opacity');
    const opacity = opacityAttr ? parseFloat(opacityAttr) : null;

    if (wrap === 'behind' || wrap === 'front') {
      const cls = wrap === 'front' ? 'pdf-layer-img pdf-front' : 'pdf-layer-img';
      const op =
        wrap === 'behind'
          ? Number.isFinite(opacity)
            ? Math.min(opacity, 0.5)
            : 0.5
          : Number.isFinite(opacity)
            ? opacity
            : 1;
      const sizeBits = [
        width ? `width: ${width}px` : null,
        height ? `height: ${height}px` : null,
        'max-width: none',
        `left: ${ox}px`,
        `top: ${oy}px`,
        'position: absolute',
        `opacity: ${op}`,
      ]
        .filter(Boolean)
        .join('; ');
      return `<span class="pdf-layer-anchor" style="display:inline-block;width:0;height:0;overflow:visible;position:relative;vertical-align:top;"><img class="${cls}" src="${src}" alt="${escapeAttr(alt)}" style="${sizeBits}" ${width ? `width="${width}"` : ''} ${height ? `height="${height}"` : ''} /></span>`;
    }

    if (width || height) {
      const bits = [
        width ? `width: ${width}px` : null,
        height ? `height: ${height}px` : null,
        'max-width: none',
      ]
        .filter(Boolean)
        .join('; ');
      return `<img src="${src}" alt="${escapeAttr(alt)}" ${width ? `width="${width}"` : ''} ${height ? `height="${height}"` : ''} style="${bits}" />`;
    }
    return full;
  });

  flow = flow.replace(/<p>\s*<\/p>/gi, '');
  return `<div class="pdf-flow">${flow}</div>`;
}

function wrapHtmlDocument(title, bodyHtml, pageSetup = {}, { forPdf = false } = {}) {
  let body = forPdf ? prepareHtmlForPdf(bodyHtml) : bodyHtml;
  body = promoteTableCellStyles(body);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeAttr(title)}</title>
  <style>${editorMatchedStyles(pageSetup)}</style>
</head>
<body>${body}</body>
</html>`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export async function exportDocument(id, format) {
  const meta = readDocMeta(id);
  const html = readDocHtml(id);
  if (!meta || html === null) throw Object.assign(new Error('Document not found'), { status: 404 });

  const title = meta.title || 'document';
  const safeName = title.replace(/[^\w\s\-]+/g, '').trim() || 'document';
  const pageSetup = meta.pageSetup || {};
  const fullHtml = wrapHtmlDocument(title, html, pageSetup);
  const pdfHtml = wrapHtmlDocument(title, html, pageSetup, { forPdf: true });

  switch (format) {
    case 'html': {
      const zip = new JSZip();
      zip.file(`${safeName}.html`, fullHtml);
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      return { buffer, filename: `${safeName}.html.zip`, mime: 'application/zip' };
    }
    case 'txt': {
      const text = htmlToText(html, { wordwrap: 80 });
      return {
        buffer: Buffer.from(text, 'utf8'),
        filename: `${safeName}.txt`,
        mime: 'text/plain',
      };
    }
    case 'rtf': {
      const text = htmlToText(html, { wordwrap: false });
      const rtf = `{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}}\\f0\\fs22 ${escapeRtf(text)}}`;
      return {
        buffer: Buffer.from(rtf, 'utf8'),
        filename: `${safeName}.rtf`,
        mime: 'application/rtf',
      };
    }
    case 'odt': {
      const buffer = await buildSimpleOdt(title, html);
      return {
        buffer,
        filename: `${safeName}.odt`,
        mime: 'application/vnd.oasis.opendocument.text',
      };
    }
    case 'epub': {
      const buffer = await buildSimpleEpub(title, html);
      return { buffer, filename: `${safeName}.epub`, mime: 'application/epub+zip' };
    }
    case 'docx': {
      const margins = normalizeMargins(pageSetup);
      const buffer = await HTMLtoDOCX(fullHtml, null, {
        title,
        margins: {
          top: margins.top,
          right: margins.right,
          bottom: margins.bottom,
          left: margins.left,
        },
      });
      return {
        buffer: Buffer.from(buffer),
        filename: `${safeName}.docx`,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
    }
    case 'pdf': {
      let browser;
      try {
        browser = await launchPdfBrowser();
        const page = await browser.newPage();
        const sizeKey = pageSetup.paperSize === 'letter' ? 'letter' : 'a4';
        const orient = pageSetup.orientation === 'landscape' ? 'landscape' : 'portrait';
        const dims = PAPER_PX[sizeKey][orient];
        await page.setViewport({
          width: dims.width,
          height: dims.height,
          deviceScaleFactor: 1,
        });
        await page.setContent(pdfHtml, { waitUntil: 'load', timeout: 120000 });
        await page.emulateMediaType('print');
        await page.evaluate(async () => {
          const imgs = [...document.images];
          await Promise.all(
            imgs.map((img) => {
              if (img.complete && img.naturalWidth > 0) return Promise.resolve();
              return new Promise((resolve) => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
                if (img.complete) resolve();
              });
            })
          );
        });
        const pdf = await page.pdf({
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
        });
        return { buffer: Buffer.from(pdf), filename: `${safeName}.pdf`, mime: 'application/pdf' };
      } catch (err) {
        const message = err?.message || String(err);
        throw Object.assign(new Error(`PDF export failed: ${message}`), {
          status: err.status || 500,
        });
      } finally {
        if (browser) {
          try {
            await browser.close();
          } catch {
            /* ignore */
          }
        }
      }
    }
    default:
      throw Object.assign(new Error(`Unsupported format: ${format}`), { status: 400 });
  }
}

function escapeRtf(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\\par\n');
}

async function buildSimpleOdt(title, html) {
  const text = htmlToText(html, { wordwrap: false });
  const zip = new JSZip();
  zip.file(
    'mimetype',
    'application/vnd.oasis.opendocument.text',
    { compression: 'STORE' }
  );
  zip.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
  <office:body><office:text>
    <text:h text:style-name="Heading_20_1" text:outline-level="1">${xmlEscape(title)}</text:h>
    ${text
      .split(/\n+/)
      .map((p) => `<text:p>${xmlEscape(p)}</text:p>`)
      .join('\n')}
  </office:text></office:body>
</office:document-content>`
  );
  zip.file(
    'META-INF/manifest.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function buildSimpleEpub(title, html) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${xmlEscape(title)}</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">dekopon-${Date.now()}</dc:identifier>
  </metadata>
  <manifest>
    <item id="chap1" href="chap1.html" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="chap1"/></spine>
</package>`
  );
  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <docTitle><text>${xmlEscape(title)}</text></docTitle>
  <navMap><navPoint id="nav1" playOrder="1"><navLabel><text>${xmlEscape(title)}</text></navLabel><content src="chap1.html"/></navPoint></navMap>
</ncx>`
  );
  zip.file(
    'OEBPS/chap1.html',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xmlEscape(title)}</title></head>
<body>${html}</body></html>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

void DOCS_DIR;
void ROOT;
void fs;
