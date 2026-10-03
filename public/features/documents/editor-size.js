// Keep the whole document in the page flow instead of a nested scrolling textarea.
export function attachEditorSize(editor) {
  let previousText, previousWidth;
  function fit() {
    if (!editor.getClientRects().length) return;
    const width = editor.clientWidth;
    if (editor.value === previousText && width === previousWidth) return;
    previousText = editor.value; previousWidth = width;
    const scroll = window.scrollY;
    const style = getComputedStyle(editor);
    const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    editor.style.height = 'auto';
    editor.style.height = `${Math.ceil(editor.scrollHeight + borders)}px`;
    editor.scrollTop = 0; editor.scrollLeft = 0;
    if (window.scrollY !== scroll) window.scrollTo({ top: scroll, behavior: 'instant' });
  }
  editor.addEventListener('input', fit);
  window.addEventListener('resize', fit);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(editor);
  if (document.fonts?.ready) document.fonts.ready.then(() => { previousWidth = undefined; fit(); });
  return { fit };
}
