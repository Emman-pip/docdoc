import test from 'node:test';
import assert from 'node:assert/strict';
import { generateUsername, initializeUsername } from '../public/usernames.js';

function storage(initial) {
  const data = new Map(initial === undefined ? [] : [['docdoc.name', initial]]);
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test('generated names combine words and a zero-padded four-digit suffix', () => {
  assert.equal(generateUsername([0, 0, 239]), 'GuiltyPride0239');
  assert.match(generateUsername([4294967295, 4294967295, 4294967295]), /^[A-Z][a-z]+[A-Z][a-z]+\d{4}$/);
});
test('a new name persists across visits', () => {
  const saved = storage();
  const name = initializeUsername(saved);
  assert.match(name, /^[A-Z][a-z]+[A-Z][a-z]+\d{4}$/);
  assert.equal(initializeUsername(saved), name);
});
test('legacy and blank defaults are replaced while custom names remain unchanged', () => {
  for (const initial of ['You', '', '   ']) assert.notEqual(initializeUsername(storage(initial)), initial);
  assert.equal(initializeUsername(storage('Alice')), 'Alice');
});
