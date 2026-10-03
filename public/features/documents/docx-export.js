import { Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink, HeadingLevel, LevelFormat } from 'docx';
import { validateRichContent } from './rich-schema.js';

export function exportFilename(title, extension) {
  return `${String(title).replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 100) || 'document'}.${extension}`;
}
async function browserImage(src) {
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('An embedded image could not be exported.')); image.src = src; });
  if (src.startsWith('data:image/webp')) {
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0); src = canvas.toDataURL('image/png');
  }
  const scale = Math.min(1, 600 / image.naturalWidth, 800 / image.naturalHeight);
  return { src, width: Math.max(1, Math.round(image.naturalWidth * scale)), height: Math.max(1, Math.round(image.naturalHeight * scale)) };
}
export async function exportDocx(content, title, imageInfo = browserImage) {
  validateRichContent(content);
  const paragraphs = [], numbering = [];
  async function runs(nodes = []) {
    const result = [];
    for (const node of nodes) {
      let run;
      if (node.type === 'image') {
        const info = await imageInfo(node.attrs.src), type = info.src.startsWith('data:image/png') ? 'png' : 'jpg';
        run = new ImageRun({ type, data: Uint8Array.from(atob(info.src.split(',')[1]), char => char.charCodeAt(0)), transformation: { width: info.width, height: info.height }, altText: { title: node.attrs.alt || 'Image', description: node.attrs.alt || '', name: 'Image' } });
      } else run = new TextRun({ text: node.text || '', break: node.type === 'hardBreak' ? 1 : undefined, bold: node.marks?.some(mark => mark.type === 'bold'), italics: node.marks?.some(mark => mark.type === 'italic') });
      const link = node.marks?.find(mark => mark.type === 'link');
      result.push(link ? new ExternalHyperlink({ children: [run], link: link.attrs.href }) : run);
    }
    return result;
  }
  async function blocks(nodes, level = 0, list) {
    for (const node of nodes) {
      if (node.type === 'orderedList' || node.type === 'bulletList') {
        if (level > 8) throw new Error('DOCX export supports at most nine nested list levels.');
        const reference = `list-${numbering.length}`;
        numbering.push({ reference, levels: Array.from({ length: 9 }, (_, index) => ({ level: index, format: node.type === 'bulletList' ? LevelFormat.BULLET : LevelFormat.DECIMAL, text: node.type === 'bulletList' ? '•' : `%${index + 1}.`, start: node.attrs?.start || 1, style: { paragraph: { indent: { left: 720 * (index + 1), hanging: 260 } } } })) });
        for (const item of node.content) await blocks(item.content, level + 1, { reference, level });
      } else {
        paragraphs.push(new Paragraph({ children: await runs(node.content), heading: node.type === 'heading' ? HeadingLevel[`HEADING_${node.attrs.level}`] : undefined, numbering: list }));
        list = undefined; // Only the first paragraph in a list item gets its marker.
      }
    }
  }
  await blocks(content.content);
  return Packer.toBlob(new Document({ title, numbering: { config: numbering }, sections: [{ children: paragraphs }] }));
}
