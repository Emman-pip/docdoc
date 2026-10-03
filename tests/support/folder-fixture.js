import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/features/rooms/http.js';
import { Document } from '../../public/features/documents/crdt.js';
import { request } from './request-helper.js';
export async function fixture(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'docdoc-folders-')); t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const server = createApp({ dataDir, ...options });
  const room = await (await request(server, '/api/rooms', { method: 'POST', body: { state: new Document('owner').snapshot() } })).json();
  const headers = { Authorization: `Bearer ${room.token}`, 'X-Owner-Key': room.ownerToken }, base = `/api/rooms/${room.id}`;
  const call = (route, body, auth = headers) => request(server, `${base}/${route}?user=owner&name=Alice`, { method: 'POST', headers: auth, body });
  const root = (await (await call('folders', { action: 'create', name: 'Private parent' })).json()).folder;
  const folder = (await (await call('folders', { action: 'create', name: 'Shared', parentId: root.id })).json()).folder;
  const invitation = (await (await call('folder-invitations', { action: 'create', folderId: folder.id })).json()).invitations[0];
  const guest = await (await request(server, '/api/invitations/join', { method: 'POST', body: { code: invitation.code, user: 'guest', name: 'Alice' } })).json();
  return { server, dataDir, room, headers, base, call, root, folder, invitation, guest, guestHeaders: { Authorization: `Bearer ${guest.token}` } };
}
