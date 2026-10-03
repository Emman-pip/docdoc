import { createDocument } from './document-model.js';
import { documentKind, requireKind } from '../../shared/document-kind.js';

export const DOCUMENT_KEY = 'docdoc.documents.v1';
export function createRecord({ id, actor, kind = 'markdown', title = 'Untitled document', content = '', policy }) {
  kind = documentKind(kind);
  const model = createDocument(kind, actor);
  model.rename(title);
  if (kind === 'markdown') model.edit(content);
  const record = { id, kind, state: model.snapshot(), updated: Date.now(), policy, local: true };
  model.destroy?.();
  return record;
}
export function mergeRecord(model, record, incoming) {
  requireKind(record.kind, incoming.kind);
  model.merge(incoming.state);
}
