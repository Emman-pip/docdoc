import { IMAGE_LINK } from './images.js';
export const escapeHTML = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function inline(line, images) {
  // Format text independently of generated image HTML so filenames cannot alter attributes.
  const format = value => escapeHTML(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  let result = '', position = 0;
  for (const match of line.matchAll(IMAGE_LINK)) {
    result += format(line.slice(position, match.index));
    const image = images.get(match[2]);
    result += image ? `<img src="${escapeHTML(image.data)}" alt="${escapeHTML(match[1])}" loading="lazy">` : '<span class="missing-photo">Photo unavailable</span>';
    position = match.index + match[0].length;
  }
  return result + format(line.slice(position));
}
export function renderMarkdown(text, images = new Map()) {
  return text.split('\n').map(line => {
    const heading = line.match(/^(#{1,3}) (.*)$/);
    if (heading) return `<h${heading[1].length}>${inline(heading[2], images)}</h${heading[1].length}>`;
    if (line.startsWith('> ')) return `<blockquote>${inline(line.slice(2), images)}</blockquote>`;
    if (line.startsWith('- ')) return `<p>• ${inline(line.slice(2), images)}</p>`;
    return `<p>${inline(line, images) || '<br>'}</p>`;
  }).join('');
}
