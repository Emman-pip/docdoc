import * as Y from 'yjs';
import { createDecoder, hasContent } from 'lib0/decoding';
import { yXmlFragmentToProsemirrorJSON, prosemirrorJSONToYDoc, updateYFragment, initProseMirrorDoc } from '@tiptap/y-tiptap';
import { validateRichContent, richSchema } from './rich-schema.js';

export const RICH_FORMAT = 'docdoc-yjs-v1';
export const STATE_LIMIT = 1900 * 1024; // Leave room for identity and request metadata.
export function encodeUpdate(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function decodeUpdate(value) {
  if (typeof value !== 'string' || value.length > STATE_LIMIT || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || !value) throw new Error('Invalid Yjs state encoding or size.');
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
export function contentFromYDoc(ydoc) {
  const fragment = ydoc.getXmlFragment('body');
  if ([...ydoc.share.keys()].some(key => key !== 'body')) throw new Error('Invalid Yjs document fields.');
  let count = 0;
  function validateTree(node, depth = 0) {
    if (++count > 50000 || depth > 32) throw new Error('Invalid DOCX content complexity.');
    if (node instanceof Y.XmlText) {
      if (node.toDelta().some(part => typeof part.insert !== 'string')) throw new Error('Invalid DOCX text.');
    } else {
      if (node !== fragment && !(node instanceof Y.XmlElement)) throw new Error('Invalid DOCX block.');
      for (const child of node.toArray()) validateTree(child, depth + 1);
    }
  }
  validateTree(fragment);
  const content = yXmlFragmentToProsemirrorJSON(fragment);
  // A new, unedited document has no Yjs blocks until the editor is mounted.
  if (!content.content?.length) return { type: 'doc', content: [{ type: 'paragraph' }] };
  return content;
}
function validateTitle(title) {
  if (!title || typeof title.value !== 'string' || title.value.length > 120 || !Number.isSafeInteger(title.clock) || title.clock < 0 || typeof title.actor !== 'string' || title.actor.length > 64) throw new Error('Invalid title.');
}
export class RichDocument {
  constructor(actor, state) {
    this.actor = actor; this.clock = 0; this.ydoc = new Y.Doc();
    this.title = { value: 'Untitled document', clock: 0, actor: '' };
    if (state !== undefined) this.merge(state);
  }
  merge(state) {
    if (!state || state.format !== RICH_FORMAT || Object.keys(state).some(key => !['format', 'update', 'title'].includes(key))) throw new Error('Invalid DOCX state.');
    validateTitle(state.title);
    const bytes = decodeUpdate(state.update), candidate = new Y.Doc();
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.ydoc));
      const decoder = createDecoder(bytes);
      Y.readUpdate(decoder, candidate);
      if (hasContent(decoder)) throw new Error('Trailing bytes in Yjs update.');
      for (const struct of Y.decodeUpdate(bytes).structs) {
        if (typeof struct.parent === 'string' && (struct.parent !== 'body' || struct.parentSub != null)) throw new Error('Invalid Yjs root.');
        if (struct.content instanceof Y.ContentType && !(struct.content.type instanceof Y.XmlElement) && !(struct.content.type instanceof Y.XmlText)) throw new Error('Invalid Yjs shared type.');
      }
      validateRichContent(contentFromYDoc(candidate));
      if (encodeUpdate(Y.encodeStateAsUpdate(candidate)).length > STATE_LIMIT) throw new Error('Document exceeds the DOCX sync limit. Export a backup.');
      Y.applyUpdate(this.ydoc, bytes, 'remote');
    } catch (error) { throw new Error(`Invalid DOCX state: ${error.message}`); }
    finally { candidate.destroy(); }
    if (state.title.clock > this.title.clock || (state.title.clock === this.title.clock && state.title.actor > this.title.actor)) this.title = { ...state.title };
    this.clock = Math.max(this.clock, state.title.clock);
  }
  rename(value) { this.title = { value: value.slice(0, 120), clock: ++this.clock, actor: this.actor }; }
  content() { return contentFromYDoc(this.ydoc); }
  text() { const node = validateRichContent(this.content()); return node.textBetween(0, node.content.size, '\n', ' '); }
  snapshot() { return { format: RICH_FORMAT, update: encodeUpdate(Y.encodeStateAsUpdate(this.ydoc)), title: { ...this.title } }; }
  destroy() { this.ydoc.destroy(); }
}
export function checkReplacement(model, content) {
  const node = validateRichContent(content), candidate = new RichDocument('preflight', model.snapshot());
  try {
    const fragment = candidate.ydoc.getXmlFragment('body');
    const { meta } = initProseMirrorDoc(fragment, richSchema);
    updateYFragment(candidate.ydoc, fragment, node, meta);
    if (JSON.stringify(candidate.snapshot()).length > STATE_LIMIT - 10000) throw new Error('This import exceeds the DOCX sync limit, including existing edit history. Create a new document.');
  } finally { candidate.destroy(); }
}
export function richStateFromContent(content, title = 'Untitled document') {
  validateRichContent(content);
  const ydoc = prosemirrorJSONToYDoc(richSchema, content, 'body');
  try { return { format: RICH_FORMAT, update: encodeUpdate(Y.encodeStateAsUpdate(ydoc)), title: { value: title.slice(0, 120), clock: 1, actor: 'import' } }; }
  finally { ydoc.destroy(); }
}
