import { buttonLabel } from './icons.js';

const THEME_KEY = 'docdoc.theme.v1';

export function initializeTheme(button, storage, root = document.documentElement) {
  if (!storage) {
    try { storage = localStorage; } catch {
      storage = { getItem: () => null, setItem: () => {} };
    }
  }
  let selected = null;
  try {
    const saved = storage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') selected = saved;
  } catch {
    // Keep the control usable for this visit if browser storage is unavailable.
  }

  function render() {
    if (selected) root.dataset.theme = selected;
    else delete root.dataset.theme;
    const dark = selected === 'dark' || (!selected && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = dark ? 'light' : 'dark';
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = getComputedStyle(root).getPropertyValue('--topbar').trim();
    buttonLabel(button, `${next[0].toUpperCase()}${next.slice(1)} mode`, next === 'dark' ? 'moon' : 'sun');
    button.setAttribute('aria-label', `Switch to ${next} mode`);
    button.setAttribute('title', `Switch to ${next} mode`);
    button.setAttribute('aria-pressed', String(dark));
  }

  button.addEventListener('click', () => {
    const dark = selected ? selected === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    selected = dark ? 'light' : 'dark';
    try { storage.setItem(THEME_KEY, selected); } catch {
      // The current page still changes theme; the choice may not survive a reload.
    }
    render();
  });
  render();
  return { get theme() { return selected; } };
}
