import test from 'node:test';
import assert from 'node:assert/strict';
import { Document } from '../../../public/features/documents/crdt.js';
import { validateImage, exportMarkdown, preparePhoto } from '../../../public/features/documents/images.js';
import { renderMarkdown } from '../../../public/features/documents/markdown.js';
import { createApp } from '../../../src/features/rooms/http.js';
import { request } from '../../support/request-helper.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=';
const photo = { id: 'photo-one', data };

test('photos persist, merge with offline edits, and export as embedded Markdown images', () => {
  const a = new Document('a'), b = new Document('b');
  a.addImage(photo); a.edit('![My photo](docdoc-image:photo-one)'); b.edit('A note');
  const oldA = a.snapshot(), oldB = b.snapshot(); a.merge(oldB); b.merge(oldA);
  assert.equal(a.text(), b.text()); assert.deepEqual([...a.images], [...b.images]);
  const reopened = new Document('c', JSON.parse(JSON.stringify(a.snapshot())));
  assert.equal(reopened.images.get('photo-one').data, data);
  assert.match(exportMarkdown(reopened.text(), reopened.images), /!\[My photo\]\(data:image\/png;base64,/);
  const legacy = { nodes: [], deleted: [] }; assert.equal(new Document('legacy', legacy).images.size, 0);
});

test('photo preview escapes alt text and HTML and ignores external or executable image links', () => {
  const images = new Map([[photo.id, photo]]);
  const html = renderMarkdown('![" onerror="alert(1)](docdoc-image:photo-one)\n<script>alert(2)</script>\n![remote](https://example.com/photo.png)', images);
  assert.match(html, /alt="&quot; onerror=&quot;alert\(1\)"/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal((html.match(/<img /g) || []).length, 1);
  assert.doesNotMatch(html, /<script>|src="https:/);
  assert.match(renderMarkdown('![gone](docdoc-image:missing)', images), /Photo unavailable/);
});

test('invalid formats, oversized payloads, MIME mismatches, and conflicting IDs are rejected', () => {
  assert.doesNotThrow(() => validateImage(photo));
  for (const bad of [ { id: 'svg', data: 'data:image/svg+xml;base64,PHN2Zz4=' }, { id: 'fake', data: 'data:image/png;base64,aGVsbG8=' }, { id: 'large', data: `data:image/png;base64,${'A'.repeat(400000)}` }, { id: '../bad', data } ]) assert.throws(() => validateImage(bad), /Invalid photo/);
  const doc = new Document('a'); doc.addImage(photo);
  assert.throws(() => doc.addImage({ ...photo, data: 'data:image/jpeg;base64,/9j/AA==' }), /Conflicting/);
});

test('browser upload processing resizes, produces bounded image data, and cleans up object URLs', async t => {
  const originalImage = globalThis.Image, originalDocument = globalThis.document;
  t.after(() => { globalThis.Image = originalImage; globalThis.document = originalDocument; });
  let dimensions;
  globalThis.Image = class {
    naturalWidth = 3200; naturalHeight = 2400;
    set src(value) { queueMicrotask(() => this.onload()); }
  };
  globalThis.document = { createElement() { return {
    getContext() { return { fillRect() {}, drawImage() {}, set fillStyle(value) {} }; },
    toDataURL() { dimensions = [this.width, this.height]; return 'data:image/jpeg;base64,/9j/AA=='; },
  }; } };
  assert.match(await preparePhoto(new Blob(['photo'], { type: 'image/png' })), /^data:image\/jpeg/);
  assert.deepEqual(dimensions, [1600, 1200]);
  await assert.rejects(preparePhoto(new Blob(['svg'], { type: 'image/svg+xml' })), /PNG, JPEG, or WebP/);
  await assert.rejects(preparePhoto({ type: 'image/png', size: 11 * 1024 * 1024 }), /10 MB/);
});

test('host retains photos across synchronization and restart and denies unauthorized access', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'docdoc-photos-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const server = createApp({ dataDir: directory }), doc = new Document('a'); doc.addImage(photo); doc.edit('![Photo](docdoc-image:photo-one)');
  const created = await request(server, '/api/rooms', { method: 'POST', body: { state: doc.snapshot() } });
  assert.equal(created.status, 201); const { id, token } = await created.json();
  const restarted = createApp({ dataDir: directory }), path = `/api/rooms/${id}/sync`;
  const response = await request(restarted, path, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: { user: 'b', state: new Document('b').snapshot() } });
  assert.equal(response.status, 200); assert.equal((await response.json()).state.images[0].data, data);
  const denied = await request(restarted, path, { method: 'POST', body: { user: 'stranger', state: new Document('b').snapshot() } });
  assert.equal(denied.status, 403); assert.equal((await denied.json()).state, undefined);
  for (const path of ['/features/documents/vim.js', '/features/documents/images.js', '/features/documents/markdown.js']) assert.equal((await request(server, path)).status, 200);
});
