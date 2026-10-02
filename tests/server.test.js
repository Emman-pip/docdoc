import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from './request-helper.js';
import { createApp } from '../src/server.js';
import { Document } from '../public/crdt.js';

async function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'docdoc-test-'));
  let time = 1000;
  const server = createApp({ dataDir, now: () => time });
  const origin = 'http://localhost:3000';
  t.after(() => { rmSync(dataDir, { recursive: true, force: true }); });
  async function post(path, body, token, extra = {}) {
    const response = await request(server, path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body });
    return { status: response.status, body: await response.json() };
  }
  return { server, origin, post, dataDir, advance: n => { time += n; } };
}

test('enforces five distinct users, allows repeated tabs, rejects sixth before merging, and expires inactive slots', async t => {
  const { post, advance } = await fixture(t);
  const doc = new Document('owner'); doc.edit('private content');
  const created = await post('/api/rooms', { state: doc.snapshot() });
  assert.equal(created.status, 201);
  const { id, token } = created.body, path = `/api/rooms/${id}/sync`;
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => post(path, { user: `user-${i}`, state: doc.snapshot() }, token)));
  assert.equal(results.filter(result => result.status === 200).length, 5);
  assert.equal(results.filter(result => result.status === 409).length, 1);
  const accepted = results.findIndex(result => result.status === 200), rejected = results.findIndex(result => result.status === 409);
  const duplicate = await post(path, { user: `user-${accepted}`, state: doc.snapshot() }, token);
  assert.equal(duplicate.status, 200); assert.equal(duplicate.body.users.length, 5);
  const changed = new Document('sixth', doc.snapshot()); changed.edit('SHOULD NOT MERGE');
  assert.equal((await post(path, { user: `user-${rejected}`, state: changed.snapshot() }, token)).status, 409);
  const retained = await post(path, { user: `user-${accepted}`, state: doc.snapshot() }, token);
  assert.equal(new Document('reader', retained.body.state).text(), 'private content');
  advance(16000);
  assert.equal((await post(path, { user: 'new-user', state: doc.snapshot() }, token)).status, 200);
});

test('requires an invitation and rejects cross-origin requests and malformed state', async t => {
  const { post } = await fixture(t);
  const doc = new Document('owner'); doc.edit('secret');
  const { body: room } = await post('/api/rooms', { state: doc.snapshot() });
  const path = `/api/rooms/${room.id}/sync`;
  const denied = await post(path, { user: 'stranger', state: doc.snapshot() });
  assert.equal(denied.status, 403); assert.equal(denied.body.state, undefined);
  assert.equal((await post(path, { user: 'owner', state: doc.snapshot() }, room.token, { Origin: 'http://attacker.example' })).status, 403);
  assert.equal((await post(path, { user: 'owner', state: { nodes: [{}], deleted: [] } }, room.token)).status, 400);
  const good = await post(path, { user: 'owner', state: doc.snapshot() }, room.token);
  assert.equal(new Document('reader', good.body.state).text(), 'secret');
});

test('offline edits merge after reconnection and host snapshots survive a restart', async t => {
  const { post, dataDir } = await fixture(t);
  const original = new Document('owner'); original.edit('Start');
  const { body: room } = await post('/api/rooms', { state: original.snapshot() });
  const path = `/api/rooms/${room.id}/sync`;
  const alice = new Document('alice', original.snapshot()), bob = new Document('bob', original.snapshot());
  alice.edit('Start Alice'); bob.edit('Start Bob');
  await post(path, { user: 'alice', state: alice.snapshot() }, room.token);
  const synced = await post(path, { user: 'bob', state: bob.snapshot() }, room.token);
  alice.merge(synced.body.state); bob.merge(synced.body.state);
  assert.equal(alice.text(), bob.text()); assert.match(alice.text(), /Alice/); assert.match(alice.text(), /Bob/);
  const restarted = createApp({ dataDir });
  const response = await request(restarted, path, { method: 'POST', headers: { Authorization: `Bearer ${room.token}` }, body: { user: 'reopened', state: original.snapshot() } });
  assert.equal(response.status, 200);
  assert.equal(new Document('reader', (await response.json()).state).text(), alice.text());
});

test('serves local assets without a CDN and blocks unknown paths', async t => {
  const { server } = await fixture(t);
  const page = await request(server, '/'); assert.equal(page.status, 200); assert.match(await page.text(), /docdoc/);
  const script = await request(server, '/crdt.js'); assert.match(script.headers.get('content-type'), /javascript/);
  assert.equal((await request(server, '/missing')).status, 404);
});
