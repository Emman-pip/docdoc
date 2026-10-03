import { Document } from './crdt.js';
import { RichDocument } from './rich-document.js';
import { documentKind } from '../../shared/document-kind.js';

export function createDocument(kind, actor, state) {
  kind = documentKind(kind);
  if (kind === 'docx') return new RichDocument(actor, state);
  if (state !== undefined && (!state || Object.hasOwn(state, 'format') || Object.hasOwn(state, 'update') || !Array.isArray(state.nodes) || !Array.isArray(state.deleted))) throw new Error('Invalid Markdown state.');
  return new Document(actor, state);
}
