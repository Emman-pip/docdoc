// A deliberately small Vim layer for the existing textarea and CRDT edit path.
export function attachVim(editor, { onEdit, onUndo, onMode }) {
  let enabled = false, mode = 'normal', pending = '', count = '', anchor = 0, preferredColumn = null, register = '', linewise = false;
  const startOfLine = position => position <= 0 ? 0 : editor.value.lastIndexOf('\n', position - 1) + 1;
  const endOfLine = position => { const end = editor.value.indexOf('\n', position); return end < 0 ? editor.value.length : end; };
  const cursor = () => mode === 'visual' ? (editor.selectionDirection === 'backward' ? editor.selectionStart : Math.max(editor.selectionStart, editor.selectionEnd - 1)) : editor.selectionStart;
  function setMode(next) { mode = next; pending = ''; count = ''; preferredColumn = null; editor.readOnly = enabled && mode !== 'insert'; onMode(enabled ? mode : 'off'); }
  function move(position, vertical = false) {
    position = Math.max(0, Math.min(editor.value.length, position));
    if (mode === 'visual') editor.setSelectionRange(Math.min(anchor, position), Math.min(editor.value.length, Math.max(anchor, position) + 1), position < anchor ? 'backward' : 'forward');
    else editor.setSelectionRange(position, position);
    if (!vertical) preferredColumn = null;
  }
  function replace(start, end, value) {
    editor.setRangeText(value, start, end, 'end'); onEdit();
    if (mode !== 'insert') move(Math.min(start, editor.value.length));
  }
  function motion(key, position, repeat) {
    for (let step = 0; step < repeat; step++) {
      if (key === 'h') position = Math.max(startOfLine(position), position - 1);
      else if (key === 'l') position = Math.min(endOfLine(position), position + 1);
      else if (key === '0') position = startOfLine(position);
      else if (key === '^') position = startOfLine(position) + (editor.value.slice(startOfLine(position), endOfLine(position)).match(/^\s*/)?.[0].length || 0);
      else if (key === '$') position = Math.max(startOfLine(position), endOfLine(position) - 1);
      else if (key === 'w') { const match = editor.value.slice(position).match(/^(?:\w+|[^\w\s]+)?\s*/); position += match?.[0].length || 1; }
      else if (key === 'b') { const prefix = editor.value.slice(0, position).replace(/\s+$/, ''); const match = prefix.match(/(?:\w+|[^\w\s]+)$/); position = prefix.length - (match?.[0].length || 0); }
      else if (key === 'j' || key === 'k') {
        const column = preferredColumn ?? position - startOfLine(position); preferredColumn = column;
        if (key === 'j' && endOfLine(position) < editor.value.length) { const next = endOfLine(position) + 1; position = Math.min(next + column, endOfLine(next)); }
        if (key === 'k' && startOfLine(position) > 0) { const end = startOfLine(position) - 1, previous = startOfLine(end); position = Math.min(previous + column, end); }
      }
    }
    return Math.max(0, Math.min(editor.value.length, position));
  }
  editor.addEventListener('keydown', event => {
    if (!enabled || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === 'Escape') { event.preventDefault(); const position = cursor(), next = mode === 'insert' ? Math.max(startOfLine(position), position - 1) : position; setMode('normal'); move(next); return; }
    if (mode === 'insert' || key === 'Tab') return;
    if (key.length > 1 && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Backspace', 'Delete', 'Enter'].includes(key)) return;
    event.preventDefault();
    if (/^[1-9]$/.test(key) || (key === '0' && count)) { count = (count + key).slice(0, 3); return; }
    const repeat = Math.min(Number(count) || 1, 999), position = cursor();
    const motions = { ArrowLeft: 'h', ArrowRight: 'l', ArrowUp: 'k', ArrowDown: 'j', Home: '0', End: '$' };
    const command = motions[key] || key;
    if (pending) {
      const operator = pending; pending = ''; count = '';
      if (operator === 'g' && key === 'g') { move(0); return; }
      if (['d', 'y'].includes(operator)) {
        let start = position, end = position; linewise = false;
        if (key === operator) { start = startOfLine(position); end = start; for (let n = 0; n < repeat; n++) end = Math.min(editor.value.length, endOfLine(end) + 1); linewise = true; }
        else if (command === '$') end = endOfLine(position);
        else if ('hjklwb0^'.includes(command)) { end = motion(command, position, repeat); [start, end] = [Math.min(start, end), Math.max(start, end)]; }
        else return;
        register = editor.value.slice(start, end);
        if (linewise && !register.endsWith('\n')) register += '\n';
        const deletionStart = linewise && end === editor.value.length && !editor.value.endsWith('\n') && start > 0 ? start - 1 : start;
        if (operator === 'd') replace(deletionStart, end, '');
        return;
      }
      return;
    }
    count = '';
    if ('hjklwb0^$'.includes(command)) { move(motion(command, position, repeat), command === 'j' || command === 'k'); return; }
    if (key === 'g') { pending = 'g'; return; }
    if (key === 'G') { move(editor.value.length ? startOfLine(editor.value.length) : 0); return; }
    if (key === 'v') { if (mode === 'visual') { setMode('normal'); move(position); } else { anchor = position; setMode('visual'); move(position); } return; }
    if (mode === 'visual' && ['d', 'x', 'y'].includes(key)) {
      const start = editor.selectionStart, end = editor.selectionEnd; register = editor.value.slice(start, end); linewise = false;
      setMode('normal'); if (key !== 'y') replace(start, end, ''); else move(start); return;
    }
    if (key === 'd' || key === 'y') { pending = key; count = repeat > 1 ? String(repeat) : ''; return; }
    if (key === 'i' || key === 'a' || key === 'I' || key === 'A') {
      const next = key === 'a' ? Math.min(position + 1, endOfLine(position)) : key === 'I' ? motion('^', position, 1) : key === 'A' ? endOfLine(position) : position;
      setMode('insert'); move(next); return;
    }
    if (key === 'o' || key === 'O') {
      const next = key === 'o' ? endOfLine(position) : startOfLine(position);
      setMode('insert'); replace(next, next, '\n'); move(key === 'o' ? next + 1 : next); return;
    }
    if (key === 'x' || key === 'Delete') { register = editor.value.slice(position, Math.min(position + repeat, endOfLine(position))); linewise = false; replace(position, position + register.length, ''); return; }
    if (key === 'p' && register) {
      const next = linewise ? Math.min(editor.value.length, endOfLine(position) + 1) : Math.min(position + 1, editor.value.length);
      let text = register.repeat(repeat);
      if (linewise && next === editor.value.length && !editor.value.endsWith('\n')) text = '\n' + text.replace(/\n$/, '');
      replace(next, next, text); return;
    }
    if (key === 'u') { for (let n = 0; n < repeat; n++) onUndo(); }
  });
  return {
    setEnabled(value) { enabled = Boolean(value); setMode('insert'); },
    reset() { setMode('insert'); },
    setMode(next) {
      if (!enabled || !['insert', 'normal', 'visual'].includes(next)) return;
      const position = cursor();
      if (next === 'visual') anchor = position;
      setMode(next); move(position);
    },
    get enabled() { return enabled; },
    get mode() { return mode; },
  };
}

export function attachVimControls({ editor, toggle, indicator, selector, modeLabel, hint, onEdit, onUndo, readPreference, savePreference, onActivate = () => {}, onCursorMode = () => {} }) {
  const vim = attachVim(editor, {
    onEdit, onUndo,
    onMode(mode) {
      onCursorMode(mode);
      toggle.setAttribute('aria-pressed', String(mode !== 'off'));
      toggle.textContent = mode === 'off' ? 'Vim off' : 'Vim on';
      indicator.hidden = false;
      indicator.textContent = mode === 'off' ? 'Vim off · regular typing' : `VIM · ${mode.toUpperCase()}`;
      indicator.dataset.mode = mode;
      modeLabel.hidden = mode === 'off';
      if (mode !== 'off') selector.value = mode;
      hint.textContent = { off: 'Enable Vim for keyboard commands.', insert: 'Type normally · Esc for Normal mode', normal: 'i to type · v to select · hjkl to move', visual: 'hjkl to select · d to delete · Esc to leave' }[mode];
    },
  });
  let preference = false;
  try { preference = readPreference(); } catch {}
  vim.setEnabled(preference);
  selector.onchange = () => { vim.setMode(selector.value); onActivate(); editor.focus(); };
  toggle.onclick = () => {
    vim.setEnabled(!vim.enabled);
    try { savePreference(vim.enabled); } catch {}
    onActivate(); editor.focus();
  };
  return vim;
}
