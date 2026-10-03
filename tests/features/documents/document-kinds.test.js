import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, mergeRecord } from '../../../public/features/documents/records.js';
import { createDocument } from '../../../public/features/documents/document-model.js';
import { documentKind } from '../../../public/shared/document-kind.js';

test('new records default to Markdown and both immutable kinds reopen with their title', () => {
  for (const kind of [undefined, 'markdown', 'docx']) {
    const record = createRecord({ id: 'new', actor: 'author', kind, title: 'Local draft', content: 'Offline writing' });
    assert.equal(record.kind, kind || 'markdown');
    const reopened = createDocument(record.kind, 'reader', JSON.parse(JSON.stringify(record.state)));
    assert.equal(reopened.title.value, 'Local draft');
    if (kind !== 'docx') assert.equal(reopened.text(), 'Offline writing');
    assert.throws(() => mergeRecord(reopened, record, { ...record, kind: record.kind === 'docx' ? 'markdown' : 'docx' }), /cannot change/);
    reopened.destroy?.();
  }
});
test('legacy records have a Markdown interpretation without rewriting them', () => {
  const record = { state: createDocument('markdown', 'legacy').snapshot() }, before = JSON.stringify(record);
  assert.equal(documentKind(record.kind), 'markdown');
  assert.equal(createDocument(record.kind, 'reader', record.state).text(), '');
  assert.equal(JSON.stringify(record), before);
});
test('invalid kinds and cross-format snapshots are rejected', () => {
  for (const kind of [null, '', 'DOCX', 'folder', false, {}, []]) assert.throws(() => createDocument(kind, 'actor'), /Invalid document kind/);
  const markdown = createDocument('markdown', 'actor'), rich = createDocument('docx', 'actor');
  assert.throws(() => createDocument('docx', 'reader', markdown.snapshot()), /Invalid DOCX/);
  assert.throws(() => createDocument('markdown', 'reader', rich.snapshot()), /Invalid Markdown/);
  assert.throws(() => createDocument(undefined, 'reader', rich.snapshot()), /Invalid Markdown/);
  rich.destroy();
});
