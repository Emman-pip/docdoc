import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { validateImage } from './images.js';

export function safeLink(value) {
  return typeof value === 'string' && value.length <= 2048 && /^(https?:\/\/|mailto:)[^\s<>]+$/i.test(value);
}
export function richExtensions() {
  return [StarterKit.configure({
    blockquote: false, code: false, codeBlock: false, horizontalRule: false,
    strike: false, underline: false, undoRedo: false, trailingNode: false,
    link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: safeLink },
  }), Image.configure({ inline: true, allowBase64: true })];
}
export const richSchema = getSchema(richExtensions());
const attributes = {
  doc: [], paragraph: [], text: [], hardBreak: [], heading: ['level'],
  bulletList: [], orderedList: ['start', 'type'], listItem: [],
  image: ['src', 'alt', 'title', 'width', 'height'],
};
export function validateRichContent(content) {
  let count = 0;
  function visit(node, depth = 0) {
    if (!node || !Object.hasOwn(attributes, node.type) || depth > 32 || ++count > 50000) throw new Error('Invalid DOCX content or document complexity.');
    for (const key of Object.keys(node.attrs || {})) if (!attributes[node.type].includes(key)) throw new Error('Invalid DOCX attribute.');
    if (node.type === 'heading' && (!Number.isInteger(node.attrs?.level) || node.attrs.level < 1 || node.attrs.level > 6)) throw new Error('Invalid heading level.');
    if (node.type === 'orderedList' && node.attrs?.start !== undefined && (!Number.isInteger(node.attrs.start) || node.attrs.start < 1 || node.attrs.start > 1000000)) throw new Error('Invalid list start.');
    if (node.type === 'orderedList' && node.attrs?.type != null && node.attrs.type !== '1') throw new Error('Invalid list numbering style.');
    if (node.type === 'image') {
      validateImage({ id: 'inline', data: node.attrs?.src });
      for (const key of ['alt', 'title']) if (node.attrs[key] != null && (typeof node.attrs[key] !== 'string' || node.attrs[key].length > 1000)) throw new Error('Invalid image description.');
      for (const key of ['width', 'height']) if (node.attrs[key] != null && (!Number.isFinite(node.attrs[key]) || node.attrs[key] < 1 || node.attrs[key] > 1600)) throw new Error('Invalid image dimensions.');
    }
    for (const mark of node.marks || []) {
      if (!['bold', 'italic', 'link'].includes(mark.type)) throw new Error('Invalid DOCX formatting.');
      if (mark.type === 'link') {
        if (!safeLink(mark.attrs?.href)) throw new Error('Invalid link: use https, http, or mailto.');
        if (Object.keys(mark.attrs).some(key => !['href', 'target', 'rel', 'class', 'title'].includes(key))) throw new Error('Invalid link attribute.');
        if (mark.attrs.target != null && !['_blank', '_self'].includes(mark.attrs.target)) throw new Error('Invalid link target.');
        for (const key of ['rel', 'class', 'title']) if (mark.attrs[key] != null && (typeof mark.attrs[key] !== 'string' || mark.attrs[key].length > 1000)) throw new Error('Invalid link attribute.');
      } else if (Object.keys(mark.attrs || {}).length) throw new Error('Invalid formatting attribute.');
    }
    for (const child of node.content || []) visit(child, depth + 1);
  }
  if (content?.type !== 'doc') throw new Error('Invalid DOCX root.');
  visit(content);
  const node = richSchema.nodeFromJSON(content);
  node.check();
  return node;
}
