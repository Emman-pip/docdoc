import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server.js';
import { Document } from '../public/crdt.js';
import { request } from './request-helper.js';
import { emptyPolicy, normalizeIP, normalizeMAC, validatePolicy, macFromARP } from '../src/access-control.js';
async function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'docdoc-access-')); t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const lookupMAC = ip => ip === '192.168.1.20' ? 'aa:bb:cc:dd:ee:ff' : null;
  const server = createApp({ dataDir, lookupMAC }), doc = new Document('owner'); doc.edit('Private words');
  const room = await (await request(server, '/api/rooms', { method: 'POST', body: { state: doc.snapshot() } })).json();
  const headers = { Authorization: `Bearer ${room.token}` }, ownerHeaders = { ...headers, 'X-Owner-Key': room.ownerToken };
  async function set(policy) { return request(server, `/api/rooms/${room.id}/access`, { method: 'POST', headers: ownerHeaders, body: { action: 'set', policy: { ...emptyPolicy(), enabled: true, ...policy } } }); }
  async function sync({ ip = '192.168.1.99', name = 'Bob', user = 'bob', extra = {}, owner = false } = {}) {
    return request(server, `/api/rooms/${room.id}/sync`, { method: 'POST', remoteAddress: ip, headers: { ...(owner ? ownerHeaders : headers), ...extra }, body: { user, name, state: new Document(user).snapshot() } });
  }
  return { server, dataDir, lookupMAC, room, headers, ownerHeaders, set, sync };
}

test('IP rules use the real peer, normalize IPv4-mapped IPv6, and ignore forged forwarding headers', async t => {
  const { set, sync } = await setup(t); assert.equal((await set({ ips: ['192.168.1.20'] })).status, 200);
  assert.equal((await sync({ ip: '::ffff:192.168.1.20' })).status, 200);
  const denied = await sync({ extra: { 'X-Forwarded-For': '192.168.1.20', 'X-Real-IP': '192.168.1.20' } });
  assert.equal(denied.status, 403); assert.equal((await denied.json()).state, undefined);
  assert.equal((await sync({ owner: true })).status, 200);
});
test('username and detected MAC rules match independently; unverified MAC claims never grant access', async t => {
  const { set, sync } = await setup(t);
  await set({ usernames: ['Alice'], macs: ['AA-BB-CC-DD-EE-FF'] });
  assert.equal((await sync({ name: ' ALICE ' })).status, 200);
  assert.equal((await sync({ ip: '192.168.1.20', name: 'Other' })).status, 200);
  assert.equal((await sync({ extra: { 'X-MAC-Address': 'aa:bb:cc:dd:ee:ff' } })).status, 403);
  assert.equal((await sync({ name: 'Eve' })).status, 403);
});
test('only the owner key can manage policy and the key is never included in join responses', async t => {
  const { server, room, headers, set } = await setup(t);
  const edit = await request(server, `/api/rooms/${room.id}/access`, { method: 'POST', headers, body: { action: 'set', policy: emptyPolicy(), ownerToken: room.ownerToken } }); assert.equal(edit.status, 403);
  const join = await request(server, '/api/invitations/join', { method: 'POST', body: { code: room.code, name: 'Alice' } }); assert.equal((await join.json()).ownerToken, undefined);
  const changed = await set({ usernames: ['Alice'] }); assert.equal(changed.status, 200);
  assert.equal((await request(server, '/api/invitations/join', { method: 'POST', body: { code: room.code, name: 'Eve' } })).status, 403);
  assert.equal((await request(server, '/api/invitations/join', { method: 'POST', body: { code: room.code, name: 'Alice' } })).status, 200);
  const invitation = await request(server, `/api/rooms/${room.id}/invitation`, { method: 'POST', headers, body: { name: 'Alice' } }); assert.equal((await invitation.json()).ownerToken, undefined);
});
test('whitelists protect file listings, uploads, downloads, and text; owners retain access', async t => {
  const { server, room, headers, ownerHeaders, set } = await setup(t), path = `/api/rooms/${room.id}/files`;
  const file = await (await request(server, `${path}?user=owner&name=Owner`, { method: 'POST', headers: { ...ownerHeaders, 'X-File-Name': 'file.txt' }, rawBody: 'secret' })).json();
  await set({ usernames: ['Alice'] });
  for (const [url, method] of [[`${path}?user=eve&name=Eve`, 'GET'], [`${path}?user=eve&name=Eve`, 'POST'], [`${path}/${file.file.id}?user=eve&name=Eve`, 'GET']]) {
    const denied = await request(server, url, { method, headers: { ...headers, 'X-File-Name': 'denied.txt' }, rawBody: method === 'POST' ? 'blocked' : undefined }); assert.equal(denied.status, 403);
  }
  assert.equal((await request(server, `${path}?user=alice&name=Alice`, { headers })).status, 200);
  assert.equal((await request(server, `${path}?user=owner&name=Owner`, { headers: ownerHeaders })).status, 200);
});
test('revoking access during an upload rejects the file before it is stored', async t => {
  const { server, room, headers, dataDir, set } = await setup(t); await set({ usernames: ['Alice'] });
  let started, release;
  const ready = new Promise(resolve => started = resolve), gate = new Promise(resolve => release = resolve);
  async function* chunks() { started(); await gate; yield Buffer.from('secret'); }
  const upload = request(server, `/api/rooms/${room.id}/files?user=alice&name=Alice`, { method: 'POST', headers: { ...headers, 'X-File-Name': 'revoked.txt' }, rawChunks: chunks() });
  await ready; await set({}); release(); assert.equal((await upload).status, 403);
  const saved = JSON.parse(readFileSync(join(dataDir, `${room.id}.json`), 'utf8')); assert.equal(saved.files.length, 0);
});
test('policy persists across restart, invalid settings do not replace it, and disabling restores invitation access', async t => {
  const { server, room, dataDir, lookupMAC, headers, set, sync } = await setup(t);
  await set({ ips: ['192.168.1.20'] }); assert.equal((await set({ ips: ['not-an-ip'] })).status, 400);
  assert.equal((await sync()).status, 403);
  const restarted = createApp({ dataDir, lookupMAC });
  const denied = await request(restarted, `/api/rooms/${room.id}/sync`, { method: 'POST', headers, remoteAddress: '192.168.1.99', body: { user: 'eve', name: 'Eve', state: new Document('eve').snapshot() } }); assert.equal(denied.status, 403);
  await set({ enabled: false }); assert.equal((await sync()).status, 200);
});
test('legacy sessions receive an owner key on the host without granting control to old invite holders', async t => {
  const { dataDir, room, headers } = await setup(t), path = join(dataDir, `${room.id}.json`);
  const saved = JSON.parse(readFileSync(path)); delete saved.ownerToken; writeFileSync(path, JSON.stringify(saved));
  const restarted = createApp({ dataDir });
  const denied = await request(restarted, `/api/rooms/${room.id}/access`, { method: 'POST', headers, body: { action: 'get' } }); assert.equal(denied.status, 403);
  const recovered = JSON.parse(readFileSync(path)).ownerToken; assert.match(recovered, /^[a-f0-9]{64}$/);
  const owner = await request(restarted, `/api/rooms/${room.id}/access`, { method: 'POST', headers: { ...headers, 'X-Owner-Key': recovered }, body: { action: 'get' } }); assert.equal(owner.status, 200);
});
test('IP, MAC, username, and ARP validation handle supported formats and fail closed', () => {
  assert.equal(normalizeIP('2001:0db8:0:0::1'), '2001:db8::1'); assert.equal(normalizeIP('::ffff:c0a8:114'), '192.168.1.20'); assert.equal(normalizeIP('192.168.1.20:3000'), null);
  assert.equal(normalizeMAC('AA-BB-CC-DD-EE-FF'), 'aa:bb:cc:dd:ee:ff'); assert.equal(normalizeMAC('00:00:00:00:00:00'), null);
  assert.throws(() => validatePolicy({ ...emptyPolicy(), macs: ['bad'] }), /Invalid/);
  assert.throws(() => validatePolicy({ ...emptyPolicy(), usernames: [''] }), /Invalid/);
  const arp = 'IP address HW type Flags HW address Mask Device\n192.168.1.20 0x1 0x2 aa:bb:cc:dd:ee:ff * eth0\n192.168.1.21 0x1 0x0 00:00:00:00:00:00 * eth0';
  assert.equal(macFromARP('192.168.1.20', arp), 'aa:bb:cc:dd:ee:ff'); assert.equal(macFromARP('192.168.1.21', arp), null); assert.equal(macFromARP('192.168.1.99', arp), null);
});
