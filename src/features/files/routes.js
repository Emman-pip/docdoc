import { randomBytes } from 'node:crypto';
import { manageFolders, requireFolder, inventory } from './folders.js';
import { handleFileRequest, streamFile } from './file-sharing.js';
import { streamZip } from './zip.js';
import { matchesPolicy } from '../access/access-control.js';
export function createFileRoutes({ dataDir, save, admit, fileAccess, stillAllowed, isOwner, identity, json, body, now, removeFile }) {
  const tickets = new Map();
  return async function handleFiles(req, res, url) {
    const downloadMatch = url.pathname.match(/^\/api\/downloads\/([a-f0-9]{64})$/);
    if (downloadMatch) {
      if (req.method !== 'GET') return json(res, 405, { error: 'Use GET' });
      const ticket = tickets.get(downloadMatch[1]); tickets.delete(downloadMatch[1]);
      if (!ticket || ticket.expires <= now()) return json(res, 403, { error: 'Download ticket expired or was already used. Start the download again.' });
      req.headers.authorization = ticket.authorization;
      req.headers['x-owner-key'] = ticket.ownerKey;
      const access = fileAccess(req, ticket.roomId);
      if (!access) return json(res, 403, { error: 'Invitation was revoked or is unavailable.' });
      if (!admit(req, access.room, ticket.user, ticket.name, res)) return;
      if (ticket.fileId) {
        const file = (access.room.files || []).find(item => item.id === ticket.fileId);
        if (!file) return json(res, 404, { error: 'File not found.' });
        requireFolder(access.room, file.folderId || null, access.scope);
        return await streamFile(res, dataDir, access.room, file);
      }
      requireFolder(access.room, ticket.folderId, access.scope);
      return await streamZip(res, access.room, ticket.folderId, dataDir);
    }
    const ticketMatch = url.pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})\/download-tickets$/);
    if (ticketMatch) {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
      const input = await body(req), access = fileAccess(req, ticketMatch[1]);
      if (!access) return json(res, 403, { error: 'Invitation is invalid or unavailable.' });
      if (!admit(req, access.room, input.user, input.name, res)) return;
      const folderId = input.folderId === undefined ? access.scope : input.folderId;
      if (input.fileId) {
        const file = (access.room.files || []).find(item => item.id === input.fileId);
        if (!file) return json(res, 404, { error: 'File not found.' });
        requireFolder(access.room, file.folderId || null, access.scope);
      } else requireFolder(access.room, folderId, access.scope);
      for (const [key, ticket] of tickets) if (ticket.expires <= now()) tickets.delete(key);
      if (tickets.size >= 5000) return json(res, 429, { error: 'Too many pending downloads. Try again in a minute.' });
      const token = randomBytes(32).toString('hex');
      tickets.set(token, { roomId: access.room.id, fileId: input.fileId, folderId, user: input.user, name: input.name, authorization: req.headers.authorization, ownerKey: req.headers['x-owner-key'], expires: now() + 60000 });
      return json(res, 201, { url: `/api/downloads/${token}`, expiresIn: 60 });
    }
    const filesMatch = url.pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})\/files(?:\/([a-f0-9-]{36}))?$/);
    if (filesMatch) {
      const access = fileAccess(req, filesMatch[1]), room = access?.room;
      if (!room) return json(res, 403, { error: 'Invitation is invalid or unavailable on this host.' });
      await handleFileRequest({ req, res, url, room, scope: access.scope, owner: isOwner(req, room), fileId: filesMatch[2], dataDir, save, admit: (...args) => admit(req, ...args), canAccess: () => { if ((access.invitation && !room.folderInvitations.includes(access.invitation)) || !matchesPolicy(room.policy, identity(req, room, url.searchParams.get('name')))) throw Object.assign(new Error('Access denied: the invitation or whitelist changed during upload.'), { status: 403 }); return true; }, json, now, removeFile });
      return;
    }
    const foldersMatch = url.pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})\/folders$/);
    if (foldersMatch) {
      const access = fileAccess(req, foldersMatch[1]), room = access?.room;
      if (!room) return json(res, 403, { error: 'Invitation is invalid or unavailable on this host.' });
      if (!admit(req, room, url.searchParams.get('user'), url.searchParams.get('name'), res)) return;
      if (req.method === 'GET') return json(res, 200, inventory(room, access.scope));
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
      const input = await body(req);
      if (!stillAllowed(req, access, url.searchParams.get('name'), res)) return;
      return json(res, 200, manageFolders(room, input, { scope: access.scope, owner: isOwner(req, room), save }));
    }
  };
}
export function isFileRoute(path) { return /^\/api\/downloads\//.test(path) || /^\/api\/rooms\/[a-f0-9-]{36}\/(download-tickets|files(?:\/[^/]+)?|folders)$/.test(path); }
