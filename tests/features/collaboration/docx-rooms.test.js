import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../../src/server.js';
import { createDocument } from '../../../public/features/documents/document-model.js';
import { RichDocument, richStateFromContent } from '../../../public/features/documents/rich-document.js';
import { request } from '../../support/request-helper.js';
import { richContent } from '../../support/rich-fixture.js';

function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'docdoc-docx-')); t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  let server = createApp({ dataDir });
  const post = async (path, body, room, owner = false) => {
    const response = await request(server, path, { method: 'POST', body, headers: room ? { Authorization: `Bearer ${room.token}`, ...(owner ? { 'X-Owner-Key': room.ownerToken } : {}) } : {} });
    return { status: response.status, body: await response.json() };
  };
  return { dataDir, post, request: (path, options) => request(server, path, options), restart: () => { server = createApp({ dataDir }); } };
}
for (const kind of ['markdown', 'docx']) test(`${kind} rooms preserve kind, invitations, and durable content across restart`, async t => {
  const f = fixture(t), doc = createDocument(kind, 'author', kind === 'docx' ? richStateFromContent(richContent) : undefined);
  doc.rename('Shared draft'); if (kind === 'markdown') doc.edit('Shared writing');
  const result = await f.post('/api/rooms', { kind, state: doc.snapshot() }); assert.equal(result.status, 201);
  const room = result.body, path = `/api/rooms/${room.id}`; assert.equal(room.kind, kind);
  assert.equal(JSON.parse(readFileSync(join(f.dataDir, room.id + '.json'))).kind, kind);
  f.restart();
  const invitation = await f.post('/api/invitations/join', { code: room.code, user: 'guest' });
  assert.equal(invitation.body.kind, kind); assert.equal(invitation.body.ownerToken, undefined);
  assert.equal((await f.post(`${path}/invitation`, {}, room)).body.kind, kind);
  const synced = await f.post(`${path}/sync`, { kind, user: 'guest', state: createDocument(kind, 'guest').snapshot() }, room);
  assert.equal(synced.status, 200); assert.equal(synced.body.kind, kind);
  const reader = createDocument(kind, 'reader', synced.body.state); assert.equal(reader.text(), doc.text()); assert.equal(reader.title.value, doc.title.value);
  doc.destroy?.(); reader.destroy?.();
});
test('legacy snapshots stay Markdown and are not rewritten just to supply their kind', async t => {
  const f = fixture(t), state = createDocument('markdown', 'old').snapshot();
  const { body: room } = await f.post('/api/rooms', { state });
  const path = join(f.dataDir, room.id + '.json'), saved = JSON.parse(readFileSync(path)); delete saved.kind; writeFileSync(path, JSON.stringify(saved));
  const before = readFileSync(path, 'utf8'); f.restart();
  const joined = await f.post('/api/invitations/join', { code: room.code }); assert.equal(joined.body.kind, 'markdown');
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal((await f.post(`/api/rooms/${room.id}/sync`, { user: 'legacy', state }, room)).status, 200);
});
test('invalid kinds, mismatched states, and malformed updates never replace a durable snapshot', async t => {
  const f = fixture(t), rich = richStateFromContent(richContent), markdown = createDocument('markdown', 'a').snapshot();
  for (const input of [{ kind: null, state: markdown }, { kind: 'word', state: rich }, { kind: 'docx', state: markdown }, { kind: 'markdown', state: rich }, { state: rich }, { kind: 'docx' }, {}]) assert.equal((await f.post('/api/rooms', input)).status, 400);
  const { body: room } = await f.post('/api/rooms', { kind: 'docx', state: rich }), path = `/api/rooms/${room.id}/sync`;
  const before = readFileSync(join(f.dataDir, room.id + '.json'), 'utf8');
  for (const input of [{ kind: 'markdown', state: markdown }, { state: rich }, { kind: null, state: rich }, { kind: 'docx', state: markdown }, { kind: 'docx', state: { ...rich, update: 'AAAA' } }]) assert.equal((await f.post(path, { user: 'guest', ...input }, room)).status, 400);
  assert.equal(readFileSync(join(f.dataDir, room.id + '.json'), 'utf8'), before);
});
test('disconnected formatting and image edits merge after host restart and duplicate uploads', async t => {
  const f = fixture(t), seed = richStateFromContent(richContent);
  const { body: room } = await f.post('/api/rooms', { kind: 'docx', state: seed }), path = `/api/rooms/${room.id}/sync`;
  const alice = new RichDocument('alice', seed), bob = new RichDocument('bob', seed);
  alice.ydoc.getXmlFragment('body').get(0).get(0).insert(0, 'Alice ');
  bob.ydoc.getXmlFragment('body').get(1).get(0).format(0, 4, { italic: {} });
  bob.ydoc.getXmlFragment('body').get(1).get(1).setAttribute('alt', 'Offline image description');
  await f.post(path, { kind: 'docx', user: 'alice', state: alice.snapshot() }, room); f.restart();
  const merged = await f.post(path, { kind: 'docx', user: 'bob', state: bob.snapshot() }, room);
  assert.equal(merged.status, 200); alice.merge(merged.body.state); bob.merge(merged.body.state); assert.deepEqual(alice.content(), bob.content());
  assert.match(alice.text(), /Alice/); assert.match(JSON.stringify(alice.content()), /Offline image description/);
  const duplicate = await f.post(path, { kind: 'docx', user: 'bob', state: merged.body.state }, room);
  assert.deepEqual(new RichDocument('reader', duplicate.body.state).content(), alice.content()); alice.destroy(); bob.destroy();
});
test('DOCX rooms enforce invitations, selected-user policies, capacity, and file access', async t => {
  const f = fixture(t), state = richStateFromContent(richContent);
  const { body: room } = await f.post('/api/rooms', { kind: 'docx', state, policy: { enabled: true, ips: [], usernames: ['alice'], macs: [] } });
  const path = `/api/rooms/${room.id}`;
  assert.equal((await f.post(`${path}/sync`, { kind: 'docx', user: 'guest', state })).status, 403);
  assert.equal((await f.post('/api/invitations/join', { code: room.code, user: 'guest', name: 'Mallory' })).status, 403);
  assert.equal((await f.post(`${path}/sync`, { kind: 'docx', user: 'guest', name: 'Mallory', state }, room)).status, 403);
  for (let index = 0; index < 6; index++) assert.equal((await f.post(`${path}/sync`, { kind: 'docx', user: `alice-${index}`, name: 'Alice', state }, room)).status, index < 5 ? 200 : 409);
  const headers = { Authorization: `Bearer ${room.token}`, 'X-File-Name': 'report.txt' };
  const upload = await f.request(`${path}/files?user=alice-0&name=Alice`, { method: 'POST', headers, rawBody: 'DOCX room file' }); assert.equal(upload.status, 201);
  assert.equal((await f.request(`${path}/files?user=blocked&name=Mallory`, { headers })).status, 403);
  const list = await f.request(`${path}/files?user=alice-0&name=Alice`, { headers }); assert.equal((await list.json()).files[0].name, 'report.txt');
});
test('failed host persistence rolls back the Yjs candidate and retains the old state', async t => {
  const f = fixture(t), state = richStateFromContent(richContent), changed = new RichDocument('author', state);
  const { body: room } = await f.post('/api/rooms', { kind: 'docx', state }), path = `/api/rooms/${room.id}/sync`;
  changed.rename('Must not be acknowledged');
  const temporary = join(f.dataDir, room.id + '.json.tmp'); mkdirSync(temporary);
  assert.equal((await f.post(path, { kind: 'docx', user: 'author', state: changed.snapshot() }, room)).status, 500);
  rmSync(temporary, { recursive: true });
  const unchanged = await f.post(path, { kind: 'docx', user: 'reader', state }, room);
  assert.equal(unchanged.body.state.title.value, state.title.value); changed.destroy();
});
