import test from 'node:test';
import assert from 'node:assert/strict';
import { attachFileSharing } from '../public/files.js';

function setup(t) {
  const oldDocument = globalThis.document, oldFetch = globalThis.fetch;
  t.after(() => { globalThis.document = oldDocument; globalThis.fetch = oldFetch; });
  const element = () => ({ hidden: false, disabled: false, children: [], attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; }, click() { this.onclick?.(); } });
  const elements = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  globalThis.document = { createElement: element };
  let current = { id: 'document-one' }, files = [], roomCreations = 0;
  const calls = [];
  const room = { id: 'room-one', token: 'invitation' };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') { files.push({ id: 'file-one', name: options.body.name, size: options.body.size, uploadedBy: 'Alice', uploadedByIP: '192.168.1.20', createdAt: 1000 }); return { ok: true, json: async () => ({ file: files.at(-1) }) }; }
    return { ok: true, json: async () => ({ files }) };
  };
  const controller = attachFileSharing({ $, user: 'alice', getCurrent: () => current, getName: () => 'Alice', ensureRoom: async record => { roomCreations++; record.room = room; return room; } });
  return { $, calls, controller, room, get roomCreations() { return roomCreations; }, setCurrent: record => { current = record; controller.reset(); } };
}

test('file-sharing mode uploads into an invited room and renders a download without changing the editor', async t => {
  const fixture = setup(t), { $, calls } = fixture;
  $('editor-panel').hidden = false;
  $('files-tab').onclick();
  assert.equal($('editor-panel').hidden, true); assert.equal($('files-panel').hidden, false);
  assert.match($('file-status').textContent, /Upload a file/);
  $('upload-file').onclick(); $('file-input').files = [{ name: 'report.zip', size: 123 }];
  await $('file-input').onchange();
  assert.equal(fixture.roomCreations, 1); assert.equal(calls[0].options.headers.Authorization, 'Bearer invitation');
  assert.match(calls[0].url, /user=alice/); assert.equal(calls[0].options.headers['X-File-Name'], 'report.zip');
  const row = $('file-list').children[0]; assert.equal(row.children[0].children[0].textContent, 'report.zip'); assert.equal(row.children[1].textContent, '↓ Download');
  assert.match(row.children[0].children[1].textContent, /Original owner: Alice \(192\.168\.1\.20\)/);
  assert.match($('file-status').textContent, /Uploaded report.zip/);
  $('editor-tab').onclick(); assert.equal($('editor-panel').hidden, false); assert.equal($('files-panel').hidden, true);
});

test('oversized files and changing documents during file selection do not upload into the wrong room', async t => {
  const { $, calls, setCurrent } = setup(t); $('files-tab').onclick();
  $('upload-file').onclick(); $('file-input').files = [{ name: 'large.zip', size: 21 * 1024 * 1024 }]; await $('file-input').onchange();
  assert.equal(calls.length, 0); assert.match($('file-status').textContent, /20 MB/);
  $('upload-file').onclick(); setCurrent({ id: 'another-document' });
  $('file-input').files = [{ name: 'private.txt', size: 10 }]; await $('file-input').onchange();
  assert.equal(calls.length, 0); assert.match($('file-status').textContent, /document changed/);
});

test('failed uploads are visible and release the upload button for retry', async t => {
  const { $ } = setup(t); $('files-tab').onclick();
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: 'This session is full.' }) });
  $('upload-file').onclick(); $('file-input').files = [{ name: 'report.pdf', size: 100 }]; await $('file-input').onchange();
  assert.match($('file-status').textContent, /Upload failed: This session is full/);
  assert.equal($('upload-file').disabled, false);
});

test('older uploads show their known owner and explicitly identify missing historical IPs', async t => {
  const { $, controller, room, setCurrent } = setup(t);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ files: [{ id: 'legacy', name: 'old.txt', size: 10, uploadedBy: 'Original Alice', createdAt: 1000 }] }) });
  setCurrent({ id: 'legacy-document', room }); $('files-tab').onclick();
  // Drain the first automatic refresh before requesting another one.
  await new Promise(resolve => setImmediate(resolve));
  await controller.refresh(true);
  const info = $('file-list').children[0].children[0].children[1].textContent;
  assert.match(info, /Original owner: Original Alice \(IP not recorded\)/);
});
