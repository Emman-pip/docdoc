import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document } from '../public/crdt.js';
import { createApp } from '../src/server.js';
import { MAX_FILE_BYTES, MAX_ROOM_BYTES } from '../src/file-sharing.js';
import { request } from './request-helper.js';

async function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'docdoc-files-')); t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const server = createApp({ dataDir });
  const response = await request(server, '/api/rooms', { method: 'POST', body: { state: new Document('owner').snapshot() } });
  const room = await response.json();
  const headers = { Authorization: `Bearer ${room.token}` };
  const path = `/api/rooms/${room.id}/files`;
  return { server, dataDir, room, headers, path };
}

test('uploads any binary file, lists its metadata, and downloads exact bytes after a host restart', async t => {
  const { server, dataDir, headers, path } = await setup(t);
  const data = Buffer.from([0, 255, 23, 0, 128, 37]);
  const filename = 'team résumé.html';
  const upload = await request(server, `${path}?user=owner&name=Alice`, { method: 'POST', headers: { ...headers, 'X-File-Name': encodeURIComponent(filename) }, rawBody: data });
  assert.equal(upload.status, 201); const { file } = await upload.json(); assert.equal(file.size, data.length); assert.equal(file.name, filename);
  const list = await request(server, `${path}?user=bob`, { headers }); assert.equal(list.status, 200); assert.equal((await list.json()).files[0].id, file.id);
  const restarted = createApp({ dataDir });
  const download = await request(restarted, `${path}/${file.id}?user=bob`, { headers });
  assert.equal(download.status, 200); assert.deepEqual(await download.bytes(), data);
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.match(download.headers.get('content-disposition'), /r%C3%A9sum%C3%A9/);
  assert.equal(download.headers.get('cache-control'), 'no-store');
});

test('unauthorized participants cannot list, upload, or download session files', async t => {
  const { server, headers, path } = await setup(t);
  const uploaded = await request(server, `${path}?user=owner`, { method: 'POST', headers: { ...headers, 'X-File-Name': 'notes.txt' }, rawBody: Buffer.from('secret') });
  const { file } = await uploaded.json();
  for (const [url, options] of [ [path, {}], [path, { method: 'POST', rawBody: Buffer.from('bad') }], [`${path}/${file.id}`, {}] ]) {
    const denied = await request(server, `${url}?user=stranger`, options);
    assert.equal(denied.status, 403); assert.equal((await denied.json()).files, undefined);
  }
  const crossOrigin = await request(server, `${path}?user=owner`, { headers: { ...headers, Origin: 'http://attacker.example' } });
  assert.equal(crossOrigin.status, 403);
});

test('the sixth participant is rejected in file-sharing mode as well as text mode', async t => {
  const { server, headers, path, room } = await setup(t);
  for (let i = 0; i < 5; i++) assert.equal((await request(server, `${path}?user=user-${i}`, { headers })).status, 200);
  assert.equal((await request(server, `${path}?user=sixth`, { headers })).status, 409);
  const upload = await request(server, `${path}?user=sixth`, { method: 'POST', headers: { ...headers, 'X-File-Name': 'file.txt' }, rawBody: 'no' }); assert.equal(upload.status, 409);
  const sync = await request(server, `/api/rooms/${room.id}/sync`, { method: 'POST', headers, body: { user: 'sixth', state: new Document('sixth').snapshot() } }); assert.equal(sync.status, 409);
  assert.equal((await request(server, `${path}?user=user-0`, { headers })).status, 200);
});

test('rejects oversized files and unsafe requests and normalizes filenames', async t => {
  const { server, headers, path } = await setup(t);
  const url = `${path}?user=owner`;
  assert.equal((await request(server, url, { method: 'POST', headers: { ...headers, 'X-File-Name': 'large', 'Content-Length': MAX_FILE_BYTES + 1 }, rawBody: '' })).status, 413);
  assert.equal((await request(server, url, { method: 'POST', headers: { ...headers, 'X-File-Name': 'large' }, rawBody: Buffer.alloc(MAX_FILE_BYTES + 1) })).status, 413);
  assert.equal((await request(server, url, { method: 'POST', headers: { ...headers, 'X-File-Name': '%' }, rawBody: '' })).status, 400);
  const safe = await request(server, url, { method: 'POST', headers: { ...headers, 'X-File-Name': encodeURIComponent('../folder\\file\r\n.txt') }, rawBody: 'test' });
  assert.equal(safe.status, 201); assert.doesNotMatch((await safe.json()).file.name, /[/\\\r\n]/);
  assert.equal((await request(server, `${path}?user=../bad`, { headers })).status, 400);
  assert.equal((await request(server, `${path}/00000000-0000-0000-0000-000000000000?user=owner`, { headers })).status, 404);
});

test('concurrent uploads cannot exceed the file-count limit', async t => {
  const { server, headers, path } = await setup(t);
  const results = await Promise.all(Array.from({ length: 21 }, (_, i) => request(server, `${path}?user=owner`, { method: 'POST', headers: { ...headers, 'X-File-Name': `file-${i}.txt` }, rawBody: 'test' })));
  assert.equal(results.filter(result => result.status === 201).length, 20); assert.equal(results.filter(result => result.status === 413).length, 1);
  assert.equal((await (await request(server, `${path}?user=owner`, { headers })).json()).files.length, 20);
});

test('room byte quota survives a restart and document synchronization retains the file inventory', async t => {
  const { server, headers, path, room, dataDir } = await setup(t);
  const uploaded = await request(server, `${path}?user=owner`, { method: 'POST', headers: { ...headers, 'X-File-Name': 'file.txt' }, rawBody: 'test' });
  const { file } = await uploaded.json();
  const text = new Document('owner'); text.edit('Hello');
  const sync = await request(server, `/api/rooms/${room.id}/sync`, { method: 'POST', headers, body: { user: 'owner', state: text.snapshot() } }); assert.equal(sync.status, 200);
  const stateFile = join(dataDir, `${room.id}.json`), saved = JSON.parse(readFileSync(stateFile));
  assert.equal(saved.files[0].id, file.id);
  saved.files[0].size = MAX_ROOM_BYTES; writeFileSync(stateFile, JSON.stringify(saved));
  const restarted = createApp({ dataDir });
  const rejected = await request(restarted, `${path}?user=owner`, { method: 'POST', headers: { ...headers, 'X-File-Name': 'extra' }, rawBody: 'test' }); assert.equal(rejected.status, 413);
});

test('file ownership records the original uploader and actual peer IP across name changes and restarts', async t => {
  const { server, dataDir, headers, path } = await setup(t);
  const result = await request(server, `${path}?user=original-user&name=Alice`, { method: 'POST', remoteAddress: '::ffff:192.168.1.20', headers: { ...headers, 'X-File-Name': 'original.txt', 'X-Forwarded-For': '1.2.3.4' }, rawBody: 'original bytes' });
  const { file } = await result.json();
  assert.equal(file.uploadedBy, 'Alice'); assert.equal(file.uploadedByIP, '192.168.1.20'); assert.equal(file.uploadedByUser, 'original-user');
  await request(server, `${path}?user=original-user&name=Renamed`, { headers, remoteAddress: '192.168.1.99' });
  const restarted = createApp({ dataDir });
  const list = await request(restarted, `${path}?user=viewer&name=Bob`, { headers });
  const retained = (await list.json()).files[0]; assert.equal(retained.uploadedBy, 'Alice'); assert.equal(retained.uploadedByIP, '192.168.1.20');
});
