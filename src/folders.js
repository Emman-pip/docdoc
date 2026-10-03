import { randomUUID } from 'node:crypto';
export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function validName(value) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 200 || /[\x00-\x1f\x7f/\\]/.test(value) || value === '.' || value === '..') fail(400, 'Invalid name: use 1–200 characters without slashes, control characters, or traversal segments.');
  return value;
}
export function within(room, folderId, scope = null) {
  if (folderId === null) return scope === null;
  const seen = new Set();
  while (folderId !== null) {
    if (seen.has(folderId)) return false;
    seen.add(folderId);
    const folder = (room.folders || []).find(item => item.id === folderId);
    if (!folder) return false;
    if (folderId === scope) return true;
    folderId = folder.parentId;
  }
  return scope === null;
}
export function requireFolder(room, folderId, scope = null) {
  if (!within(room, folderId, scope)) fail(403, 'Folder is unavailable or outside this invitation.');
}
export function publicFile(file) {
  const { deletionHash, uploadKey, ...visible } = file;
  return { ...visible, folderId: file.folderId || null, ownerOnlyDeletion: !deletionHash };
}
export function inventory(room, scope = null) {
  return {
    files: (room.files || []).filter(file => within(room, file.folderId || null, scope)).map(publicFile),
    folders: (room.folders || []).filter(folder => within(room, folder.id, scope)).map(folder => ({ ...folder, parentId: folder.id === scope ? null : folder.parentId })),
    rootFolderId: scope,
  };
}
export function manageFolders(room, input, { scope = null, owner, save }) {
  room.folders ||= []; room.files ||= [];
  const previous = room.folders;
  const action = input.action;
  let folder;
  if (action === 'create') {
    const parentId = input.parentId === undefined ? scope : input.parentId;
    requireFolder(room, parentId, scope);
    if (room.folders.length >= 5000) fail(413, 'This session has reached its 5,000-folder limit.');
    folder = { id: randomUUID(), name: validName(input.name), parentId };
    room.folders = [...room.folders, folder];
  } else {
    requireFolder(room, input.id, scope);
    folder = room.folders.find(item => item.id === input.id);
    if (!folder) fail(404, 'Folder not found.');
    if (!owner) fail(403, 'Only the session owner can rename, move, or delete folders.');
    if (action === 'rename') folder = { ...folder, name: validName(input.name) };
    else if (action === 'move') {
      requireFolder(room, input.parentId, scope);
      if (within(room, input.parentId, folder.id)) fail(400, 'Invalid move: a folder cannot contain itself.');
      folder = { ...folder, parentId: input.parentId };
    } else if (action === 'delete') {
      if (room.folders.some(item => item.parentId === folder.id) || room.files.some(file => file.folderId === folder.id)) fail(409, 'Only empty folders can be deleted.');
    } else fail(400, 'Invalid folder action.');
    room.folders = room.folders.filter(item => item.id !== folder.id);
    if (action !== 'delete') room.folders.push(folder);
  }
  // Unique sibling folder names make relative-path uploads and ZIP paths unambiguous.
  if (action !== 'delete' && room.folders.some(item => item.id !== folder.id && item.parentId === folder.parentId && item.name === folder.name)) { room.folders = previous; fail(409, 'A folder with that name already exists here.'); }
  try { save(room); } catch (error) { room.folders = previous; throw error; }
  return { folder };
}
