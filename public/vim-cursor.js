// Mirror textarea layout to draw a solid caret even when the textarea is read-only.
export function attachVimCursor(editor, block, mirror) {
  let mode = 'off', frame = 0, reveal = false;
  const properties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textIndent', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'direction', 'overflowWrap', 'wordBreak'];
  function paint() {
    frame = 0;
    block.hidden = mode === 'off' || document.activeElement !== editor || !editor.getClientRects().length;
    if (block.hidden) { reveal = false; return; }
    const style = getComputedStyle(editor);
    for (const property of properties) mirror.style[property] = style[property];
    mirror.style.width = `${editor.clientWidth}px`;
    const index = mode === 'visual' && editor.selectionDirection !== 'backward' ? editor.selectionEnd : editor.selectionStart, character = String.fromCodePoint(editor.value.codePointAt(index) || 32);
    const marker = document.createElement('span');
    marker.textContent = character === '\n' ? '\u00a0' : character;
    mirror.replaceChildren(document.createTextNode(editor.value.slice(0, index)), marker, document.createTextNode(editor.value.slice(index + (character === '\n' ? 0 : character.length))));
    const rect = marker.getBoundingClientRect(), origin = mirror.getBoundingClientRect();
    const height = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.85;
    const textTop = rect.top - origin.top;
    block.style.left = `${rect.left - origin.left - editor.scrollLeft}px`;
    block.style.top = `${textTop - editor.scrollTop}px`;
    block.style.width = '2px';
    block.style.height = `${height}px`;
    if (reveal) {
      const caret = block.getBoundingClientRect();
      if (caret.top < 0 || caret.bottom > window.innerHeight) block.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    }
    reveal = false;
  }
  function update(shouldReveal = false) {
    reveal ||= shouldReveal;
    if (!frame) frame = requestAnimationFrame(paint);
  }
  for (const type of ['focus', 'blur', 'click', 'keyup', 'input', 'scroll']) editor.addEventListener(type, () => update());
  editor.addEventListener('keydown', () => update(true));
  document.addEventListener('selectionchange', () => update());
  window.addEventListener('resize', () => update());
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => update()).observe(editor);
  return { update, setMode(value) { mode = value; editor.dataset.vimMode = value; update(); } };
}
