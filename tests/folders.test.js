import test from 'node:test';
import assert from 'node:assert/strict';
import { manageFolders, inventory, within } from '../src/folders.js';
test('nested folders validate names and references, reject cycles, and preserve scoped ancestry', () => {
  const room = {}, options = { owner: true, save() {} };
  const a = manageFolders(room, { action: 'create', name: 'A' }, options).folder;
  const b = manageFolders(room, { action: 'create', name: 'B', parentId: a.id }, options).folder;
  assert.equal(within(room, b.id, a.id), true);
  assert.throws(() => manageFolders(room, { action: 'move', id: a.id, parentId: b.id }, options), /contain itself/);
  for (const name of ['..', 'a/b', 'a\\b', '', ' leading']) assert.throws(() => manageFolders(room, { action: 'create', name }, options), /Invalid name/);
  assert.throws(() => manageFolders(room, { action: 'create', name: 'X', parentId: 'missing' }, options), /unavailable/);
  assert.throws(() => manageFolders(room, { action: 'delete', id: a.id }, options), /empty folders/);
  const scoped = inventory(room, b.id); assert.deepEqual(scoped.folders, [{ ...b, parentId: null }]);
  manageFolders(room, { action: 'rename', id: b.id, name: 'Renamed' }, options);
  manageFolders(room, { action: 'move', id: b.id, parentId: null }, options);
  manageFolders(room, { action: 'delete', id: a.id }, options); assert.equal(room.folders.length, 1);
});
test('folder saves roll back on failure and guests can only create within their scope', () => {
  const room = { folders: [{ id: 'scope', name: 'Shared', parentId: null }] };
  const options = { scope: 'scope', save() {}, owner: false };
  assert.throws(() => manageFolders(room, { action: 'create', name: 'Oops', parentId: null }, options), /outside/);
  assert.throws(() => manageFolders(room, { action: 'rename', id: 'scope', name: 'Oops' }, options), /owner/);
  assert.throws(() => manageFolders(room, { action: 'create', name: 'Oops' }, { ...options, save() { throw Error('disk'); } }), /disk/);
  assert.equal(room.folders.length, 1);
});
