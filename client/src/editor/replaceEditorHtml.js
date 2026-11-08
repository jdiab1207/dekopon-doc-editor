import { EditorState } from '@tiptap/pm/state';

/**
 * Replace editor HTML. When clearHistory is true (document load / remote refresh),
 * reset the undo stack so Ctrl+Z cannot revert to the empty boot document.
 */
export function replaceEditorHtml(editor, html, { clearHistory = false, emitUpdate = false } = {}) {
  if (!editor) return;
  editor.commands.setContent(html || '<p></p>', emitUpdate);
  if (!clearHistory || !editor.view) return;

  editor.view.updateState(
    EditorState.create({
      doc: editor.state.doc,
      plugins: editor.state.plugins,
      selection: editor.state.selection,
    })
  );
}
