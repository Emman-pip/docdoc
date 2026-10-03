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
function tableCells(line) {
  const cells = [];
  let cell = '';
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '\\' && line[index + 1] === '|') { cell += '|'; index += 1; }
    else if (character === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += character;
  }
  cells.push(cell.trim());
  if (cells[0] === '' && line.trimStart().startsWith('|')) cells.shift();
  if (cells.at(-1) === '' && line.trimEnd().endsWith('|') && !line.trimEnd().endsWith('\\|')) cells.pop();
  return cells;
}
function tableAlignments(line) {
  const cells = tableCells(line);
  return cells.length && cells.every(cell => /^:?-{3,}:?$/.test(cell))
    ? cells.map(cell => cell.startsWith(':') ? cell.endsWith(':') ? 'center' : 'left' : cell.endsWith(':') ? 'right' : '')
    : null;
}
function renderTable(lines, images) {
  const headers = tableCells(lines[0]), alignments = tableAlignments(lines[1]);
  if (!alignments || headers.length !== alignments.length || !lines[0].includes('|')) return null;
  const heading = headers.map((cell, index) => `<th scope="col"${alignments[index] ? ` class="align-${alignments[index]}"` : ''}>${inline(cell, images)}</th>`).join('');
  const rows = lines.slice(2).map(line => {
    const cells = tableCells(line).slice(0, headers.length);
    while (cells.length < headers.length) cells.push('');
    return `<tr>${cells.map((cell, index) => `<td${alignments[index] ? ` class="align-${alignments[index]}"` : ''}>${inline(cell, images)}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="markdown-table-wrap"><table><thead><tr>${heading}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
export function renderMarkdown(text, images = new Map()) {
  const lines = text.split('\n'), output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^```([^`]*)$/);
    if (fence) {
      const body = [];
      let end = index + 1;
      while (end < lines.length && !/^```\s*$/.test(lines[end])) body.push(lines[end++]);
      if (end < lines.length) index = end;
      else index = lines.length;
      const language = fence[1].trim();
      const label = language ? `<span class="code-language">${escapeHTML(language)}</span>` : '';
      output.push(`<div class="markdown-code-block">${label}<pre><code>${escapeHTML(body.join('\n'))}</code></pre></div>`);
      continue;
    }
    if (index + 1 < lines.length && line.includes('|') && tableAlignments(lines[index + 1])) {
      const tableLines = [line, lines[index + 1]];
      let end = index + 2;
      while (end < lines.length && lines[end].trim() && lines[end].includes('|')) tableLines.push(lines[end++]);
      const table = renderTable(tableLines, images);
      if (table) { output.push(table); index = end - 1; continue; }
    }
    const heading = line.match(/^(#{1,3}) (.*)$/);
    if (heading) output.push(`<h${heading[1].length}>${inline(heading[2], images)}</h${heading[1].length}>`);
    else if (line.startsWith('> ')) output.push(`<blockquote>${inline(line.slice(2), images)}</blockquote>`);
    else if (line.startsWith('- ')) output.push(`<p>• ${inline(line.slice(2), images)}</p>`);
    else output.push(`<p>${inline(line, images) || '<br>'}</p>`);
  }
  return output.join('');
}
