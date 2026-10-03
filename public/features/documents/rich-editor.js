import { Editor, Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import Collaboration from '@tiptap/extension-collaboration';
import { richExtensions, validateRichContent } from './rich-schema.js';

export function attachRichEditor(element, model, onEdit, onError) {
  const editor = new Editor({
    element, injectCSS: false,
    extensions: [...richExtensions(), Collaboration.configure({ document: model.ydoc, field: 'body' }), Extension.create({
      name: 'supportedContent',
      addProseMirrorPlugins: () => [new Plugin({ filterTransaction: transaction => {
        if (!transaction.docChanged) return true;
        try { validateRichContent(transaction.doc.toJSON()); return true; }
        catch (error) { onError(error.message); return false; }
      } })],
    })],
    editorProps: { attributes: { 'aria-label': 'DOCX document content', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor, transaction }) => {
      // Remote Yjs updates are saved by the room/storage synchronization caller.
      if (transaction.getMeta('y-sync$')?.isChangeOrigin) return;
      try { validateRichContent(editor.getJSON()); onEdit(); } catch (error) { onError(error.message); }
    },
  });
  return editor;
}
