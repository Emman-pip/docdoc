import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { Document } from '../public/crdt.js';
import { request } from './request-helper.js';
export async function fixture(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'docdoc-folders-')); t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const server = createApp({ dataDir, ...options });
  const room = await (await request(server, '/api/rooms', { method: 'POST', body: { state: new Document('owner').snapshot() } })).json();
  const headers = { Authorization: `Bearer ${room.token}`, 'X-Owner-Key': room.ownerToken }, base = `/api/rooms/${room.id}`;
  const call = (route, body, auth = headers) => request(server, `${base}/${route}?user=owner&name=Alice`, { method: 'POST', headers: auth, body });
  const root = (await (await call('folders', { action: 'create', name: 'Private parent' })).json()).folder;
  const folder = (await (await call('folders', { action: 'create', name: 'Shared', parentId: root.id })).json()).folder;
  const invitation = (await (await call('folder-invitations', { action: 'create', folderId: folder.id })).json()).invitations[0];
  const guest = await (await request(server, '/api/invitations/join', { method: 'POST', body: { code: invitation.code, user: 'guest', name: 'Alice' } })).json();
  return { server, dataDir, room, headers, base, call, root, folder, invitation, guest, guestHeaders: { Authorization: `Bearer ${guest.token}` } };
}
test('folder invitations persist, hide ancestors and document credentials, and cannot authorize document routes', async t => {
  const f = await fixture(t); const { server, base, guest, guestHeaders, folder, dataDir } = f;
  assert.equal(guest.kind, 'folder'); assert.notEqual(guest.token, f.room.token); assert.equal(guest.ownerToken, undefined);
  for (const route of ['sync', 'access', 'invitation', 'folder-invitations']) assert.equal((await f.call(route, { user: 'guest', action: 'get' }, guestHeaders)).status, 403);
  const list = await (await request(server, `${base}/files?user=guest`, { headers: guestHeaders })).json();
  assert.deepEqual(list.folders, [{ ...folder, parentId: null }]); assert.equal(JSON.stringify(list).includes(f.root.id), false);
  assert.equal((await f.call('folders', { action: 'create', name: 'Denied', parentId: f.root.id }, guestHeaders)).status, 403);
  assert.equal((await f.call('folders', { action: 'create', name: 'Allowed', parentId: folder.id }, guestHeaders)).status, 200);
  const restarted = createApp({ dataDir });
  assert.equal((await request(restarted, `${base}/files?user=guest`, { headers: guestHeaders })).status, 200);
  await f.call('folder-invitations', { action: 'revoke', code: guest.code });
  assert.equal((await request(server, `${base}/files?user=guest`, { headers: guestHeaders })).status, 403);
  assert.equal((await request(server, '/api/invitations/join', { method: 'POST', body: { code: guest.code, user: 'guest' } })).status, 404);
});
test('folder guests obey whitelist and share document admission capacity', async t => {
  const f = await fixture(t);
  await f.call('access', { action: 'set', policy: { enabled: true, usernames: ['Alice'], ips: [], macs: [] } });
  assert.equal((await request(f.server, `${f.base}/files?user=guest&name=Eve`, { headers: f.guestHeaders })).status, 403);
  for (let i = 0; i < 3; i++) assert.equal((await request(f.server, `${f.base}/files?user=user${i}&name=Alice`, { headers: f.guestHeaders })).status, 200);
  assert.equal((await request(f.server, `${f.base}/files?user=sixth&name=Alice`, { headers: f.headers })).status, 409);
});
