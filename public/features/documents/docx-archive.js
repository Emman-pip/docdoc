import { unzipSync, zipSync } from 'fflate';

export const IMPORT_LIMIT = 10 * 1024 * 1024;
export function boundedDocxArchive(buffer) {
  if (!buffer.byteLength || buffer.byteLength > IMPORT_LIMIT) throw new Error('Choose a DOCX file smaller than 10 MB.');
  let entries = 0, expanded = 0;
  const files = unzipSync(new Uint8Array(buffer), { filter: entry => {
    expanded += entry.originalSize;
    if (++entries > 2000 || expanded > 20 * 1024 * 1024 || (entry.name.endsWith('.xml') && entry.originalSize > 4 * 1024 * 1024)) throw new Error('This DOCX archive is too large or complex to import.');
    return true;
  } });
  if (!files['[Content_Types].xml'] || !files['word/document.xml']) throw new Error('This file is not a supported DOCX document.');
  if (Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) > 20 * 1024 * 1024) throw new Error('This DOCX archive is too large to import.');
  // Feed the converter a bounded, reconstructed archive, never unchecked ZIP sizes.
  return zipSync(files, { level: 0 }).buffer;
}
