import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { request } from './request-helper.js';
import { fixture } from './folder-fixture.js';
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
