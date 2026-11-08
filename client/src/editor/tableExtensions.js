import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Table from '@tiptap/extension-table';

/** Data attrs only — styles are composed in renderHTML to avoid clobbering. */
const cellAttrs = {
  backgroundColor: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-bg') || el.style.backgroundColor || null,
    renderHTML: (attrs) => (attrs.backgroundColor ? { 'data-bg': attrs.backgroundColor } : {}),
  },
  borderColor: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-border-color') || el.style.borderColor || null,
    renderHTML: (attrs) =>
      attrs.borderColor ? { 'data-border-color': attrs.borderColor } : {},
  },
  borderWidth: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-border-width') || el.style.borderWidth || null,
    renderHTML: (attrs) =>
      attrs.borderWidth ? { 'data-border-width': attrs.borderWidth } : {},
  },
  padding: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-padding') || el.style.padding || null,
    renderHTML: (attrs) => (attrs.padding ? { 'data-padding': attrs.padding } : {}),
  },
  verticalAlign: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-valign') || el.style.verticalAlign || null,
    renderHTML: (attrs) =>
      attrs.verticalAlign ? { 'data-valign': attrs.verticalAlign } : {},
  },
};

function cellRenderHTML(tag, node, HTMLAttributes) {
  const styles = [];
  if (node.attrs.backgroundColor) styles.push(`background-color: ${node.attrs.backgroundColor}`);
  if (node.attrs.borderColor) styles.push(`border-color: ${node.attrs.borderColor}`);
  if (node.attrs.borderWidth) {
    styles.push(`border-width: ${node.attrs.borderWidth}`);
    styles.push('border-style: solid');
  }
  if (node.attrs.padding) styles.push(`padding: ${node.attrs.padding}`);
  if (node.attrs.verticalAlign) styles.push(`vertical-align: ${node.attrs.verticalAlign}`);
  if (node.attrs.colwidth?.[0]) styles.push(`width: ${node.attrs.colwidth[0]}px`);

  const attrs = { ...HTMLAttributes };
  if (styles.length) {
    attrs.style = [HTMLAttributes.style, styles.join('; ')].filter(Boolean).join('; ');
  }
  if (node.attrs.backgroundColor) attrs['data-bg'] = node.attrs.backgroundColor;
  if (node.attrs.borderColor) attrs['data-border-color'] = node.attrs.borderColor;
  if (node.attrs.borderWidth) attrs['data-border-width'] = node.attrs.borderWidth;
  if (node.attrs.padding) attrs['data-padding'] = node.attrs.padding;
  if (node.attrs.verticalAlign) attrs['data-valign'] = node.attrs.verticalAlign;
  if (node.attrs.colwidth) attrs.colwidth = node.attrs.colwidth.join(',');

  return [tag, attrs, 0];
}

const colwidthAttr = {
  default: null,
  parseHTML: (el) => {
    const colwidth = el.getAttribute('colwidth');
    return colwidth ? colwidth.split(',').map((w) => parseInt(w, 10)) : null;
  },
  renderHTML: (attrs) => {
    if (!attrs.colwidth) return {};
    return { colwidth: attrs.colwidth.join(',') };
  },
};

export const CustomTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...cellAttrs,
      colwidth: colwidthAttr,
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    return cellRenderHTML('td', node, HTMLAttributes);
  },
});

export const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...cellAttrs,
      colwidth: colwidthAttr,
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    return cellRenderHTML('th', node, HTMLAttributes);
  },
});

export const CustomTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: 'width: 100%',
        parseHTML: (el) => el.getAttribute('style'),
        renderHTML: (attrs) => (attrs.style ? { style: attrs.style } : {}),
      },
    };
  },
}).configure({
  resizable: true,
  allowTableNodeSelection: true,
  cellMinWidth: 48,
});
