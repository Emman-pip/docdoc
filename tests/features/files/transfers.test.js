import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../../src/features/rooms/http.js';
import { UploadReservations, MAX_ROOM_BYTES, MAX_FILE_BYTES } from '../../../src/features/files/file-sharing.js';
import { zipEntries, crc32 } from '../../../src/features/files/zip.js';
import { fixture } from '../../support/folder-fixture.js';
import { request } from '../../support/request-helper.js';
const upload = (f, name = 'file.txt', options = {}) => request(f.server, `${f.base}/files?user=guest&name=Alice&folder=${f.folder.id}`, { method: 'POST', headers: { ...f.guestHeaders, 'X-File-Name': encodeURIComponent(name), ...options.headers }, rawBody: 'hello', ...options, ...(options.headers ? { headers: { ...f.guestHeaders, 'X-File-Name': encodeURIComponent(name), ...options.headers } } : {}) });
test('quota reserves concurrent bytes and file slots with exact boundaries and releases failures', () => {
  const room = { files: [{ size: MAX_ROOM_BYTES - 2 }] }, quota = new UploadReservations();
  quota.reserve(room, 'a', 1); quota.reserve(room, 'b', 1);
  assert.throws(() => quota.reserve(room, 'c', 1), /storage limit/);
  assert.throws(() => quota.grow(room, 'a', 2), /storage limit/);
  quota.release('b'); quota.grow(room, 'a', 2); assert.equal(quota.pending.get('a'), 2);
  const count = new UploadReservations(10, 2); count.reserve({ files: [] }, 'a'); count.reserve({ files: [] }, 'b'); assert.throws(() => count.reserve({ files: [] }, 'c'), /file limit/);
});
test('uploader private credentials, idempotent retries, owner deletion, and cleanup failure release quota', async t => {
  const f = await fixture(t, { removeFile() { throw Error('filesystem busy'); } });
  const result = await (await upload(f, 'same.txt', { headers: { 'X-Upload-Key': 'a'.repeat(64) } })).json();
  assert.equal(result.deletionToken.length, 64); assert.equal(result.file.deletionHash, undefined);
  const again = await (await upload(f, 'same.txt', { headers: { 'X-Upload-Key': 'a'.repeat(64) } })).json(); assert.equal(again.file.id, result.file.id); assert.equal(again.deletionToken, result.deletionToken);
  const list = await (await request(f.server, `${f.base}/files?user=guest`, { headers: f.guestHeaders })).json();
  assert.equal(list.files.length, 1); assert.equal(list.files[0].deletionHash, undefined); assert.equal(list.files[0].uploadKey, undefined); assert.equal(list.deletionToken, undefined);
  const path = `${f.base}/files/${result.file.id}?user=guest`;
  assert.equal((await request(f.server, path, { method: 'DELETE', headers: { ...f.guestHeaders, 'X-Deletion-Key': 'wrong' } })).status, 403);
  assert.equal((await request(f.server, path, { method: 'DELETE', headers: { ...f.guestHeaders, 'X-Deletion-Key': result.deletionToken } })).status, 200);
  const saved = JSON.parse(readFileSync(join(f.dataDir, f.room.id + '.json'))); assert.equal(saved.files.length, 0); assert.deepEqual(saved.garbage, [result.file.id]);
  assert.ok(existsSync(join(f.dataDir, 'files', f.room.id, result.file.id + '.bin')));
  createApp({ dataDir: f.dataDir }); // Cleanup retries when the room is next loaded.
  const restarted = createApp({ dataDir: f.dataDir }); await request(restarted, `${f.base}/files?user=owner`, { headers: f.headers });
  assert.equal(existsSync(join(f.dataDir, 'files', f.room.id, result.file.id + '.bin')), false);
  const second = await (await upload(f)).json();
  assert.equal((await request(f.server, `${f.base}/files/${second.file.id}?user=owner`, { method: 'DELETE', headers: f.headers })).status, 200);
});
test('legacy uploads keep their metadata, require owner deletion, and root-file API remains compatible', async t => {
  const f = await fixture(t), uploaded = await (await upload(f)).json();
  const path = join(f.dataDir, f.room.id + '.json'), saved = JSON.parse(readFileSync(path));
  delete saved.files[0].deletionHash; delete saved.files[0].folderId; writeFileSync(path, JSON.stringify(saved));
  const server = createApp({ dataDir: f.dataDir }), route = `${f.base}/files/${uploaded.file.id}?user=owner`;
  const list = await (await request(server, `${f.base}/files?user=owner`, { headers: f.headers })).json();
  assert.equal(list.files[0].folderId, null); assert.equal(list.files[0].ownerOnlyDeletion, true); assert.equal(list.files[0].uploadedBy, 'Alice');
  assert.equal((await request(server, route, { method: 'DELETE', headers: { Authorization: f.headers.Authorization, 'X-Deletion-Key': uploaded.deletionToken } })).status, 403);
  assert.equal((await request(server, route, { method: 'DELETE', headers: f.headers })).status, 200);
});
test('stream failures, cancellation, length mismatch, and in-flight revocation remove temporary bytes', async t => {
  const f = await fixture(t);
  async function* aborted() { yield Buffer.from('partial'); throw Error('aborted'); }
  assert.equal((await upload(f, 'cancelled', { rawChunks: aborted() })).status, 500);
  assert.deepEqual(readdirSync(join(f.dataDir, 'files', f.room.id)), []);
  assert.equal((await upload(f, 'boundary', { headers: { 'Content-Length': MAX_FILE_BYTES } })).status, 400);
  let ready, release; const started = new Promise(resolve => ready = resolve), gate = new Promise(resolve => release = resolve);
  async function* chunks() { ready(); await gate; yield Buffer.from('secret'); }
  const pending = upload(f, 'revoked', { rawChunks: chunks() }); await started;
  await f.call('folder-invitations', { action: 'revoke', code: f.guest.code }); release();
  assert.equal((await pending).status, 403); assert.deepEqual(readdirSync(join(f.dataDir, 'files', f.room.id)), []);
  const valid = await request(f.server, `${f.base}/files?user=owner`, { method: 'POST', headers: { ...f.headers, 'X-File-Name': 'ok' }, rawBody: 'ok' }); assert.equal(valid.status, 201);
});
test('native download tickets are single-use, expire, and recheck scope and policy', async t => {
  let now = 1000; const f = await fixture(t, { now: () => now }), file = (await (await upload(f)).json()).file;
  const ticket = async () => (await (await f.call('download-tickets', { user: 'guest', name: 'Alice', fileId: file.id }, f.guestHeaders)).json()).url;
  const first = await ticket(); assert.equal(await (await request(f.server, first)).text(), 'hello'); assert.equal((await request(f.server, first)).status, 403);
  const expired = await ticket(); now += 60001; assert.equal((await request(f.server, expired)).status, 403);
  const moved = await ticket(); await request(f.server, `${f.base}/files/${file.id}?user=owner`, { method: 'PATCH', headers: f.headers }); assert.equal((await request(f.server, moved)).status, 403);
  await request(f.server, `${f.base}/files/${file.id}?user=owner&folder=${f.folder.id}`, { method: 'PATCH', headers: f.headers });
  const denied = await ticket(); await f.call('access', { action: 'set', policy: { enabled: true, ips: [], macs: [], usernames: [] } }); assert.equal((await request(f.server, denied)).status, 403);
  await f.call('access', { action: 'set', policy: { enabled: false, ips: [], macs: [], usernames: [] } });
  const revoked = await ticket(); await f.call('folder-invitations', { action: 'revoke', code: f.guest.code }); assert.equal((await request(f.server, revoked)).status, 403);
});
test('ZIP streams the selected tree, preserves empty folders, and disambiguates duplicate names', async t => {
  const f = await fixture(t); await upload(f, 'résumé.txt'); await upload(f, 'résumé.txt');
  await f.call('folders', { action: 'create', name: 'Empty', parentId: f.folder.id });
  const url = (await (await f.call('download-tickets', { user: 'guest', name: 'Alice', folderId: f.folder.id }, f.guestHeaders)).json()).url;
  const response = await request(f.server, url), zip = await response.bytes(); assert.equal(response.status, 200);
  const end = zip.length - 22, count = zip.readUInt16LE(end + 10); let offset = zip.readUInt32LE(end + 16); const names = [], contents = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50); const size = zip.readUInt32LE(offset + 24), n = zip.readUInt16LE(offset + 28), local = zip.readUInt32LE(offset + 42);
    names.push(zip.subarray(offset + 46, offset + 46 + n).toString()); const start = local + 30 + zip.readUInt16LE(local + 26), bytes = zip.subarray(start, start + size); contents.push(bytes.toString());
    assert.equal((crc32(bytes) ^ 0xffffffff) >>> 0, zip.readUInt32LE(offset + 16)); offset += 46 + n;
  }
  assert.equal(new Set(names).size, 4); assert.ok(names.includes('Shared/Empty/')); assert.equal(names.some(name => name.includes('Private parent')), false); assert.deepEqual(contents.filter(Boolean), ['hello', 'hello']);
  assert.throws(() => zipEntries({ folders: [], files: [{ name: '../escape', size: 0 }] }, null), /Invalid name/);
});

test('long uploads retain their admission slot until cancellation or completion', async t => {
  let now = 1000; const f = await fixture(t, { now: () => now });
  let ready, release; const started = new Promise(resolve => ready = resolve), gate = new Promise(resolve => release = resolve);
  async function* chunks() { ready(); await gate; yield Buffer.from('long transfer'); }
  const pending = upload(f, 'long.txt', { rawChunks: chunks() }); await started; now += 30000;
  for (let i = 0; i < 4; i++) assert.equal((await request(f.server, `${f.base}/files?user=active${i}`, { headers: f.headers })).status, 200);
  assert.equal((await request(f.server, `${f.base}/files?user=sixth`, { headers: f.headers })).status, 409);
  release(); assert.equal((await pending).status, 201);
});

test('HTTP uploads reserve declared bytes concurrently without allocating GiB buffers', async t => {
  const f = await fixture(t), initial = await (await upload(f)).json();
  const snapshot = join(f.dataDir, f.room.id + '.json'), stored = JSON.parse(readFileSync(snapshot));
  stored.files[0].size = MAX_ROOM_BYTES - 1; writeFileSync(snapshot, JSON.stringify(stored));
  f.server = createApp({ dataDir: f.dataDir });
  let ready, release; const started = new Promise(resolve => ready = resolve), gate = new Promise(resolve => release = resolve);
  async function* chunks() { ready(); await gate; yield Buffer.from('x'); }
  const pending = upload(f, 'last-byte', { headers: { 'Content-Length': '1' }, rawChunks: chunks() }); await started;
  assert.equal((await upload(f, 'concurrent', { headers: { 'Content-Length': '1' }, rawBody: 'x' })).status, 413);
  release(); assert.equal((await pending).status, 201);
  assert.equal((await upload(f, 'chunked', { rawBody: 'x' })).status, 413);
  assert.equal((await request(f.server, `${f.base}/files/${initial.file.id}?user=owner`, { method: 'DELETE', headers: f.headers })).status, 200);
  assert.equal((await upload(f, 'capacity-released', { rawBody: 'x' })).status, 201);
});

test('a descendant moved outside the invitation while receiving an upload fails the final scope check', async t => {
  const f = await fixture(t);
  const child = (await (await f.call('folders', { action: 'create', name: 'Child', parentId: f.folder.id })).json()).folder;
  let ready, release; const started = new Promise(resolve => ready = resolve), gate = new Promise(resolve => release = resolve);
  async function* chunks() { ready(); await gate; yield Buffer.from('secret'); }
  const pending = request(f.server, `${f.base}/files?user=guest&folder=${child.id}`, { method: 'POST', headers: { ...f.guestHeaders, 'X-File-Name': 'moved.txt' }, rawChunks: chunks() }); await started;
  await f.call('folders', { action: 'move', id: child.id, parentId: null }); release();
  assert.equal((await pending).status, 403); assert.deepEqual(readdirSync(join(f.dataDir, 'files', f.room.id)), []);
});
