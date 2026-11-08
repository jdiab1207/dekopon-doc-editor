const BLOCK_CLOSE =
  /^\/(?:p|h[1-6]|div|blockquote|li|tr|table|thead|tbody|ul|ol|hr|pre|section|article|header|footer)/i;

export function formatDocHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/\r\n/g, '\n')
    .replace(/>\s*</g, '>\n<')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function plainRangeToLines(html, plainFrom, plainTo) {
  const source = formatDocHtml(html);
  const from = Math.max(0, plainFrom);
  const to = Math.max(from, plainTo);

  let plain = 0;
  let i = 0;
  let startPos = 0;
  let endPos = source.length;
  let foundStart = false;

  const lineAt = (pos) => {
    if (pos <= 0) return 1;
    return source.slice(0, pos).split('\n').length;
  };

  while (i < source.length && plain <= to) {
    if (source[i] === '<') {
      const gt = source.indexOf('>', i);
      if (gt === -1) break;
      const inner = source.slice(i + 1, gt);
      i = gt + 1;
      if (BLOCK_CLOSE.test(inner) && plain > 0) {
        if (!foundStart && plain === from) {
          startPos = i;
          foundStart = true;
        }
        plain += 1;
        if (plain >= to) {
          endPos = i;
          break;
        }
      }
      continue;
    }

    if (source[i] === '&') {
      const semi = source.indexOf(';', i);
      if (semi !== -1 && semi - i < 12) {
        if (!foundStart && plain === from) {
          startPos = i;
          foundStart = true;
        }
        plain += 1;
        i = semi + 1;
        if (plain >= to) {
          endPos = i;
          break;
        }
        continue;
      }
    }

    if (!foundStart && plain === from) {
      startPos = i;
      foundStart = true;
    }
    plain += 1;
    i += 1;
    if (plain >= to) {
      endPos = i;
      break;
    }
  }

  if (!foundStart) {
    return { startLine: 1, endLine: Math.max(1, source.split('\n').length) };
  }

  const startLine = lineAt(startPos);
  const endLine = lineAt(Math.max(startPos, endPos - 1));
  return { startLine, endLine: Math.max(startLine, endLine) };
}

export function formatLineRef({ startLine, endLine }) {
  if (startLine === endLine) return `Line [${startLine}]`;
  return `Line [${startLine}-${endLine}]`;
}

export function expandPromptReferences(prompt, references, html) {
  let result = prompt;
  const resolved = [];

  for (const ref of references || []) {
    const range = plainRangeToLines(html, ref.plainFrom ?? 0, ref.plainTo ?? 0);
    const label = formatLineRef(range);
    resolved.push({ ...ref, ...range, label });
    const token = `{{ref:${ref.id}}}`;
    if (result.includes(token)) {
      result = result.split(token).join(label);
    }
  }

  const missing = resolved.filter(
    (r) => !prompt.includes(`{{ref:${r.id}}}`) && !result.includes(r.label)
  );
  if (missing.length) {
    result += `\n\nReferenced selections: ${missing.map((r) => r.label).join(', ')}`;
  }

  return { prompt: result, resolved };
}
