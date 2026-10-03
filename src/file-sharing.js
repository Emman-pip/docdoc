import { randomUUID, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { normalizeIP } from './access-control.js';
import { inventory, requireFolder, publicFile, validName, fail } from './folders.js';
export const MAX_FILE_BYTES = 1073741824;
export const MAX_ROOM_BYTES = 1073741824;
export const MAX_FILES = 1000;
const digest = value => createHash('sha256').update(value).digest('hex');
export const filePath = (dataDir, room, id) => resolve(dataDir, 'files', room.id, `${id}.bin`);

// Runtime reservations are separate from snapshots. Known lengths reserve all bytes;
// chunked requests grow their reservation before each write, without buffering a file.
export class UploadReservations {
  constructor(maxBytes = MAX_ROOM_BYTES, maxFiles = MAX_FILES) { this.maxBytes = maxBytes; this.maxFiles = maxFiles; this.pending = new Map(); }
  reserve(room, key, bytes = 0) {
    if (this.pending.has(key)) fail(409, 'This upload is already in progress. Retry when it finishes.');
    if ((room.files || []).length + this.pending.size >= this.maxFiles) fail(413, 'This session has reached its 1,000-file limit.');
    this.pending.set(key, 0);
    try { this.grow(room, key, bytes); } catch (error) { this.release(key); throw error; }
  }
  grow(room, key, bytes) {
    const used = (room.files || []).reduce((sum, file) => sum + file.size, 0);
    const reserved = [...this.pending.values()].reduce((sum, size) => sum + size, 0) - this.pending.get(key);
    if (used + reserved + bytes > this.maxBytes) fail(413, 'This session has reached its 1 GiB storage limit, including uploads in progress.');
    this.pending.set(key, bytes);
  }
  release(key) { this.pending.delete(key); }
}
const reservations = new WeakMap();
export function cleanupFiles(room, dataDir, save, removeFile = rmSync) {
  const previous = room.garbage || [];
  room.garbage = previous.filter(id => {
    try { removeFile(filePath(dataDir, room, id), { force: true }); return false; } catch { return true; }
  });
  if (room.garbage.length !== previous.length) {
    try { save(room); } catch { room.garbage = previous; }
  }
}
export function cleanupTemporaryFiles(dataDir) {
  const root = resolve(dataDir, 'files');
  if (!existsSync(root)) return;
  for (const room of readdirSync(root).filter(id => /^[a-f0-9-]{36}$/.test(id))) {
    for (const name of readdirSync(resolve(root, room)).filter(name => /^[a-f0-9-]{36}\.bin\.tmp$/.test(name))) {
      try { rmSync(resolve(root, room, name), { force: true }); } catch { /* Retry on the next host restart. */ }
    }
  }
}
export async function streamFile(res, dataDir, room, file) {
  // Open before sending headers so missing files produce a normal API error.
  const handle = await open(filePath(dataDir, room, file.id), 'r');
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`,
    'Cache-Control': 'no-store', 'Content-Length': file.size,
  });
  await pipeline(handle.createReadStream(), res);
}
export async function handleFileRequest({ req, res, url, room, scope = null, owner, fileId, dataDir, save, admit, canAccess, json, now, removeFile = rmSync }) {
  const user = url.searchParams.get('user'), name = url.searchParams.get('name') || 'Collaborator';
  if (!['GET', 'POST', 'DELETE', 'PATCH'].includes(req.method) || (!fileId && ['DELETE', 'PATCH'].includes(req.method))) return json(res, 405, { error: 'Method not allowed' });
  if (!admit(room, user, name, res)) return;
  room.files ||= []; cleanupFiles(room, dataDir, save, removeFile);
  if (fileId) {
    const file = room.files.find(file => file.id === fileId);
    if (!file) return json(res, 404, { error: 'File not found' });
    requireFolder(room, file.folderId || null, scope);
    if (req.method === 'GET') return streamFile(res, dataDir, room, file);
    if (req.method === 'PATCH') {
      if (!owner) fail(403, 'Only the session owner can move files.');
      const folderId = url.searchParams.get('folder') || null;
      requireFolder(room, folderId, scope);
      const previous = file.folderId; file.folderId = folderId;
      try { save(room); } catch (error) { file.folderId = previous; throw error; }
      return json(res, 200, { file: publicFile(file) });
    }
    if (req.method !== 'DELETE') fail(405, 'Method not allowed');
    const credential = req.headers['x-deletion-key'] || '';
    if (!owner && (!file.deletionHash || typeof credential !== 'string' || !timingSafeEqual(Buffer.from(digest(credential)), Buffer.from(file.deletionHash)))) fail(403, 'Only the session owner or uploader with its private deletion key can delete this file. Older files require the owner.');
    const previous = room.files, garbage = room.garbage || [];
    room.files = previous.filter(item => item !== file); room.garbage = [...garbage, file.id];
    try { save(room); } catch (error) { room.files = previous; room.garbage = garbage; throw error; }
    // Metadata and quota are released even if the OS temporarily refuses deletion.
    cleanupFiles(room, dataDir, save, removeFile);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET') return json(res, 200, { ...inventory(room, scope), maxFileBytes: MAX_FILE_BYTES, maxRoomBytes: MAX_ROOM_BYTES, maxFiles: MAX_FILES, usedBytes: room.files.reduce((sum, file) => sum + file.size, 0), usedFiles: room.files.length });
  const folderId = url.searchParams.get('folder') || scope;
  requireFolder(room, folderId, scope);
  let filename;
  try { filename = decodeURIComponent(req.headers['x-file-name'] || ''); } catch { fail(400, 'Invalid filename encoding.'); }
  validName(filename);
  const length = req.headers['content-length'] === undefined ? null : Number(req.headers['content-length']);
  if (length !== null && (!Number.isSafeInteger(length) || length < 0)) fail(400, 'Invalid Content-Length.');
  if (length > MAX_FILE_BYTES) fail(413, 'Files must be 1 GiB or smaller.');
  const uploadKey = req.headers['x-upload-key'] || randomBytes(32).toString('hex');
  if (typeof uploadKey !== 'string' || !/^[a-f0-9]{64}$/.test(uploadKey)) fail(400, 'Invalid upload key.');
  const key = digest(uploadKey), deletionToken = createHmac('sha256', room.token).update(uploadKey).digest('hex');
  const existing = room.files.find(file => file.uploadKey === key);
  if (existing) {
    requireFolder(room, existing.folderId || null, scope);
    req.resume();
    return json(res, 200, { file: publicFile(existing), deletionToken });
  }
  if (!reservations.has(room)) reservations.set(room, new UploadReservations());
  const quota = reservations.get(room); quota.reserve(room, key, length || 0);
  room.activeTransfers ||= new Map();
  room.activeTransfers.set(user, (room.activeTransfers.get(user) || 0) + 1);
  const file = { id: randomUUID(), folderId, name: filename, size: 0, uploadedBy: String(name).trim().slice(0, 40) || 'Collaborator', uploadedByIP: normalizeIP(req.socket?.remoteAddress), uploadedByUser: user, createdAt: now(), deletionHash: digest(deletionToken), uploadKey: key };
  const path = filePath(dataDir, room, file.id); let handle, committed = false;
  try {
    mkdirSync(resolve(dataDir, 'files', room.id), { recursive: true });
    handle = await open(`${path}.tmp`, 'wx', 0o600);
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      file.size += chunk.length;
      if (file.size > MAX_FILE_BYTES) fail(413, 'Files must be 1 GiB or smaller.');
      quota.grow(room, key, Math.max(length || 0, file.size));
      await handle.writeFile(chunk);
    }
    if (length !== null && length !== file.size) fail(400, 'Upload length did not match Content-Length. Retry this file.');
    if (!canAccess()) return;
    requireFolder(room, folderId, scope);
    await handle.close(); handle = null;
    // Closing yields; access may have been revoked while the descriptor closed.
    if (!canAccess()) return;
    requireFolder(room, folderId, scope);
    renameSync(`${path}.tmp`, path);
    room.files.push(file);
    try { save(room); } catch (error) { room.files = room.files.filter(item => item !== file); throw error; }
    committed = true;
    json(res, 201, { file: publicFile(file), deletionToken });
  } finally {
    // Releasing capacity must not depend on a successful descriptor close.
    try { if (handle) await handle.close(); } catch { /* Cleanup below still runs. */ }
    quota.release(key);
    const remaining = room.activeTransfers.get(user) - 1;
    if (remaining) room.activeTransfers.set(user, remaining); else room.activeTransfers.delete(user);
    if (room.users.has(user)) room.users.get(user).seen = now();
    if (!committed) {
      for (const leftover of [`${path}.tmp`, path]) { try { rmSync(leftover, { force: true }); } catch { /* Unreferenced bytes cannot be downloaded. */ } }
      if (!req.destroyed) req.resume();
    }
  }
}
