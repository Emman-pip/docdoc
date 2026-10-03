import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../../../src/features/rooms/http.js';
import { Document } from '../../../public/features/documents/crdt.js';
import { request } from '../../support/request-helper.js';
import { normalizeCode, invitationLink, invitationFromLocation } from '../../../public/features/collaboration/invitations.js';
async function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'docdoc-invites-')); t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  let time = 1000; const server = createApp({ dataDir, now: () => time });
  const doc = new Document('owner'); doc.edit('Private document');
  const response = await request(server, '/api/rooms', { method: 'POST', body: { state: doc.snapshot() } });
  return { server, dataDir, room: await response.json(), advance: value => time += value };
}
test('short invitations resolve to the same document and survive a host restart', async t => {
  const { server, dataDir, room } = await setup(t);
  assert.match(room.code, /^[a-z]{3}-[a-z]{3}-[a-z]{3}$/);
  const resolved = await request(server, '/api/invitations/join', { method: 'POST', body: { code: ` ${room.code.toUpperCase()} ` } });
  assert.equal(resolved.status, 200); assert.deepEqual(await resolved.json(), { id: room.id, token: room.token, code: room.code, kind: 'markdown' });
  assert.equal((await request(server, `/${room.code}`)).status, 200);
  const restarted = createApp({ dataDir });
  const again = await request(restarted, '/api/invitations/join', { method: 'POST', body: { code: room.code } }); assert.deepEqual(await again.json(), { id: room.id, token: room.token, code: room.code, kind: 'markdown' });
  const sync = await request(restarted, `/api/rooms/${room.id}/sync`, { method: 'POST', headers: { Authorization: `Bearer ${room.token}` }, body: { user: 'new-user', state: new Document('new-user').snapshot() } });
  assert.equal(new Document('reader', (await sync.json()).state).text(), 'Private document');
});
test('old invitation credentials still work and gain a stable short code without changing document content', async t => {
  const { dataDir, room } = await setup(t), filename = join(dataDir, `${room.id}.json`);
  const saved = JSON.parse(readFileSync(filename)); delete saved.code; writeFileSync(filename, JSON.stringify(saved));
  const server = createApp({ dataDir }), path = `/api/rooms/${room.id}/invitation`;
  assert.equal((await request(server, path, { method: 'POST', body: {} })).status, 403);
  const options = { method: 'POST', headers: { Authorization: `Bearer ${room.token}` }, body: {} };
  const first = await (await request(server, path, options)).json(), second = await (await request(server, path, options)).json();
  assert.match(first.code, /^[a-z]{3}-[a-z]{3}-[a-z]{3}$/); assert.equal(first.code, second.code); assert.equal(first.token, room.token);
  assert.equal(new Document('reader', JSON.parse(readFileSync(filename)).state).text(), 'Private document');
});
test('invalid and unknown codes fail clearly, and repeated guesses are limited', async t => {
  const { server, advance } = await setup(t);
  const resolve = code => request(server, '/api/invitations/join', { method: 'POST', body: { code } });
  assert.equal((await resolve('../not-a-code')).status, 400);
  for (let n = 0; n < 10; n++) assert.equal((await resolve('zzz-zzz-zzz')).status, 404);
  assert.equal((await resolve('zzz-zzz-zzz')).status, 429);
  advance(60001); assert.equal((await resolve('zzz-zzz-zzz')).status, 404);
});
test('the code grants the existing invitation rather than bypassing the five-user limit', async t => {
  const { server, room } = await setup(t);
  const resolved = await (await request(server, '/api/invitations/join', { method: 'POST', body: { code: room.code } })).json();
  for (let n = 0; n < 6; n++) {
    const result = await request(server, `/api/rooms/${resolved.id}/sync`, { method: 'POST', headers: { Authorization: `Bearer ${resolved.token}` }, body: { user: `user-${n}`, state: new Document('reader').snapshot() } });
    assert.equal(result.status, n < 5 ? 200 : 409);
  }
});
test('short links, typed codes, and legacy links are parsed without exposing tokens in new links', () => {
  assert.equal(normalizeCode(' XYZ-JNK-DVC '), 'xyz-jnk-dvc');
  assert.equal(invitationLink('http://192.168.1.10:3000', 'xyz-jnk-dvc'), 'http://192.168.1.10:3000/xyz-jnk-dvc');
  assert.deepEqual(invitationFromLocation({ pathname: '/xyz-jnk-dvc', hash: '' }), { code: 'xyz-jnk-dvc' });
  assert.deepEqual(invitationFromLocation({ pathname: '/', hash: '#room=old-id&token=old-token' }), { room: { id: 'old-id', token: 'old-token' } });
  assert.equal(invitationFromLocation({ pathname: '/', hash: '' }), null);
  assert.throws(() => normalizeCode('invalid'), /Enter a code/);
});
