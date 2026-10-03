export const DOCUMENT_KINDS = Object.freeze(['markdown', 'docx']);
export function documentKind(value) {
  if (value === undefined) return 'markdown';
  if (!DOCUMENT_KINDS.includes(value)) throw new Error('Invalid document kind: choose markdown or docx.');
  return value;
}
export function requireKind(expected, received) {
  if (documentKind(expected) !== documentKind(received)) throw new Error('Invalid document kind: a document cannot change formats.');
}
