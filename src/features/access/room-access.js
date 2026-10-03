import { timingSafeEqual } from 'node:crypto';
import { normalizeIP, normalizeMAC, matchesPolicy } from './access-control.js';
export function createRoomAccess({ load, now, lookupMAC, json }) {
  function authorize(req, id) {
    const room = load(id), token = (req.headers.authorization || '').replace(/^Bearer /, '');
    return room && /^[a-f0-9]{64}$/.test(token) && timingSafeEqual(Buffer.from(token), Buffer.from(room.token)) ? room : null;
  }
  function fileAccess(req, id) {
    const room = load(id);
    if (!room) return null;
    if (authorize(req, id)) return { room, scope: null, invitation: null };
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const invitation = (room.folderInvitations || []).find(item => item.token === token);
    if (!invitation || !(room.folders || []).some(folder => folder.id === invitation.folderId)) return null;
    return { room, scope: invitation.folderId, invitation };
  }
  function stillAllowed(req, access, name, res) {
    if (access.invitation && !access.room.folderInvitations.includes(access.invitation)) { json(res, 403, { error: 'Folder invitation was revoked.' }); return false; }
    return checkAccess(req, access.room, name, res);
  }
  function isOwner(req, room) {
    const key = req.headers['x-owner-key'] || '';
    return /^[a-f0-9]{64}$/.test(key) && typeof room.ownerToken === 'string' && timingSafeEqual(Buffer.from(key), Buffer.from(room.ownerToken));
  }
  function identity(req, room, name) {
    const ip = normalizeIP(req.socket?.remoteAddress);
    return { ip, mac: normalizeMAC(lookupMAC(ip)), name: String(name || 'Collaborator').trim().slice(0, 40), owner: isOwner(req, room) };
  }
  function checkAccess(req, room, name, res) {
    if (matchesPolicy(room.policy, identity(req, room, name))) return true;
    json(res, 403, { error: 'Access denied: your IP address, username, or detected MAC address is not on this session’s whitelist.' });
    return false;
  }
  function admit(req, room, user, name, res) {
    if (!checkAccess(req, room, name, res)) return false;
    if (typeof user !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(user)) { json(res, 400, { error: 'Invalid user identity' }); return false; }
    for (const [id, participant] of room.users) if (now() - participant.seen > 15000 && !room.activeTransfers?.get(id)) room.users.delete(id);
    if (!room.users.has(user) && room.users.size >= 5) { json(res, 409, { error: 'This document is full. Five users are already collaborating.' }); return false; }
    room.users.set(user, { ...identity(req, room, name), seen: now() });
    return true;
  }
  return { authorize, fileAccess, stillAllowed, isOwner, identity, checkAccess, admit };
}
