import http from 'node:http';
import { randomUUID, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document } from '../public/crdt.js';
import { manageFolders, requireFolder, inventory } from './folders.js';
import { handleFileRequest } from './file-sharing.js';
import { INVITATION_CODE } from '../public/invitations.js';
import { emptyPolicy, validatePolicy, normalizeIP, normalizeMAC, lookupLanMAC, matchesPolicy } from './access-control.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const LIMIT = 2 * 1024 * 1024;
export function createApp({ dataDir = resolve('data'), now = Date.now, lookupMAC = lookupLanMAC } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const rooms = new Map(), invitations = new Map(), attempts = new Map();
  for (const filename of readdirSync(dataDir).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
    try {
      const saved = JSON.parse(readFileSync(resolve(dataDir, filename), 'utf8'));
      if (INVITATION_CODE.test(saved.code)) invitations.set(saved.code, saved.id);
    } catch { console.warn(`Could not index invitation for ${filename}.`); }
  }
  function makeCode() {
    let code;
    do { code = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => String.fromCharCode(97 + randomInt(26))).join('')).join('-'); } while (invitations.has(code));
    return code;
  }
  function addCode(room) {
    if (!room.code) {
      room.code = makeCode();
      try { save(room); } catch (error) { delete room.code; throw error; }
      invitations.set(room.code, room.id);
    }
    return { id: room.id, token: room.token, code: room.code };
  }
  function save(room) {
    const path = resolve(dataDir, `${room.id}.json`);
    writeFileSync(`${path}.tmp`, JSON.stringify({ id: room.id, token: room.token, code: room.code, ownerToken: room.ownerToken, policy: room.policy || emptyPolicy(), state: room.doc.snapshot(), files: room.files || [], folders: room.folders || [], folderInvitations: room.folderInvitations || [], garbage: room.garbage || [] }), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  }
  function load(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    if (rooms.has(id)) return rooms.get(id);
    const path = resolve(dataDir, `${id}.json`);
    if (!existsSync(path)) return null;
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    const room = { ...stored, policy: stored.policy || emptyPolicy(), doc: new Document('server', stored.state), users: new Map() };
    if (!room.ownerToken) { room.ownerToken = randomBytes(32).toString('hex'); save(room); }
    rooms.set(id, room);
    return room;
  }
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  function authorize(req, id) {
    const room = load(id), token = (req.headers.authorization || '').replace(/^Bearer /, '');
    return room && /^[a-f0-9]{64}$/.test(token) && timingSafeEqual(Buffer.from(token), Buffer.from(room.token)) ? room : null;
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
    for (const [id, participant] of room.users) if (now() - participant.seen > 15000) room.users.delete(id);
    if (!room.users.has(user) && room.users.size >= 5) { json(res, 409, { error: 'This document is full. Five users are already collaborating.' }); return false; }
    room.users.set(user, { ...identity(req, room, name), seen: now() });
    return true;
  }
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
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, { error: 'Origin rejected' });
        const filesMatch = url.pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})\/files(?:\/([a-f0-9-]{36}))?$/);
        if (filesMatch) {
          const room = authorize(req, filesMatch[1]);
          if (!room) return json(res, 403, { error: 'Invitation is invalid or unavailable on this host.' });
          await handleFileRequest({ req, res, url, room, fileId: filesMatch[2], dataDir, save, admit: (...args) => admit(req, ...args), canAccess: () => checkAccess(req, room, url.searchParams.get('name'), res), json, now });
          return;
        }
        const foldersMatch = url.pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})\/folders$/);
        if (foldersMatch) {
          const room = authorize(req, foldersMatch[1]);
          if (!room) return json(res, 403, { error: 'Invitation is invalid or unavailable on this host.' });
          if (!admit(req, room, url.searchParams.get('user'), url.searchParams.get('name'), res)) return;
          if (req.method === 'GET') return json(res, 200, inventory(room));
          if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
          return json(res, 200, manageFolders(room, await body(req), { owner: isOwner(req, room), save }));
        }
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
          const id = invitations.get(code), room = id && load(id);
          if (!room) {
            attempt.count++; if (attempts.size < 1000 || attempts.has(address)) attempts.set(address, attempt);
            return json(res, 404, { error: 'Invitation code was not found on this LAN host.' });
          }
          if (!checkAccess(req, room, input.name, res)) return;
          attempts.delete(address);
          return json(res, 200, { id: room.id, token: room.token, code: room.code });
        }
        if (url.pathname === '/api/rooms') {
          const doc = new Document('server', input.state);
          const room = { id: randomUUID(), token: randomBytes(32).toString('hex'), code: makeCode(), ownerToken: randomBytes(32).toString('hex'), policy: input.policy === undefined ? emptyPolicy() : validatePolicy(input.policy), doc, users: new Map() };
          save(room); rooms.set(room.id, room); invitations.set(room.code, room.id);
          return json(res, 201, { id: room.id, token: room.token, code: room.code, ownerToken: room.ownerToken });
        }
        const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/(sync|leave|invitation|access)$/);
        const room = match && authorize(req, match[1]);
        if (!room) return json(res, 403, { error: 'Invitation is invalid or unavailable on this host.' });
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
        for (const [id, user] of room.users) if (now() - user.seen > 15000) room.users.delete(id);
        if (match[2] === 'leave') { room.users.delete(input.user); return json(res, 200, { ok: true }); }
        if (!room.users.has(input.user) && room.users.size >= 5) return json(res, 409, { error: 'This document is full. Five users are already collaborating.' });
        const candidate = new Document('server', room.doc.snapshot());
        candidate.merge(input.state);
        if (Buffer.byteLength(JSON.stringify(candidate.snapshot())) > LIMIT) return json(res, 413, { error: 'Document exceeds the 2 MB sync limit. Export a backup.' });
        const changed = JSON.stringify(candidate.snapshot()) !== JSON.stringify(room.doc.snapshot());
        const previous = room.doc;
        room.doc = candidate;
        try { if (changed) save(room); } catch (error) { room.doc = previous; throw error; }
        room.users.set(input.user, { ...identity(req, room, input.name), seen: now() });
        return json(res, 200, { state: room.doc.snapshot(), users: [...room.users].map(([id, user]) => ({ id, name: user.name })), limit: 5 });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
      const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/crdt.js': 'crdt.js', '/styles.css': 'styles.css', '/sw.js': 'sw.js', '/vim.js': 'vim.js', '/images.js': 'images.js', '/markdown.js': 'markdown.js', '/files.js': 'files.js', '/vim-cursor.js': 'vim-cursor.js', '/invitations.js': 'invitations.js', '/access.js': 'access.js', '/editor-size.js': 'editor-size.js', '/usernames.js': 'usernames.js', '/policy.js': 'policy.js', '/defaults.js': 'defaults.js' };
      const file = INVITATION_CODE.test(url.pathname.slice(1)) ? 'index.html' : files[url.pathname];
      if (!file) return json(res, 404, { error: 'Not found' });
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : readFileSync(resolve(root, file)));
    } catch (error) {
      json(res, error.status || (error.message.startsWith('Invalid') || error.message.startsWith('Conflicting') ? 400 : 500), { error: error.status || /^(Invalid|Conflicting)/.test(error.message) ? error.message : 'The host could not save this document. Your local copy is retained.' });
    }
  });
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, process.env.HOST || '0.0.0.0', () => console.log(`DocDoc: http://localhost:${port} — share this host's LAN address with collaborators.`));
}
