import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeIP } from './access-control.js';
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_ROOM_BYTES = 100 * 1024 * 1024;
export const MAX_FILES = 20;

export async function handleFileRequest({ req, res, url, room, fileId, dataDir, save, admit, canAccess, json, now }) {
  const user = url.searchParams.get('user'), name = url.searchParams.get('name') || 'Collaborator';
  if (!['GET', 'POST'].includes(req.method) || (fileId && req.method !== 'GET')) return json(res, 405, { error: 'Method not allowed' });
  if (!admit(room, user, name, res)) return;
  room.files ||= [];
  if (fileId) {
    const file = room.files.find(file => file.id === fileId);
    if (!file) return json(res, 404, { error: 'File not found' });
    const data = readFileSync(resolve(dataDir, 'files', room.id, `${file.id}.bin`));
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`,
      'Cache-Control': 'no-store', 'Content-Length': data.length,
    });
    res.end(data); return;
  }
  if (req.method === 'GET') return json(res, 200, { files: room.files, maxFileBytes: MAX_FILE_BYTES, maxRoomBytes: MAX_ROOM_BYTES, maxFiles: MAX_FILES });
  let filename;
  try { filename = decodeURIComponent(req.headers['x-file-name'] || ''); } catch { return json(res, 400, { error: 'Invalid filename' }); }
  filename = filename.replace(/[\x00-\x1f\x7f/\\]/g, '_').trim().slice(0, 200);
  if (!filename) return json(res, 400, { error: 'A filename is required' });
  if (Number(req.headers['content-length']) > MAX_FILE_BYTES) return json(res, 413, { error: 'Files must be 20 MB or smaller.' });
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_FILE_BYTES) return json(res, 413, { error: 'Files must be 20 MB or smaller.' });
    chunks.push(chunk);
  }
  if (!canAccess()) return;
  // Check again after receiving the body so concurrent uploads cannot exceed the quota.
  if (room.files.length >= MAX_FILES || room.files.reduce((sum, file) => sum + file.size, 0) + size > MAX_ROOM_BYTES) return json(res, 413, { error: 'This session has reached its limit of 20 files or 100 MB.' });
  const file = { id: randomUUID(), name: filename, size, uploadedBy: String(name).trim().slice(0, 40) || 'Collaborator', uploadedByIP: normalizeIP(req.socket?.remoteAddress), uploadedByUser: user, createdAt: now() };
  const directory = resolve(dataDir, 'files', room.id); mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `${file.id}.bin`);
  try {
    writeFileSync(`${path}.tmp`, Buffer.concat(chunks), { mode: 0o600 }); renameSync(`${path}.tmp`, path);
    room.files.push(file); save(room);
  } catch (error) {
    room.files = room.files.filter(item => item.id !== file.id);
    rmSync(path, { force: true }); rmSync(`${path}.tmp`, { force: true }); throw error;
  }
  json(res, 201, { file });
}
