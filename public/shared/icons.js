export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `/icons.svg#${name}`); svg.append(use);
  return svg;
}
export function buttonLabel(button, label, name = button.dataset?.icon) {
  button.textContent = label;
  if (name && document.createElementNS) { button.dataset.icon = name; button.prepend(icon(name)); }
}
