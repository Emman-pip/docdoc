import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAccessControls } from '../public/access.js';
function setup(t, hasOwner = true) {
  const oldFetch = globalThis.fetch, oldDocument = globalThis.document;
  t.after(() => { globalThis.fetch = oldFetch; globalThis.document = oldDocument; });
  const element = () => ({ value: '', checked: false, hidden: false, disabled: false, children: [], append(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, showModal() { this.open = true; } });
  const elements = new Map(), $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const record = { room: { id: 'room', token: 'invite', ...(hasOwner ? { ownerToken: 'owner-key' } : {}) } }, calls = [];
  let persisted = 0, synced = 0;
  globalThis.document = { createElement: element };
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    if (options.headers['X-Owner-Key'] !== 'owner-key') return { ok: false, json: async () => ({ error: 'Only the session owner can manage the whitelist.' }) };
    const input = JSON.parse(options.body);
    return { ok: true, json: async () => ({ policy: input.policy || { enabled: false, ips: [], usernames: [], macs: [] }, connection: { ip: '192.168.1.10', mac: null }, participants: [{ name: 'Alice', ip: '192.168.1.20', mac: 'aa:bb:cc:dd:ee:ff' }] }) };
  };
  attachAccessControls({ $, getCurrent: () => record, ensureRoom: async () => record.room, getName: () => 'Owner', persist: () => persisted++, sync: () => synced++ });
  return { $, record, calls, get persisted() { return persisted; }, get synced() { return synced; } };
}
test('owners load settings, see participant addresses, and save entries without sharing their key', async t => {
  const fixture = setup(t), { $, calls } = fixture;
  await $('access-open').onclick(); assert.equal($('access-dialog').open, true); assert.equal($('access-save').disabled, false);
  assert.match($('access-participants').children[0].textContent, /Alice · 192.168.1.20/);
  $('access-enabled').checked = true; $('access-ips').value = '192.168.1.20, 192.168.1.21'; $('access-users').value = 'Alice\nBob'; $('access-macs').value = 'aa:bb:cc:dd:ee:ff';
  await $('access-save').onclick();
  const submitted = JSON.parse(calls.at(-1).options.body);
  assert.deepEqual(submitted.policy.ips, ['192.168.1.20', '192.168.1.21']); assert.deepEqual(submitted.policy.usernames, ['Alice', 'Bob']);
  assert.equal(submitted.ownerToken, undefined); assert.equal(calls.at(-1).options.headers['X-Owner-Key'], 'owner-key');
  assert.equal(fixture.synced, 1); assert.match($('access-status').textContent, /Whitelist enabled/);
});
test('old sessions require a valid recovered owner key before enabling settings and persist it only after validation', async t => {
  const fixture = setup(t, false), { $, record } = fixture;
  await $('access-open').onclick(); assert.equal($('access-key-section').hidden, false); assert.equal($('access-save').disabled, true);
  $('access-key').value = 'invalid'; await $('access-unlock').onclick(); assert.equal(fixture.persisted, 0); assert.equal(record.room.ownerToken, undefined); assert.equal($('access-save').disabled, true);
  $('access-key').value = 'owner-key'; await $('access-unlock').onclick(); assert.equal(record.room.ownerToken, 'owner-key'); assert.equal(fixture.persisted, 1); assert.equal($('access-key-section').hidden, true); assert.equal($('access-save').disabled, false);
});
