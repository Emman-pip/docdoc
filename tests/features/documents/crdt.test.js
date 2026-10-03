import test from 'node:test';
import assert from 'node:assert/strict';
import { Document } from '../../../public/features/documents/crdt.js';

test('concurrent inserts and deletes converge without losing either user’s new text', () => {
  const seed = new Document('seed'); seed.edit('hello');
  const alice = new Document('alice', seed.snapshot()), bob = new Document('bob', seed.snapshot());
  alice.edit('hello Alice'); bob.edit('hllo Bob');
  const a = alice.snapshot(), b = bob.snapshot();
  alice.merge(b); bob.merge(a);
  assert.equal(alice.text(), bob.text());
  assert.match(alice.text(), /Alice/); assert.match(alice.text(), /Bob/);
  assert.equal(alice.text().startsWith('hllo'), true);
  alice.merge(b); assert.equal(alice.text(), bob.text());
});

test('out-of-order character insertion and tombstones resolve when parents arrive', () => {
  const seed = new Document('seed'); seed.edit('ab');
  const snapshot = seed.snapshot(), remote = new Document('remote');
  remote.merge({ nodes: [snapshot.nodes[1]], deleted: [snapshot.nodes[0].id] });
  assert.equal(remote.text(), '');
  remote.merge({ nodes: [snapshot.nodes[0]], deleted: [] });
  assert.equal(remote.text(), 'b');
});

test('five offline replicas converge after reordered and duplicate full-state deliveries', () => {
  const seed = new Document('seed'); seed.edit('A shared document.');
  const peers = Array.from({ length: 5 }, (_, i) => new Document(`user-${i}`, seed.snapshot()));
  const snapshots = [];
  for (let turn = 0; turn < 25; turn++) {
    const peer = peers[turn % 5], text = peer.text(), index = (turn * 7) % (text.length + 1);
    peer.edit(text.slice(0, index) + String(turn) + text.slice(index + (turn % 3 === 0 ? 1 : 0)));
    snapshots.push(peer.snapshot());
  }
  for (let i = 0; i < peers.length; i++) {
    const ordered = i % 2 ? [...snapshots].reverse() : snapshots;
    for (const snapshot of [...ordered, ...ordered]) peers[i].merge(snapshot);
  }
  assert.equal(new Set(peers.map(peer => peer.text())).size, 1);
  const reopened = new Document('reopened', JSON.parse(JSON.stringify(peers[0].snapshot())));
  assert.equal(reopened.text(), peers[0].text());
});

test('concurrent renames resolve deterministically and invalid state is rejected', () => {
  const a = new Document('a'), b = new Document('b'); a.rename('One'); b.rename('Two');
  a.merge(b.snapshot()); b.merge(a.snapshot());
  assert.equal(a.title.value, 'Two'); assert.equal(b.title.value, 'Two');
  assert.throws(() => a.merge({ nodes: [{ id: 'bad' }], deleted: [] }), /Invalid/);
});
