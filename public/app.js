import { generateUsername, initializeUsername } from './usernames.js';
import { Document } from './crdt.js';
import { attachVimControls } from './vim.js';
import { attachVimCursor } from './vim-cursor.js';
import { attachEditorSize } from './editor-size.js';
import { normalizeCode, invitationLink, invitationFromLocation } from './invitations.js';
import { preparePhoto, exportMarkdown, IMAGE_LINK } from './images.js';
import { renderMarkdown } from './markdown.js';
import { attachFileSharing } from './files.js';
import { attachAccessControls } from './access.js';
const $ = id => document.getElementById(id);
const uuid = () => globalThis.crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15; return (c === 'x' ? r : (r & 3) | 8).toString(16); });
const actor = uuid();
const KEY = 'docdoc.documents.v1';
let user, records = [], current, doc, history = [], syncing = false, generation = 0, composing = false;
const notice = message => { $('notice').textContent = message; $('notice').hidden = !message; };
$('name').value = generateUsername();
try {
  user = localStorage.getItem('docdoc.user') || uuid();
  localStorage.setItem('docdoc.user', user);
  records = JSON.parse(localStorage.getItem(KEY) || '[]');
  if (!Array.isArray(records)) throw new Error('Invalid local document list');
  $('name').value = initializeUsername(localStorage);
} catch {
  user = uuid();
  notice('Browser storage is unavailable or unreadable. Export your work before closing this page.');
}
function persist() {
  if (!current) return;
  current.updated = Date.now();
  try {
    // Preserve documents created in another tab rather than replacing its index.
    const stored = JSON.parse(localStorage.getItem(KEY) || '[]');
    const refresh = updateEditor();
    for (const saved of stored) {
      const existing = records.find(record => record.id === saved.id);
      if (!existing) records.push(saved);
      else if (existing === current) doc.merge(saved.state);
      else {
        const merged = new Document(actor, existing.state); merged.merge(saved.state);
        existing.state = merged.snapshot();
      }
    }
    refresh();
    current.state = doc.snapshot();
    localStorage.setItem(KEY, JSON.stringify(records));
    $('save-status').textContent = 'Saved in this browser · just now';
  } catch { current.state = doc.snapshot(); $('save-status').textContent = 'Local save failed — export a backup'; notice('Browser storage could not save your changes. Keep this page open and export a backup.'); }
  renderList();
}
function renderList() {
  $('documents').replaceChildren();
  $('doc-count').textContent = records.length;
  const query = $('search').value.toLowerCase();
  for (const record of [...records].sort((a, b) => b.updated - a.updated)) {
    const title = record.state.title?.value || 'Untitled document';
    if (!title.toLowerCase().includes(query)) continue;
    const button = document.createElement('button');
    button.textContent = title; button.className = record.id === current?.id ? 'active' : ''; button.title = title;
    button.onclick = () => open(record);
    $('documents').append(button);
  }
}
function counts() {
  const value = doc.text();
  $('word-count').textContent = `${value.trim() ? value.trim().split(/\s+/).length : 0} words · ${value.length} characters`;
  if (!$('preview').hidden) preview();
  renderPhotos();
  editorSize.fit();
  vimCursor.update();
}
function updateEditor() {
  const editor = $('editor'), before = doc.visible();
  const start = editor.selectionStart, end = editor.selectionEnd, direction = editor.selectionDirection;
  return () => {
    const after = doc.visible();
    const position = index => {
      if (!index) return 0;
      for (let i = Math.min(index, before.length) - 1; i >= 0; i--) {
        const found = after.findIndex(node => node.id === before[i].id);
        if (found >= 0) return found + 1;
      }
      return 0;
    };
    editor.value = doc.text();
    editor.setSelectionRange(position(start), position(end), direction);
    if (document.activeElement !== $('title')) $('title').value = doc.title.value;
    counts();
  };
}
function open(record) {
  generation++; syncing = false; current = record; history = [];
  doc = new Document(actor, record.state);
  vim.reset();
  showEditing();
  $('editor').value = doc.text(); $('title').value = doc.title.value;
  $('connection').textContent = record.room ? 'Connecting to your collaborators…' : 'Private document';
  $('people').textContent = 'Only you · 1 / 5';
  $('connection-dot').classList.remove('offline');
  $('save-status').textContent = 'Saved in this browser';
  notice(''); renderList(); counts();
  fileSharing.reset();
  sync();
}
function create(title = 'Untitled document', content = '') {
  const fresh = new Document(actor); fresh.rename(title); fresh.edit(content);
  const record = { id: uuid(), state: fresh.snapshot(), updated: Date.now() };
  records.push(record); open(record); persist();
}
async function request(path, input, token, ownerToken) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ownerToken ? { 'X-Owner-Key': ownerToken } : {}) }, body: JSON.stringify(input), signal: AbortSignal.timeout(8000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The host could not synchronize this document.');
  return result;
}
async function sync() {
  if (!current?.room || syncing || composing) return;
  const selected = current, selectedDoc = doc, version = generation;
  syncing = true;
  try {
    const result = await request(`/api/rooms/${selected.room.id}/sync`, { user, name: $('name').value || 'Collaborator', state: selectedDoc.snapshot() }, selected.room.token, selected.room.ownerToken);
    if (version !== generation || composing) return;
    const refresh = updateEditor();
    selectedDoc.merge(result.state); refresh(); persist();
    $('connection').textContent = 'Live on your local network';
    $('connection-dot').classList.remove('offline');
    $('people').textContent = `${result.users.map(person => person.id === user ? `${person.name} (you)` : person.name).join(', ')} · ${result.users.length} / 5`;
    notice('');
  } catch (error) {
    if (version !== generation) return;
    $('connection').textContent = 'Disconnected · editing locally';
    $('connection-dot').classList.add('offline');
    $('people').textContent = 'Collaboration paused';
    notice(error.message.includes('fetch') || error.name === 'TimeoutError' ? 'The LAN host is unreachable. Keep writing; your local changes will synchronize when it returns.' : error.message);
  } finally { if (version === generation) syncing = false; }
}
function edit() {
  const beforeNodes = new Set(doc.nodes.keys()), beforeDeleted = new Set(doc.deleted);
  const visible = doc.visible();
  doc.edit($('editor').value);
  const inserted = [...doc.nodes.keys()].filter(id => !beforeNodes.has(id));
  const removed = visible.filter(node => doc.deleted.has(node.id) && !beforeDeleted.has(node.id));
  if (inserted.length || removed.length) history.push({ inserted, removed });
  persist(); counts();
}
$('editor').addEventListener('input', () => { if (!composing) edit(); });
$('editor').addEventListener('compositionstart', () => { composing = true; });
$('editor').addEventListener('compositionend', () => { composing = false; edit(); });
$('title').addEventListener('input', () => { doc.rename($('title').value); persist(); });
$('title').addEventListener('blur', () => { if (!$('title').value.trim()) { doc.rename('Untitled document'); $('title').value = doc.title.value; persist(); } });
$('new').onclick = () => create();
$('search').oninput = renderList;
$('name').onchange = () => { try { localStorage.setItem('docdoc.name', $('name').value); } catch {} sync(); };
function undo() {
  const entry = history.pop(); if (!entry) return;
  for (const id of entry.inserted) doc.deleted.add(id);
  let after = entry.removed[0]?.after || '';
  for (const node of entry.removed) {
    const clock = ++doc.clock, id = `${actor}:${clock}`;
    doc.nodes.set(id, { id, after, value: node.value, actor, clock }); after = id;
  }
  $('editor').value = doc.text(); persist(); counts();
}
$('undo').onclick = undo;
function showEditing() {
  $('preview').hidden = true; $('editor').hidden = false;
  $('preview-toggle').setAttribute('aria-pressed', 'false'); $('preview-toggle').textContent = 'Preview';
  if (doc) renderPhotos();
  editorSize.fit();
  vimCursor.update();
}
const editorSize = attachEditorSize($('editor'));
const vimCursor = attachVimCursor($('editor'), $('vim-cursor'), $('cursor-mirror'));
const vim = attachVimControls({
  editor: $('editor'), toggle: $('vim-toggle'), indicator: $('vim-status'), selector: $('vim-mode'),
  modeLabel: $('vim-mode-label'), hint: $('vim-hint'), onEdit: edit, onUndo: undo,
  readPreference: () => localStorage.getItem('docdoc.vim') === 'true',
  savePreference: enabled => localStorage.setItem('docdoc.vim', String(enabled)),
  onActivate: showEditing,
  onCursorMode: mode => vimCursor.setMode(mode),
});
for (const button of document.querySelectorAll('[data-format]')) button.onclick = () => {
  const editor = $('editor'), start = editor.selectionStart, end = editor.selectionEnd;
  const selection = editor.value.slice(start, end) || 'text';
  const formatted = { heading: `# ${selection}`, bold: `**${selection}**`, italic: `*${selection}*`, list: selection.split('\n').map(line => `- ${line}`).join('\n'), quote: selection.split('\n').map(line => `> ${line}`).join('\n') }[button.dataset.format];
  editor.setRangeText(formatted, start, end, 'select'); edit(); editor.focus();
};
function preview() {
  $('preview').innerHTML = renderMarkdown(doc.text(), doc.images);
}
function renderPhotos() {
  $('photos').replaceChildren();
  const links = [...doc.text().matchAll(IMAGE_LINK)];
  $('photos').hidden = !links.length || !$('preview').hidden;
  for (const [, alt, id] of links) {
    const image = doc.images.get(id);
    if (!image) continue;
    const figure = document.createElement('figure'), img = document.createElement('img'), caption = document.createElement('figcaption');
    img.src = image.data; img.alt = alt; img.loading = 'lazy';
    caption.textContent = alt || 'Photo'; figure.append(img, caption); $('photos').append(figure);
  }
}
let photoTarget;
$('upload-photo').onclick = () => {
  const visible = doc.visible(), index = $('editor').selectionStart;
  photoTarget = { record: current, anchor: index ? visible[index - 1]?.id : null, version: generation };
  $('photo-input').click();
};
$('photo-input').onchange = async () => {
  const file = $('photo-input').files[0], target = photoTarget;
  $('photo-input').value = '';
  if (!file || !target) return;
  $('upload-photo').disabled = true;
  try {
    const data = await preparePhoto(file);
    if (target.record !== current || target.version !== generation) throw new Error('The document changed while the photo was processing. Select the photo again.');
    const id = uuid(), image = { id, data };
    const visible = doc.visible(), found = target.anchor ? visible.findIndex(node => node.id === target.anchor) : -1;
    const index = found >= 0 ? found + 1 : 0;
    const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]\r\n]/g, ' ').slice(0, 100) || 'Photo';
    const insertion = `\n![${alt}](docdoc-image:${id})\n`;
    const candidate = new Document(actor, doc.snapshot());
    candidate.addImage(image);
    candidate.edit(doc.text().slice(0, index) + insertion + doc.text().slice(index));
    if (new TextEncoder().encode(JSON.stringify(candidate.snapshot())).length > 1900 * 1024) throw new Error('This document is too large for another photo. Use a smaller photo or a new document.');
    doc.addImage(image);
    $('editor').setRangeText(insertion, index, index, 'end'); edit();
    notice('Photo added. Open Preview to see it in the document.');
  } catch (error) { notice(error.message); }
  finally { $('upload-photo').disabled = false; }
};
$('preview-toggle').onclick = () => {
  const show = $('preview').hidden;
  $('preview').hidden = !show; $('editor').hidden = show;
  $('preview-toggle').setAttribute('aria-pressed', String(show));
  $('preview-toggle').textContent = show ? 'Edit' : 'Preview';
  preview(); renderPhotos(); editorSize.fit(); vimCursor.update();
};
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([exportMarkdown(doc.text(), doc.images)], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${doc.title.value.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'document'}.md`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
let creatingRoom;
async function ensureRoom(selected = current) {
  if (selected.room) return selected.room;
  if (creatingRoom?.record === selected) return creatingRoom.promise;
  const selectedDoc = doc;
  const promise = request('/api/rooms', { state: selectedDoc.snapshot() }).then(room => {
    selected.room = room;
    if (selected === current) { persist(); sync(); }
    return room;
  });
  creatingRoom = { record: selected, promise };
  try { return await promise; } finally { if (creatingRoom?.promise === promise) creatingRoom = null; }
}
const fileSharing = attachFileSharing({ $, user, getCurrent: () => current, getName: () => $('name').value, ensureRoom });
attachAccessControls({ $, getCurrent: () => current, getName: () => $('name').value, ensureRoom, persist, sync });
$('share').onclick = async () => {
  const selected = current;
  $('share').disabled = true;
  try {
    await ensureRoom(selected);
    if (selected !== current) return;
    if (!selected.room.code) {
      const invitation = await request(`/api/rooms/${selected.room.id}/invitation`, { name: $('name').value }, selected.room.token, selected.room.ownerToken);
      selected.room.code = invitation.code;
      if (selected !== current) return;
      persist();
    }
    $('invite-code').value = selected.room.code;
    $('invite').value = invitationLink(location.origin, selected.room.code);
    $('share-dialog').showModal(); sync();
  } catch (error) { notice(`Could not share: ${error.message}. Your document is still available locally.`); }
  finally { $('share').disabled = false; }
};
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('invite').value); $('copy').textContent = 'Copied!'; setTimeout(() => $('copy').textContent = 'Copy invitation', 2000); }
  catch { $('invite').select(); $('copy').textContent = 'Select the link and copy it manually'; }
};
$('copy-code').onclick = async () => {
  try { await navigator.clipboard.writeText($('invite-code').value); $('copy-code').textContent = 'Copied!'; setTimeout(() => $('copy-code').textContent = 'Copy code', 2000); }
  catch { $('invite-code').select(); $('copy-code').textContent = 'Select and copy the code'; }
};
$('delete').onclick = () => {
  if (!confirm(`Delete “${doc.title.value}” from this browser? Shared copies on the host and other devices will remain.`)) return;
  const removed = current;
  records = records.filter(record => record.id !== removed.id);
  try { localStorage.setItem(KEY, JSON.stringify(records)); } catch { notice('Could not delete from browser storage.'); return; }
  if (removed.room) request(`/api/rooms/${removed.room.id}/leave`, { user, name: $('name').value }, removed.room.token, removed.room.ownerToken).catch(() => {});
  if (records.length) open(records[0]); else create();
};
function openInvitation(room) {
  let record = records.find(item => item.room?.id === room.id && item.room?.token === room.token);
  if (!record) { record = { id: uuid(), state: new Document(actor).snapshot(), updated: Date.now(), room }; records.push(record); }
  else record.room = { ...record.room, ...room };
  open(record); persist();
  window.history.replaceState(null, '', '/');
}
async function joinCode(value) {
  const code = normalizeCode(value), selectedGeneration = generation, selectedClock = doc.clock;
  const local = records.find(record => record.room?.code === code);
  const room = local?.room || await request('/api/invitations/join', { code, name: $('name').value });
  if (generation !== selectedGeneration || doc.clock !== selectedClock) throw new Error('The document changed while joining. Enter the invitation code again.');
  openInvitation(room);
}
async function joinInvitation() {
  const invitation = invitationFromLocation(location);
  if (!invitation) return;
  try {
    if (invitation.room) openInvitation(invitation.room);
    else await joinCode(invitation.code);
  } catch (error) { notice(`Could not join: ${error.message}`); }
}
$('join-code').onclick = () => { $('join-error').textContent = ''; $('join-name').value = $('name').value; $('join-dialog').showModal(); };
$('join-form').onsubmit = async event => {
  event.preventDefault(); $('join-submit').disabled = true; $('join-error').textContent = 'Joining…';
  try { $('name').value = $('join-name').value.trim(); try { localStorage.setItem('docdoc.name', $('name').value); } catch {} await joinCode($('join-input').value); $('join-dialog').close(); $('join-input').value = ''; }
  catch (error) { $('join-error').textContent = error.message; }
  finally { $('join-submit').disabled = false; }
};
window.addEventListener('hashchange', joinInvitation);
window.addEventListener('online', sync);
window.addEventListener('storage', event => {
  if (event.key !== KEY || !event.newValue) return;
  try {
    const incoming = JSON.parse(event.newValue), matching = incoming.find(record => record.id === current.id);
    if (matching && !composing) { const refresh = updateEditor(); doc.merge(matching.state); current.state = doc.snapshot(); refresh(); }
    for (const record of incoming) if (!records.some(item => item.id === record.id)) records.push(record);
    renderList();
  } catch { notice('A change from another tab could not be loaded. Export a backup.'); }
});
{
  if (records.length) open([...records].sort((a, b) => b.updated - a.updated)[0]);
  else create('A fresh start', '# A fresh start\n\nWelcome to your quiet corner of the internet.\n\nWrite something worth sharing. Your words are saved in this browser, so you can keep going even when the network takes a break.\n\n## Better ideas, together\n\n- Create a document and make it yours.\n- Share an invitation with your team on the LAN.\n- Collaborate with up to five people at once.\n\nA little space. A lot of possibility.');
}
joinInvitation();
setInterval(() => { sync(); fileSharing.refresh(); }, 2000);
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
