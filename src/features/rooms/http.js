import { createRoomStore } from './store.js';
import { createRoomAccess } from '../access/room-access.js';
import { createFileRoutes, isFileRoute } from '../files/routes.js';
import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocument } from '../../../public/features/documents/document-model.js';
import { documentKind, requireKind } from '../../../public/shared/document-kind.js';
import { requireFolder } from '../files/folders.js';
import { cleanupTemporaryFiles } from '../files/file-sharing.js';
import { INVITATION_CODE } from '../../../public/features/collaboration/invitations.js';
import { emptyPolicy, validatePolicy, lookupLanMAC, matchesPolicy } from '../access/access-control.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public');
const LIMIT = 2 * 1024 * 1024;
export function createApp({ dataDir = resolve('data'), now = Date.now, lookupMAC = lookupLanMAC, removeFile } = {}) {
  mkdirSync(dataDir, { recursive: true });
  cleanupTemporaryFiles(dataDir);
  const { rooms, invitations, makeCode, addCode, save, load } = createRoomStore(dataDir, removeFile);
  const attempts = new Map();
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const { authorize, fileAccess, stillAllowed, isOwner, identity, checkAccess, admit } = createRoomAccess({ load, now, lookupMAC, json });
  async function body(req) {
    let size = 0, chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > LIMIT) throw Object.assign(new Error('Document exceeds the 2 MB sync limit. Export a backup.'), { status: 413 });
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  }
  const handleFiles = createFileRoutes({ dataDir, save, admit, fileAccess, stillAllowed, isOwner, identity, json, body, now, removeFile });
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, { error: 'Origin rejected' });
        if (isFileRoute(url.pathname)) return await handleFiles(req, res, url);
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
        const input = await body(req);
        if (!input || typeof input !== 'object') return json(res, 400, { error: 'Invalid request' });
        if (url.pathname === '/api/invitations/join') {
          const code = String(input.code || '').trim().toLowerCase();
          if (!INVITATION_CODE.test(code)) return json(res, 400, { error: 'Enter a code like xyz-jnk-dvc.' });
          const address = req.socket?.remoteAddress || 'local';
          for (const [key, value] of attempts) if (now() - value.started > 60000) attempts.delete(key);
          const attempt = attempts.get(address) || { started: now(), count: 0 };
          if (attempt.count >= 10) return json(res, 429, { error: 'Too many incorrect invitation codes. Try again in a minute.' });
          const entry = invitations.get(code), room = entry && load(typeof entry === 'string' ? entry : entry.id);
          const folderInvite = room && typeof entry === 'object' && (room.folderInvitations || []).find(invite => invite.token === entry.token && (room.folders || []).some(folder => folder.id === invite.folderId));
          if (!room || (typeof entry === 'object' && !folderInvite)) {
            attempt.count++; if (attempts.size < 1000 || attempts.has(address)) attempts.set(address, attempt);
            return json(res, 404, { error: 'Invitation code was not found on this LAN host.' });
          }
          if (!checkAccess(req, room, input.name, res)) return;
          if (folderInvite) {
            if (!admit(req, room, input.user, input.name, res)) return;
            attempts.delete(address);
            return json(res, 200, { id: room.id, token: folderInvite.token, code: folderInvite.code, folderId: folderInvite.folderId, kind: 'folder' });
          }
          attempts.delete(address);
          return json(res, 200, { id: room.id, token: room.token, code: room.code, kind: room.kind });
        }
        if (url.pathname === '/api/rooms') {
          const kind = documentKind(input.kind);
          if (input.state === undefined) throw new Error('Invalid document state.');
          const doc = createDocument(kind, 'server', input.state);
          const room = { kind, id: randomUUID(), token: randomBytes(32).toString('hex'), code: makeCode(), ownerToken: randomBytes(32).toString('hex'), policy: input.policy === undefined ? emptyPolicy() : validatePolicy(input.policy), doc, users: new Map() };
          save(room); rooms.set(room.id, room); invitations.set(room.code, room.id);
          return json(res, 201, { id: room.id, token: room.token, code: room.code, kind: room.kind, ownerToken: room.ownerToken });
        }
        const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/(sync|leave|invitation|access|folder-invitations)$/);
        const room = match && authorize(req, match[1]);
        if (!room) return json(res, 403, { error: 'Invitation is invalid or unavailable on this host.' });
        if (match[2] === 'folder-invitations') {
          if (!isOwner(req, room)) return json(res, 403, { error: 'Only the session owner can manage folder invitations.' });
          room.folderInvitations ||= [];
          const previous = room.folderInvitations;
          let invitation;
          if (input.action === 'create') {
            requireFolder(room, input.folderId);
            if (!input.folderId) return json(res, 400, { error: 'Select a folder to share.' });
            if (previous.length >= 1000) return json(res, 413, { error: 'Revoke an invitation before creating more.' });
            invitation = { folderId: input.folderId, token: randomBytes(32).toString('hex'), code: makeCode() };
            room.folderInvitations = [...previous, invitation];
          } else if (input.action === 'revoke') room.folderInvitations = previous.filter(item => item.code !== input.code);
          else if (input.action !== 'list') return json(res, 400, { error: 'Invalid invitation action' });
          try { save(room); } catch (error) { room.folderInvitations = previous; throw error; }
          if (invitation) invitations.set(invitation.code, { id: room.id, token: invitation.token });
          if (input.action === 'revoke' && previous.some(item => item.code === input.code)) invitations.delete(input.code);
          return json(res, 200, { invitations: room.folderInvitations.map(({ code, folderId }) => ({ code, folderId })) });
        }
        if (match[2] === 'access') {
          if (!isOwner(req, room)) return json(res, 403, { error: 'Only the session owner can manage the whitelist. Supply the owner key saved on the host for an older session.' });
          if (input.action === 'set') {
            const previous = room.policy; room.policy = validatePolicy(input.policy);
            try { save(room); } catch (error) { room.policy = previous; throw error; }
            for (const [id, participant] of room.users) if (!matchesPolicy(room.policy, participant)) room.users.delete(id);
          } else if (input.action !== 'get') return json(res, 400, { error: 'Invalid whitelist action' });
          return json(res, 200, { policy: room.policy, connection: identity(req, room, input.name), participants: [...room.users].map(([id, participant]) => ({ id, name: participant.name, ip: participant.ip, mac: participant.mac })) });
        }
        if (!checkAccess(req, room, input.name, res)) return;
        if (match[2] === 'invitation') return json(res, 200, addCode(room));
        if (typeof input.user !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(input.user)) return json(res, 400, { error: 'Invalid user identity' });
        for (const [id, user] of room.users) if (now() - user.seen > 15000 && !room.activeTransfers?.get(id)) room.users.delete(id);
        if (match[2] === 'leave') { room.users.delete(input.user); return json(res, 200, { ok: true }); }
        if (!room.users.has(input.user) && room.users.size >= 5) return json(res, 409, { error: 'This document is full. Five users are already collaborating.' });
        requireKind(room.kind, input.kind);
        const candidate = createDocument(room.kind, 'server', room.doc.snapshot());
        try {
          const incoming = createDocument(room.kind, 'incoming', input.state);
          if (input.state === undefined) throw new Error('Invalid document state.');
          candidate.merge(incoming.snapshot()); incoming.destroy?.();
        } catch (error) { candidate.destroy?.(); throw error; }
        if (Buffer.byteLength(JSON.stringify(candidate.snapshot())) > LIMIT) { candidate.destroy?.(); return json(res, 413, { error: 'Document exceeds the 2 MB sync limit. Export a backup.' }); }
        const changed = JSON.stringify(candidate.snapshot()) !== JSON.stringify(room.doc.snapshot());
        const previous = room.doc;
        room.doc = candidate;
        try { if (changed) save(room); } catch (error) { room.doc = previous; candidate.destroy?.(); throw error; }
        previous.destroy?.();
        room.users.set(input.user, { ...identity(req, room, input.name), seen: now() });
        return json(res, 200, { kind: room.kind, state: room.doc.snapshot(), users: [...room.users].map(([id, user]) => ({ id, name: user.name })), limit: 5 });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
      const name = url.pathname === '/' || INVITATION_CODE.test(url.pathname.slice(1)) ? 'index.html' : url.pathname.slice(1);
      const license = /^assets\/[a-zA-Z0-9_-]+\.js\.LEGAL\.txt$/.test(name);
      const allowed = license || ['index.html', 'styles.css', 'sw.js', 'app.js', 'icons.svg'].includes(name) || /^(assets|features|shared)\/[a-zA-Z0-9_/-]+\.js$/.test(name);
      const file = allowed && !name.includes('..') && existsSync(resolve(root, name)) ? name : null;
      if (!file) return json(res, 404, { error: 'Not found. Run npm run build if browser assets are missing.' });
      const type = license ? 'text/plain' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : readFileSync(resolve(root, file)));
    } catch (error) {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      json(res, error.status || (error.message.startsWith('Invalid') || error.message.startsWith('Conflicting') ? 400 : 500), { error: error.status || /^(Invalid|Conflicting)/.test(error.message) ? error.message : 'The host could not save this document. Your local copy is retained.' });
    }
  });
  // Large LAN uploads may legitimately take longer than Node’s five-minute default.
  server.requestTimeout = 0;
  return server;
}
