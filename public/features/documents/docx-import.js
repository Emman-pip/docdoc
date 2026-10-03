import { DOMParser as ProseMirrorParser } from '@tiptap/pm/model';
import { richSchema, validateRichContent, safeLink } from './rich-schema.js';
import { validateImage } from './images.js';
import { IMPORT_LIMIT } from './docx-archive.js';

export const CONVERSION_LIMITATIONS = 'DOCX supports paragraphs, headings, lists, bold, italic, links, and embedded PNG/JPEG/WebP images. Tables are flattened; layout, fonts, headers/footers, comments, tracked changes, and other Word features may be simplified or omitted.';

export function importedContent(html) {
  // Template contents are inert. Only allowlisted nodes/attributes reach the editor.
  const template = document.createElement('template'); template.innerHTML = html;
  const allowed = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'A', 'IMG', 'BR']);
  for (const element of [...template.content.querySelectorAll('*')].reverse()) {
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'MATH'].includes(element.tagName)) { element.remove(); continue; }
    if (!allowed.has(element.tagName)) { element.replaceWith(...element.childNodes); continue; }
    const href = element.getAttribute('href'), src = element.getAttribute('src'), alt = element.getAttribute('alt'), start = element.getAttribute('start');
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    if (element.tagName === 'A' && safeLink(href)) element.setAttribute('href', href);
    if (element.tagName === 'IMG') {
      validateImage({ id: 'import', data: src });
      element.setAttribute('src', src); if (alt) element.setAttribute('alt', alt.slice(0, 1000));
    }
    if (element.tagName === 'OL' && /^[1-9][0-9]{0,5}$/.test(start || '')) element.setAttribute('start', start);
  }
  const content = ProseMirrorParser.fromSchema(richSchema).parse(template.content).toJSON();
  validateRichContent(content);
  return content;
}
export async function importDocx(file) {
  if (!/\.docx$/i.test(file.name) || file.size > IMPORT_LIMIT || !file.size) throw new Error('Choose a non-empty .docx file smaller than 10 MB.');
  const buffer = await file.arrayBuffer();
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker('/assets/docx-worker.js', { type: 'module' });
    const finish = (error, result) => { clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(new Error('DOCX import took too long. Choose a smaller or simpler document.')), 20000);
    worker.onerror = () => finish(new Error('DOCX conversion could not start. Reload once while connected to the host.'));
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data);
    worker.postMessage(buffer, [buffer]);
  });
  const content = importedContent(result.html);
  return { content, warnings: result.warnings };
}
