import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { filePath } from './file-sharing.js';
import { within, validName, requireFolder, fail } from './folders.js';
const table = Array.from({ length: 256 }, (_, i) => {
  let c = i; for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
export function crc32(chunk, crc = 0xffffffff) {
  for (const byte of chunk) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc >>> 0;
}
export function zipEntries(room, folderId) {
  requireFolder(room, folderId);
  const folderPath = id => {
    const parts = [];
    while (id !== null) {
      const folder = room.folders.find(item => item.id === id);
      parts.unshift(validName(folder.name));
      if (id === folderId) break;
      id = folder.parentId;
    }
    return parts.join('/');
  };
  const entries = (room.folders || []).filter(folder => within(room, folder.id, folderId)).map(folder => ({ name: folderPath(folder.id) + '/', size: 0 }));
  const used = new Set(entries.map(entry => entry.name.slice(0, -1)));
  for (const file of (room.files || []).filter(file => within(room, file.folderId || null, folderId))) {
    const prefix = file.folderId ? folderPath(file.folderId) + '/' : '';
    const original = prefix + validName(file.name);
    let name = original;
    if (used.has(name)) name = `${original} (${file.id})`;
    while (used.has(name)) name += '_';
    used.add(name); entries.push({ name, size: file.size, id: file.id });
  }
  if (entries.some(entry => Buffer.byteLength(entry.name) > 65535)) fail(400, 'Folder paths are too long for ZIP. Download a smaller subtree.');
  return entries;
}
// Stored (uncompressed) ZIP with data descriptors: memory is bounded by one disk
// chunk plus the central directory, and the 1 GiB quota keeps offsets within ZIP32.
export async function* zipStream(entries, dataDir, room) {
  let offset = 0; const central = [];
  for (const entry of entries) {
    const name = Buffer.from(entry.name), local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x808, 6); local.writeUInt16LE(0x21, 12); local.writeUInt16LE(name.length, 26);
    const start = offset; yield local; yield name; offset += local.length + name.length;
    let crc = 0xffffffff, size = 0;
    if (entry.id) for await (const chunk of createReadStream(filePath(dataDir, room, entry.id))) { crc = crc32(chunk, crc); size += chunk.length; yield chunk; offset += chunk.length; }
    crc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = Buffer.alloc(16); descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc, 4); descriptor.writeUInt32LE(size, 8); descriptor.writeUInt32LE(size, 12); yield descriptor; offset += 16;
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x808, 8); header.writeUInt16LE(0x21, 14); header.writeUInt32LE(crc, 16); header.writeUInt32LE(size, 20); header.writeUInt32LE(size, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(entry.id ? 0 : 16, 38); header.writeUInt32LE(start, 42);
    central.push(header, name);
  }
  const centralStart = offset;
  for (const chunk of central) { yield chunk; offset += chunk.length; }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(offset - centralStart, 12); end.writeUInt32LE(centralStart, 16); yield end;
}
export async function streamZip(res, room, folderId, dataDir) {
  const entries = zipEntries(room, folderId);
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="folder.zip"', 'Cache-Control': 'no-store' });
  await pipeline(Readable.from(zipStream(entries, dataDir, room)), res);
}
