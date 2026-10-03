import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDocument } from '../../../public/features/documents/document-model.js';
import { documentKind } from '../../../public/shared/document-kind.js';
import { INVITATION_CODE } from '../../../public/features/collaboration/invitations.js';
import { emptyPolicy } from '../access/access-control.js';
import { cleanupFiles } from '../files/file-sharing.js';
export function createRoomStore(dataDir, removeFile) {
  const rooms = new Map(), invitations = new Map();
  for (const filename of readdirSync(dataDir).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
    try {
      const saved = JSON.parse(readFileSync(resolve(dataDir, filename), 'utf8'));
      if (INVITATION_CODE.test(saved.code)) invitations.set(saved.code, saved.id);
      for (const invite of saved.folderInvitations || []) if (INVITATION_CODE.test(invite.code)) invitations.set(invite.code, { id: saved.id, token: invite.token });
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
    return { id: room.id, token: room.token, code: room.code, kind: room.kind };
  }
  function save(room) {
    const path = resolve(dataDir, `${room.id}.json`);
    writeFileSync(`${path}.tmp`, JSON.stringify({ id: room.id, token: room.token, code: room.code, kind: room.kind, ownerToken: room.ownerToken, policy: room.policy || emptyPolicy(), state: room.doc.snapshot(), files: room.files || [], folders: room.folders || [], folderInvitations: room.folderInvitations || [], garbage: room.garbage || [] }), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  }
  function load(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    if (rooms.has(id)) return rooms.get(id);
    const path = resolve(dataDir, `${id}.json`);
    if (!existsSync(path)) return null;
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    const room = { ...stored, policy: stored.policy || emptyPolicy(), kind: documentKind(stored.kind), doc: createDocument(stored.kind, 'server', stored.state), users: new Map() };
    if (!room.ownerToken) { room.ownerToken = randomBytes(32).toString('hex'); save(room); }
    rooms.set(id, room);
    cleanupFiles(room, dataDir, save, removeFile);
    return room;
  }
  return { rooms, invitations, makeCode, addCode, save, load };
}
