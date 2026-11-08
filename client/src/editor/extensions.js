import { Extension, Mark, Node } from '@tiptap/core';
import { TextStyle } from '@tiptap/extension-text-style';

export const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() {
    return { types: ['textStyle'] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => el.style.fontSize?.replace(/['"]+/g, '') || null,
            renderHTML: (attrs) => {
              if (!attrs.fontSize) return {};
              return { style: `font-size: ${attrs.fontSize}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (fontSize) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

export const LineHeight = Extension.create({
  name: 'lineHeight',
  addOptions() {
    return { types: ['paragraph', 'heading'] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => el.style.lineHeight || null,
            renderHTML: (attrs) => {
              if (!attrs.lineHeight) return {};
              return { style: `line-height: ${attrs.lineHeight}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setLineHeight:
        (lineHeight) =>
        ({ commands }) =>
          this.options.types.every((type) => commands.updateAttributes(type, { lineHeight })),
    };
  },
});

export const ParagraphStyle = Extension.create({
  name: 'paragraphStyle',
  addOptions() {
    return { types: ['paragraph', 'heading'] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: null,
            parseHTML: (el) => el.style.marginLeft || null,
            renderHTML: (attrs) => (attrs.indent ? { style: `margin-left: ${attrs.indent}` } : {}),
          },
          indentRight: {
            default: null,
            parseHTML: (el) => el.style.marginRight || null,
            renderHTML: (attrs) =>
              attrs.indentRight ? { style: `margin-right: ${attrs.indentRight}` } : {},
          },
          spacingBefore: {
            default: null,
            parseHTML: (el) => el.style.marginTop || null,
            renderHTML: (attrs) =>
              attrs.spacingBefore ? { style: `margin-top: ${attrs.spacingBefore}` } : {},
          },
          spacingAfter: {
            default: null,
            parseHTML: (el) => el.style.marginBottom || null,
            renderHTML: (attrs) =>
              attrs.spacingAfter ? { style: `margin-bottom: ${attrs.spacingAfter}` } : {},
          },
          bgShade: {
            default: null,
            parseHTML: (el) => el.style.backgroundColor || null,
            renderHTML: (attrs) =>
              attrs.bgShade ? { style: `background-color: ${attrs.bgShade}` } : {},
          },
          border: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-border') || null,
            renderHTML: (attrs) =>
              attrs.border
                ? { 'data-border': attrs.border, style: `border: ${attrs.border}; padding: 8px` }
                : {},
          },
        },
      },
    ];
  },
});

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }, { tag: 'hr.page-break' }];
  },
  renderHTML() {
    return ['div', { 'data-page-break': '', class: 'page-break', contenteditable: 'false' }, ['span', {}, 'Page break']];
  },
  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});

export const HorizontalRuleStyled = Node.create({
  name: 'horizontalRule',
  group: 'block',
  parseHTML() {
    return [{ tag: 'hr' }];
  },
  renderHTML() {
    return ['hr', { class: 'doc-hr' }];
  },
  addCommands() {
    return {
      setHorizontalRule:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});

export const CommentMark = Mark.create({
  name: 'comment',
  excludes: '',
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'comment-mark' }, 0];
  },
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => (attrs.commentId ? { 'data-comment-id': attrs.commentId } : {}),
      },
    };
  },
});

export const SuggestionMark = Mark.create({
  name: 'suggestion',
  excludes: '',
  parseHTML() {
    return [{ tag: 'span[data-suggestion]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      {
        ...HTMLAttributes,
        class: `suggestion-mark suggestion-${HTMLAttributes['data-type'] || 'insert'}`,
      },
      0,
    ];
  },
  addAttributes() {
    return {
      suggestionId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-suggestion'),
        renderHTML: (attrs) => (attrs.suggestionId ? { 'data-suggestion': attrs.suggestionId } : {}),
      },
      type: {
        default: 'insert',
        parseHTML: (el) => el.getAttribute('data-type') || 'insert',
        renderHTML: (attrs) => ({ 'data-type': attrs.type }),
      },
    };
  },
});

export const ReactionMark = Mark.create({
  name: 'reaction',
  excludes: '',
  parseHTML() {
    return [{ tag: 'span[data-reaction]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'reaction-mark' }, 0];
  },
  addAttributes() {
    return {
      emoji: {
        default: '👍',
        parseHTML: (el) => el.getAttribute('data-reaction') || '👍',
        renderHTML: (attrs) => ({ 'data-reaction': attrs.emoji, title: attrs.emoji }),
      },
    };
  },
});

export const Footnote = Node.create({
  name: 'footnote',
  group: 'block',
  content: 'inline*',
  defining: true,
  parseHTML() {
    return [{ tag: 'blockquote.footnote' }];
  },
  renderHTML() {
    return ['blockquote', { class: 'footnote' }, 0];
  },
  addCommands() {
    return {
      insertFootnote:
        (text = 'Footnote') =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [{ type: 'text', text }],
          }),
    };
  },
});

export const ChartBlock = Node.create({
  name: 'chartBlock',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      chartType: { default: 'bar' },
      title: { default: 'Chart' },
      data: {
        default: JSON.stringify({
          labels: ['A', 'B', 'C', 'D'],
          values: [12, 19, 8, 15],
        }),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-chart]',
        getAttrs: (el) => ({
          chartType: el.getAttribute('data-chart-type') || 'bar',
          title: el.getAttribute('data-title') || 'Chart',
          data: el.getAttribute('data-chart') || '{}',
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      {
        'data-chart': HTMLAttributes.data,
        'data-chart-type': HTMLAttributes.chartType,
        'data-title': HTMLAttributes.title,
        class: 'chart-block',
      },
      ['strong', {}, HTMLAttributes.title || 'Chart'],
      [
        'div',
        { class: 'chart-placeholder' },
        `${HTMLAttributes.chartType} chart · edit via AI or insert dialog`,
      ],
    ];
  },
  addCommands() {
    return {
      insertChart:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

export { TextStyle };
