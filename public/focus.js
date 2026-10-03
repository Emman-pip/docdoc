import { buttonLabel } from './icons.js';
export function startsInPreview(record) { return Boolean(record.joined || (record.room && !record.local && !record.room.ownerToken)); }
export function attachFocus({ button, body, hasDialog, listen }) {
  let active = false;
  function set(value) {
    active = value; body.classList.toggle('focus-mode', active);
    button.setAttribute('aria-pressed', String(active)); buttonLabel(button, active ? 'Exit focus mode' : 'Focus mode', 'focus');
  }
  button.onclick = () => set(!active);
  listen(event => { if (event.key === 'Escape' && active && !hasDialog()) { event.preventDefault(); event.stopPropagation(); set(false); button.focus(); } });
  return { exit: () => set(false) };
}
