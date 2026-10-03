import test from 'node:test';
import assert from 'node:assert/strict';
import { attachVim, attachVimControls } from '../../../public/features/documents/vim.js';
import { Document } from '../../../public/features/documents/crdt.js';

function setup(text) {
  const listeners = new Map(), modes = [], doc = new Document('writer'), history = [];
  doc.edit(text);
  const editor = {
    value: text, selectionStart: 0, selectionEnd: 0, selectionDirection: 'forward', readOnly: false,
    addEventListener(type, listener) { listeners.set(type, listener); },
    setSelectionRange(start, end, direction = 'forward') { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; },
    setRangeText(value, start, end) { this.value = this.value.slice(0, start) + value + this.value.slice(end); this.setSelectionRange(start + value.length, start + value.length); },
  };
  const vim = attachVim(editor, {
    onEdit() { history.push(doc.text()); doc.edit(editor.value); },
    onUndo() { if (history.length) { doc.edit(history.pop()); editor.value = doc.text(); } },
    onMode(mode) { modes.push(mode); },
  });
  function key(value, options = {}) {
    const event = { key: value, preventDefault() { this.prevented = true; }, ...options };
    listeners.get('keydown')(event); return event;
  }
  return { editor, vim, key, modes, doc };
}

test('Vim is optional and insert mode permits regular typing; Escape restores normal mode', () => {
  const { editor, vim, key, modes } = setup('hello');
  assert.equal(key('x').prevented, undefined); assert.equal(editor.readOnly, false);
  vim.setEnabled(true); assert.equal(editor.readOnly, false); assert.equal(vim.mode, 'insert');
  key('Escape'); key('i'); assert.equal(editor.readOnly, false); assert.equal(key('a').prevented, undefined);
  key('Escape'); assert.equal(vim.mode, 'normal'); assert.equal(editor.readOnly, true);
  assert.equal(key('z').prevented, true);
  vim.setEnabled(false); assert.equal(editor.readOnly, false); assert.equal(modes.at(-1), 'off');
});

test('word and line motions, counts, and gg/G move the cursor without modifying text', () => {
  const { editor, vim, key } = setup('one two three\nshort\nlast'); vim.setEnabled(true); key('Escape');
  key('w'); assert.equal(editor.selectionStart, 4);
  key('2'); key('h'); assert.equal(editor.selectionStart, 2);
  key('0'); key('j'); assert.equal(editor.selectionStart, 14);
  key('$'); assert.equal(editor.selectionStart, 18);
  key('G'); assert.equal(editor.selectionStart, 20);
  key('g'); key('g'); assert.equal(editor.selectionStart, 0);
  assert.equal(editor.value, 'one two three\nshort\nlast');
});

test('delete, undo, yank, and paste use the document edit path', () => {
  const { editor, vim, key, doc } = setup('one\ntwo\nthree'); vim.setEnabled(true); key('Escape');
  key('d'); key('d'); assert.equal(editor.value, 'two\nthree'); assert.equal(doc.text(), editor.value);
  key('u'); assert.equal(editor.value, 'one\ntwo\nthree');
  key('g'); key('g'); key('y'); key('y'); key('p');
  assert.equal(editor.value, 'one\none\ntwo\nthree'); assert.equal(doc.text(), editor.value);
  key('g'); key('g'); key('2'); key('x'); assert.equal(editor.value, 'e\none\ntwo\nthree');
});

test('visual selection deletes selected characters; open-line commands enter insert mode', () => {
  const { editor, vim, key, doc } = setup('hello\nworld'); vim.setEnabled(true); key('Escape');
  key('v'); key('l'); key('l'); assert.equal(editor.value.slice(editor.selectionStart, editor.selectionEnd), 'hel');
  key('d'); assert.equal(editor.value, 'lo\nworld'); assert.equal(vim.mode, 'normal');
  key('o'); assert.equal(editor.value, 'lo\n\nworld'); assert.equal(vim.mode, 'insert'); assert.equal(doc.text(), editor.value);
  key('Escape'); key('O'); assert.equal(editor.value, 'lo\n\n\nworld');
});

test('composition, browser shortcuts, and Tab are left to the browser', () => {
  const { vim, key } = setup('hello'); vim.setEnabled(true);
  assert.equal(key('x', { isComposing: true }).prevented, undefined);
  assert.equal(key('c', { ctrlKey: true }).prevented, undefined);
  assert.equal(key('Tab').prevented, undefined);
});

test('deleting the last line removes its preceding newline and pasting restores a separate line', () => {
  const { editor, vim, key } = setup('one\ntwo'); vim.setEnabled(true); key('Escape');
  key('G'); key('d'); key('d'); assert.equal(editor.value, 'one');
  key('p'); assert.equal(editor.value, 'one\ntwo');
});

test('opening another document keeps Vim editable and announces Insert mode', () => {
  const { editor, vim, key, modes } = setup('hello'); vim.setEnabled(true);
  assert.equal(editor.readOnly, false); assert.equal(key('h').prevented, undefined);
  key('Escape'); assert.equal(editor.readOnly, true); assert.equal(modes.at(-1), 'normal');
  vim.reset(); assert.equal(editor.readOnly, false); assert.equal(modes.at(-1), 'insert');
  assert.equal(key('i').prevented, undefined);
});

test('the mode selector can enter Insert, Normal, and Visual modes without keyboard commands', () => {
  const { editor, vim, modes } = setup('hello'); vim.setEnabled(true);
  vim.setMode('normal'); assert.equal(editor.readOnly, true); assert.equal(modes.at(-1), 'normal');
  vim.setMode('insert'); assert.equal(editor.readOnly, false); assert.equal(modes.at(-1), 'insert');
  vim.setMode('visual'); assert.equal(modes.at(-1), 'visual'); assert.equal(editor.value.slice(editor.selectionStart, editor.selectionEnd), 'h');
  vim.setEnabled(false); assert.equal(editor.readOnly, false); assert.equal(modes.at(-1), 'off');
});

test('visible controls restore Vim in Insert mode, announce every mode, and let a user resume typing', () => {
  const { editor } = setup('hello'), listeners = new Map();
  editor.addEventListener = (type, callback) => listeners.set(type, callback); editor.focus = () => {};
  const element = () => ({ hidden: false, dataset: {}, setAttribute() {} });
  const indicator = element(), toggle = element(), selector = element(), modeLabel = element(), hint = element();
  let saved, activated = 0;
  const vim = attachVimControls({ editor, indicator, toggle, selector, modeLabel, hint, onEdit() {}, onUndo() {}, readPreference: () => true, savePreference: enabled => saved = enabled, onActivate: () => activated++ });
  assert.equal(indicator.textContent, 'VIM · INSERT'); assert.equal(indicator.hidden, false); assert.equal(editor.readOnly, false);
  listeners.get('keydown')({ key: 'Escape', preventDefault() {} });
  assert.equal(indicator.textContent, 'VIM · NORMAL'); assert.equal(selector.value, 'normal');
  selector.value = 'visual'; selector.onchange(); assert.equal(indicator.textContent, 'VIM · VISUAL');
  selector.value = 'insert'; selector.onchange(); assert.equal(indicator.textContent, 'VIM · INSERT'); assert.equal(editor.readOnly, false);
  toggle.onclick(); assert.equal(saved, false); assert.equal(editor.readOnly, false); assert.equal(indicator.textContent, 'Vim off · regular typing');
  toggle.onclick(); assert.equal(saved, true); assert.equal(vim.mode, 'insert'); assert.equal(editor.readOnly, false);
  assert.equal(activated, 4);
});
