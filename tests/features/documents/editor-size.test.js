import test from 'node:test';
import assert from 'node:assert/strict';
import { attachEditorSize } from '../../../public/features/documents/editor-size.js';
function setup(t) {
  const originals = new Map(['window', 'document', 'getComputedStyle', 'ResizeObserver'].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of originals) globalThis[key] = value; });
  let observed, visible = true;
  const editor = { value: '', clientWidth: 500, scrollHeight: 380, scrollTop: 100, scrollLeft: 0, style: {}, getClientRects: () => visible ? [1] : [], addEventListener() {} };
  globalThis.window = { scrollY: 100, addEventListener() {}, scrollTo() {} };
  globalThis.document = {};
  globalThis.getComputedStyle = () => ({ borderTopWidth: '0px', borderBottomWidth: '0px' });
  globalThis.ResizeObserver = class { constructor(callback) { observed = callback; } observe() {} };
  const sizing = attachEditorSize(editor);
  return { editor, sizing, resize: () => observed(), hide: value => visible = !value };
}
test('the editor grows to display every line and shrinks after deleting content', t => {
  const { editor, sizing } = setup(t);
  sizing.fit(); assert.equal(editor.style.height, '380px'); assert.equal(editor.scrollTop, 0);
  editor.value = 'line\n'.repeat(200); editor.scrollHeight = 6400; sizing.fit(); assert.equal(editor.style.height, '6400px');
  editor.value = 'short document'; editor.scrollHeight = 380; sizing.fit(); assert.equal(editor.style.height, '380px');
});
test('width changes remeasure wrapped text, hidden editors wait until visible, and height notifications do not loop', t => {
  const { editor, sizing, resize, hide } = setup(t); editor.value = 'A long paragraph';
  sizing.fit(); editor.clientWidth = 200; editor.scrollHeight = 900; resize(); assert.equal(editor.style.height, '900px');
  editor.scrollHeight = 901; resize(); assert.equal(editor.style.height, '900px');
  hide(true); editor.value = 'Another longer paragraph'; editor.scrollHeight = 1200; sizing.fit(); assert.equal(editor.style.height, '900px');
  hide(false); resize(); assert.equal(editor.style.height, '1200px');
});
