import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { RichDocument, richStateFromContent, encodeUpdate, checkReplacement } from '../../../public/features/documents/rich-document.js';
import { validateRichContent } from '../../../public/features/documents/rich-schema.js';
import { PNG, paragraph, richContent } from '../../support/rich-fixture.js';

test('concurrent DOCX text, formatting, image, and title changes converge over duplicate/reordered delivery', () => {
  const seed = richStateFromContent({ type: 'doc', content: [paragraph('hello world')] });
  const peers = Array.from({ length: 5 }, (_, index) => new RichDocument(`user-${index}`, seed));
  for (const [index, peer] of peers.entries()) {
    const paragraph = peer.ydoc.getXmlFragment('body').get(0), text = paragraph.get(0);
    text.insert(5, ` user${index}`); text.format(0, 5, { [index % 2 ? 'bold' : 'italic']: {} });
    const image = new Y.XmlElement('image'); image.setAttribute('src', PNG); image.setAttribute('alt', `photo ${index}`); paragraph.push([image]);
    peer.rename(`Title ${index}`);
  }
  const states = peers.map(peer => peer.snapshot());
  peers.forEach((peer, index) => { for (let turn = 0; turn < 2; turn++) for (let offset = 0; offset < states.length; offset++) peer.merge(states[(offset + index) % states.length]); });
  const expected = peers[0].content();
  for (const peer of peers) {
    assert.deepEqual(peer.content(), expected); assert.equal(peer.title.value, peers[0].title.value);
    for (let index = 0; index < 5; index++) assert.match(peer.text(), new RegExp(`user${index}`));
    assert.equal(peer.content().content[0].content.filter(node => node.type === 'image').length, 5);
    peer.destroy();
  }
});
test('Yjs incremental updates can arrive twice and before their prerequisite update', () => {
  const source = new RichDocument('source', richStateFromContent({ type: 'doc', content: [paragraph('a')] }));
  const vector = Y.encodeStateVector(source.ydoc), first = source.snapshot();
  source.ydoc.getXmlFragment('body').get(0).get(0).insert(1, 'b');
  const second = { ...source.snapshot(), update: encodeUpdate(Y.encodeStateAsUpdate(source.ydoc, vector)) };
  const remote = new RichDocument('remote'); remote.merge(second); remote.merge(second); remote.merge(first);
  assert.equal(remote.text(), 'ab'); source.destroy(); remote.destroy();
});
test('invalid Yjs and unsupported rich content fail without changing the prior document', () => {
  const doc = new RichDocument('author', richStateFromContent(richContent)), before = doc.snapshot();
  for (const update of ['bad!', 'AAAA', 'AAAAAA==', '']) assert.throws(() => doc.merge({ ...before, update }), /Invalid/);
  const unsupported = new Y.Doc(), block = new Y.XmlElement('table'); unsupported.getXmlFragment('body').push([block]);
  assert.throws(() => doc.merge({ ...before, update: encodeUpdate(Y.encodeStateAsUpdate(unsupported)) }), /Invalid/);
  const otherRoot = new Y.Doc(); otherRoot.getText('arbitrary').insert(0, 'payload');
  assert.throws(() => doc.merge({ ...before, update: encodeUpdate(Y.encodeStateAsUpdate(otherRoot)) }), /Invalid/);
  assert.deepEqual(doc.snapshot(), before);
  assert.throws(() => validateRichContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'https://example.com/remote.png' } }] }] }), /Invalid photo/);
  assert.throws(() => validateRichContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }), /Invalid link/);
  doc.destroy(); unsupported.destroy(); otherRoot.destroy();
});
test('failed conversion preflight leaves content intact and reopening retains all supported nodes', () => {
  const doc = new RichDocument('author', richStateFromContent(richContent)), before = doc.snapshot();
  assert.throws(() => checkReplacement(doc, { type: 'doc', content: [{ type: 'table' }] }), /Invalid/);
  checkReplacement(doc, { type: 'doc', content: [paragraph('Replacement')] });
  assert.deepEqual(doc.snapshot(), before);
  const reopened = new RichDocument('reader', JSON.parse(JSON.stringify(before)));
  assert.deepEqual(reopened.content(), doc.content()); doc.destroy(); reopened.destroy();
});
