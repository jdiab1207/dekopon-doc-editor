import { TableInsertPicker } from './TableInsertPicker';

const FONTS = [
  'Literata',
  'Source Serif 4',
  'DM Sans',
  'Georgia',
  'Times New Roman',
  'Arial',
  'Courier New',
  'IBM Plex Mono',
  'Fraunces',
];

const SIZES = ['10px', '11px', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px', '48px'];

export default function Toolbar({
  editor,
  pageSetup,
  onPageSetup,
  editMode,
  onEditMode,
  paintFormat,
  onPaintFormat,
  onInsertImage,
  onInsertSpecial,
  onOpenPageSetup,
  onOpenExport,
  onOpenVersions,
  onOpenComments,
  onOpenNotes,
  onToggleOutline,
  onToggleAi,
}) {
  if (!editor) return null;

  const setStyle = (style) => {
    const chain = editor.chain().focus();
    if (style === 'title') chain.setHeading({ level: 1 }).run();
    else if (style === 'subtitle') chain.setParagraph().updateAttributes('paragraph', {}).run();
    else if (style.startsWith('h')) chain.setHeading({ level: Number(style[1]) }).run();
    else chain.setParagraph().run();
  };

  return (
    <div className="toolbar">
      <select
        defaultValue="normal"
        onChange={(e) => setStyle(e.target.value)}
        title="Styles"
      >
        <option value="normal">Normal text</option>
        <option value="title">Title</option>
        <option value="subtitle">Subtitle</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
        <option value="h5">Heading 5</option>
        <option value="h6">Heading 6</option>
      </select>

      <select
        value={editor.getAttributes('textStyle').fontFamily || 'Literata'}
        onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
        title="Font"
      >
        {FONTS.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>
            {f}
          </option>
        ))}
      </select>

      <select
        value={editor.getAttributes('textStyle').fontSize || '11pt'}
        onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}
        title="Size"
      >
        {SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <span className="sep" />

      <button
        type="button"
        className={`tool ${editor.isActive('bold') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        className={`tool ${editor.isActive('italic') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
      >
        <em>I</em>
      </button>
      <button
        type="button"
        className={`tool ${editor.isActive('underline') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline"
      >
        <u>U</u>
      </button>
      <button
        type="button"
        className={`tool ${editor.isActive('strike') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <s>S</s>
      </button>
      <button
        type="button"
        className={`tool ${editor.isActive('superscript') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
        title="Superscript"
      >
        X²
      </button>
      <button
        type="button"
        className={`tool ${editor.isActive('subscript') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
        title="Subscript"
      >
        X₂
      </button>

      <label className="tool" title="Text color">
        A
        <input
          type="color"
          style={{ width: 22, height: 22, border: 0, background: 'transparent', padding: 0, marginLeft: 4 }}
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
        />
      </label>
      <label className="tool" title="Highlight">
        ▮
        <input
          type="color"
          defaultValue="#fff59d"
          style={{ width: 22, height: 22, border: 0, background: 'transparent', padding: 0, marginLeft: 4 }}
          onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()}
        />
      </label>

      <span className="sep" />

      <button type="button" className="tool" onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Align left">
        ⫷
      </button>
      <button type="button" className="tool" onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Align center">
        ≡
      </button>
      <button type="button" className="tool" onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Align right">
        ⫸
      </button>
      <button type="button" className="tool" onClick={() => editor.chain().focus().setTextAlign('justify').run()} title="Justify">
        ☰
      </button>

      <select
        defaultValue="1.5"
        onChange={(e) => editor.chain().focus().setLineHeight(e.target.value).run()}
        title="Line spacing"
      >
        <option value="1">Line 1.0</option>
        <option value="1.15">Line 1.15</option>
        <option value="1.5">Line 1.5</option>
        <option value="2">Line 2.0</option>
        <option value="2.5">Line 2.5</option>
      </select>

      <button
        type="button"
        className="tool"
        title="Increase indent"
        onClick={() => {
          const cur = editor.getAttributes('paragraph').indent || '0px';
          const n = parseInt(cur, 10) || 0;
          editor.chain().focus().updateAttributes('paragraph', { indent: `${n + 24}px` }).run();
        }}
      >
        →|
      </button>
      <button
        type="button"
        className="tool"
        title="Decrease indent"
        onClick={() => {
          const cur = editor.getAttributes('paragraph').indent || '0px';
          const n = Math.max(0, (parseInt(cur, 10) || 0) - 24);
          editor.chain().focus().updateAttributes('paragraph', { indent: n ? `${n}px` : null }).run();
        }}
      >
        |←
      </button>

      <span className="sep" />

      <button type="button" className="tool" onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullets">
        • List
      </button>
      <button type="button" className="tool" onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered">
        1. List
      </button>
      <button type="button" className="tool" onClick={() => editor.chain().focus().toggleTaskList().run()} title="Checklist">
        ☑
      </button>
      <button type="button" className="tool" onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">
        “ ”
      </button>

      <span className="sep" />

      <TableInsertPicker editor={editor} />

      <button type="button" className="tool" onClick={onInsertImage} title="Insert image">
        Image
      </button>
      <button
        type="button"
        className="tool"
        title="Insert chart"
        onClick={() => {
          const type = window.prompt('Chart type: bar, line, pie, column', 'bar') || 'bar';
          editor
            .chain()
            .focus()
            .insertChart({
              chartType: type === 'column' ? 'bar' : type,
              title: 'Chart',
              data: JSON.stringify({ labels: ['Q1', 'Q2', 'Q3', 'Q4'], values: [10, 16, 12, 20] }),
            })
            .run();
        }}
      >
        Chart
      </button>
      <button type="button" className="tool" onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal line">
        ―
      </button>
      <button type="button" className="tool" onClick={() => editor.chain().focus().insertPageBreak().run()} title="Page break">
        Page break
      </button>
      <button
        type="button"
        className="tool"
        title="Footnote"
        onClick={() => {
          const text = window.prompt('Footnote text', 'Reference note');
          if (text) editor.chain().focus().insertFootnote(text).run();
        }}
      >
        Footnote
      </button>
      <button type="button" className="tool" onClick={onInsertSpecial} title="Special characters">
        Ω
      </button>

      <span className="sep" />

      <button
        type="button"
        className={`tool ${paintFormat ? 'active' : ''}`}
        onClick={onPaintFormat}
        title="Paint format"
      >
        Paint format
      </button>
      <button
        type="button"
        className="tool"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        title="Clear formatting"
      >
        Clear
      </button>

      <span className="sep" />

      <select value={editMode} onChange={(e) => onEditMode(e.target.value)} title="Mode">
        <option value="editing">Editing</option>
        <option value="suggesting">Suggesting</option>
        <option value="viewing">Viewing</option>
      </select>

      <button
        type="button"
        className={`tool ${pageSetup.mode === 'pageless' ? 'active' : ''}`}
        onClick={() =>
          onPageSetup({
            ...pageSetup,
            mode: pageSetup.mode === 'pageless' ? 'paginated' : 'pageless',
          })
        }
        title="Pageless mode"
      >
        {pageSetup.mode === 'pageless' ? 'Pageless' : 'Pages'}
      </button>

      <select
        value={String(pageSetup.columns || 1)}
        onChange={(e) => onPageSetup({ ...pageSetup, columns: Number(e.target.value) })}
        title="Columns"
      >
        <option value="1">1 col</option>
        <option value="2">2 cols</option>
        <option value="3">3 cols</option>
      </select>

      <button type="button" className="tool" onClick={onOpenPageSetup} title="Page setup">
        Page setup
      </button>
      <button type="button" className="tool" onClick={onOpenComments} title="Comments">
        Comments
      </button>
      <button type="button" className="tool" onClick={onOpenVersions} title="Version history">
        Versions
      </button>
      <button type="button" className="tool" onClick={onOpenNotes} title="Notes & tasks">
        Notes
      </button>
      <button type="button" className="tool" onClick={onToggleOutline} title="Outline">
        Outline
      </button>
      <button type="button" className="tool" onClick={onToggleAi} title="Cursor AI">
        Cursor AI
      </button>
      <button type="button" className="tool" onClick={onOpenExport} title="Export">
        Export
      </button>
    </div>
  );
}
