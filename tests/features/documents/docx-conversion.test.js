import test from 'node:test';
import assert from 'node:assert/strict';
import mammoth from 'mammoth';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { exportDocx, exportFilename } from '../../../public/features/documents/docx-export.js';
import { boundedDocxArchive, IMPORT_LIMIT } from '../../../public/features/documents/docx-archive.js';
import { richContent } from '../../support/rich-fixture.js';

test('DOCX generation round-trips headings, marks, nested lists, hyperlinks, and an embedded image', async () => {
  const blob = await exportDocx(richContent, 'Report', async src => ({ src, width: 1, height: 1 }));
  const buffer = await blob.arrayBuffer(), archive = boundedDocxArchive(buffer);
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(archive) });
  for (const pattern of [/<h2>Team report<\/h2>/, /<strong>Bold<\/strong>/, /<em> italic<\/em>/, /href="https:\/\/example.com\/"/, /<ul>/, /<ol>/, /Nested item/, /data:image\/png;base64,/]) assert.match(result.value, pattern);
  const files = unzipSync(new Uint8Array(buffer));
  assert.ok(Object.keys(files).some(name => name.startsWith('word/media/')));
  assert.match(new TextDecoder().decode(files['word/numbering.xml']), /w:start w:val="3"/);
});
test('malformed, unsupported, and unusually large DOCX archives fail clearly', () => {
  assert.throws(() => boundedDocxArchive(new Uint8Array([1, 2, 3]).buffer));
  assert.throws(() => boundedDocxArchive(new ArrayBuffer(IMPORT_LIMIT + 1)), /smaller than 10 MB/);
  assert.throws(() => boundedDocxArchive(zipSync({ 'plain.txt': strToU8('not docx') }).buffer), /not a supported DOCX/);
  assert.throws(() => boundedDocxArchive(zipSync({ 'word/document.xml': new Uint8Array(5 * 1024 * 1024), '[Content_Types].xml': strToU8('types') }).buffer), /large or complex/);
});
test('download filenames cannot introduce paths and empty titles have a fallback', () => {
  assert.equal(exportFilename('../My: Report?\\file', 'docx'), 'My Reportfile.docx');
  assert.equal(exportFilename('...', 'docx'), 'document.docx');
  assert.equal(exportFilename('Résumé', 'md'), 'Résumé.md');
});
