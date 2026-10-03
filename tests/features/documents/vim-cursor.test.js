import test from 'node:test';
import assert from 'node:assert/strict';
import { attachVimCursor } from '../../../public/features/documents/vim-cursor.js';
function setup(t) {
  const originals = new Map(['document', 'window', 'getComputedStyle', 'requestAnimationFrame', 'ResizeObserver'].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of originals) globalThis[key] = value; });
  const events = new Map(), callbacks = [];
  const editor = { value: 'hello world', selectionStart: 0, selectionEnd: 0, selectionDirection: 'forward', clientWidth: 100, clientHeight: 40, scrollTop: 0, scrollLeft: 0, dataset: {}, getClientRects: () => [1], addEventListener(type, callback) { events.set(type, callback); } };
  const mirror = { style: {}, replaceChildren(...children) { this.children = children; }, getBoundingClientRect: () => ({ top: 100, left: 50 }) };
  const block = { hidden: true, style: {}, getBoundingClientRect() { const top = 100 + parseFloat(this.style.top); return { top, bottom: top + parseFloat(this.style.height) }; }, scrollIntoView(options) { this.revealed = options; } };
  globalThis.document = {
    activeElement: editor, addEventListener() {}, createTextNode: text => ({ textContent: text }),
    createElement: () => ({ getBoundingClientRect() { const index = mirror.children[0].textContent.length; return { top: 100 + Math.floor(index / 10) * 20, left: 50 + index % 10 * 10, width: 10, height: 18 }; } }),
  };
  globalThis.window = { innerHeight: 200, addEventListener() {} };
  globalThis.getComputedStyle = () => ({ fontSize: '16px', lineHeight: '20px' });
  globalThis.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
  globalThis.ResizeObserver = class { observe() {} };
  const cursor = attachVimCursor(editor, block, mirror), flush = () => { while (callbacks.length) callbacks.shift()(); };
  return { editor, block, mirror, cursor, events, flush };
}
test('Vim draws a solid caret at the cursor and tracks movement without selecting document text', t => {
  const { editor, block, mirror, cursor, flush } = setup(t);
  cursor.setMode('normal'); flush(); assert.equal(block.hidden, false); assert.equal(block.style.left, '0px'); assert.equal(block.style.width, '2px');
  editor.selectionStart = 4; cursor.update(); flush(); assert.equal(block.style.left, '40px'); assert.equal(mirror.children[1].textContent, 'o');
  assert.equal(editor.value, 'hello world'); assert.equal(editor.selectionStart, 4);
  cursor.setMode('insert'); flush(); assert.equal(block.hidden, false);
  cursor.setMode('visual'); editor.selectionEnd = 6; cursor.update(); flush(); assert.equal(block.hidden, false); assert.equal(block.style.left, '60px');
  cursor.setMode('off'); flush(); assert.equal(block.hidden, true);
});
test('the caret follows scroll offsets, shows empty documents, and hides when the editor loses focus', t => {
  const { editor, block, cursor, flush } = setup(t);
  editor.selectionStart = 10; editor.scrollTop = 5; editor.scrollLeft = 2;
  cursor.setMode('normal'); flush(); assert.equal(block.style.left, '-2px'); assert.equal(block.style.top, '15px');
  editor.value = ''; editor.selectionStart = 0; editor.scrollTop = 0; editor.scrollLeft = 0; cursor.update(); flush(); assert.equal(block.hidden, false); assert.equal(block.style.width, '2px');
  document.activeElement = null; cursor.update(); flush(); assert.equal(block.hidden, true);
});
test('keyboard navigation scrolls the page caret into view and preview hides it', t => {
  const { editor, block, cursor, events, flush } = setup(t);
  editor.value = 'x'.repeat(100); editor.selectionStart = 50;
  cursor.setMode('normal'); flush(); events.get('keydown')(); flush();
  assert.equal(editor.scrollTop, 0); assert.equal(block.style.top, '100px'); assert.deepEqual(block.revealed, { block: 'nearest', inline: 'nearest', behavior: 'auto' });
  editor.getClientRects = () => []; cursor.update(); flush(); assert.equal(block.hidden, true);
});
