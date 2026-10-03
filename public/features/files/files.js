import { buttonLabel } from '../../shared/icons.js';
export const MAX_FILE_BYTES = 1073741824;
export const readableSize = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : bytes < MAX_FILE_BYTES ? `${(bytes / 1048576).toFixed(1)} MiB` : `${(bytes / MAX_FILE_BYTES).toFixed(2)} GiB`;
export function uploadSegments(file) {
  const parts = (file.webkitRelativePath || file.name).split('/');
  if (parts.some(part => !part.trim() || part !== part.trim() || part.length > 200 || /[\x00-\x1f\x7f\\]/.test(part) || part === '.' || part === '..')) throw new Error('Invalid upload path. Remove empty names, traversal segments, or slashes from names.');
  return parts;
}
const randomKey = () => [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
export function attachFileSharing({ $, user, getCurrent, getName, ensureRoom, exitFocus = () => {} }) {
  let active = false, refreshing = false, uploading = false, version = 0, lastRefresh = 0, folderId = null;
  let inventory = { files: [], folders: [] }, queue = [], uploadTarget, controller, cancelled = false, moveTarget, inviteTarget;
  const deletionKeys = new Map(); let deletionWarning = '';
  const status = message => { $('file-status').textContent = message; };
  const headers = room => ({ Authorization: `Bearer ${room.token}`, ...(room.ownerToken ? { 'X-Owner-Key': room.ownerToken } : {}) });
  const path = (room, route, query = {}) => `/api/rooms/${room.id}/${route}?${new URLSearchParams({ user, name: getName() || 'Collaborator', ...query })}`;
  async function call(room, route, { method = 'GET', body, query, signal, extraHeaders } = {}) {
    const response = await fetch(path(room, route, query), { method, headers: { ...headers(room), ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }, body: body ? JSON.stringify(body) : undefined, signal: signal || AbortSignal.timeout(15000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'File request failed.'); return result;
  }
  const keyName = (room, file) => `docdoc.file-delete.${room.id}.${file.id}`;
  function deletionKey(room, file) {
    try { return deletionKeys.get(keyName(room, file)) || localStorage.getItem(keyName(room, file)); } catch { return deletionKeys.get(keyName(room, file)); }
  }
  function saveDeletionKey(room, result) {
    if (!result.deletionToken) return;
    const key = keyName(room, result.file); deletionKeys.set(key, result.deletionToken);
    try { localStorage.setItem(key, result.deletionToken); } catch { deletionWarning = ' This browser could not save a deletion key. Keep this page open or ask the owner to delete that file.'; }
  }
  function button(label, action, image) {
    const element = document.createElement('button'); buttonLabel(element, label, image); element.onclick = action; return element;
  }
  async function perform(action) {
    try { await action(); } catch (error) { status(error.message); }
  }
  async function download(room, target) {
    const ticket = await call(room, 'download-tickets', { method: 'POST', body: { ...target, user, name: getName() } });
    const link = document.createElement('a'); link.href = ticket.url; link.download = ''; link.click();
  }
  function folderPath(id) {
    const names = [], seen = new Set();
    while (id && !seen.has(id)) { seen.add(id); const folder = inventory.folders.find(item => item.id === id); if (!folder) break; names.unshift(folder.name); id = folder.parentId; }
    return names.join(' / ') || 'All files';
  }
  function openFolder(id) { folderId = id; render(getCurrent().room); }
  function chooseMove(room, item, kind) {
    moveTarget = { room, item, kind, version }; $('move-destination').replaceChildren();
    for (const folder of [{ id: '', name: 'All files' }, ...inventory.folders]) {
      const option = document.createElement('option'); option.value = folder.id; option.textContent = folder.id ? folderPath(folder.id) : folder.name; $('move-destination').append(option);
    }
    $('move-status').textContent = ''; $('move-dialog').showModal();
  }
  function render(room) {
    const root = inventory.rootFolderId || null;
    if (folderId && !inventory.folders.some(folder => folder.id === folderId)) folderId = root;
    $('folder-share').hidden = !room.ownerToken; $('folder-share').disabled = !folderId;
    $('file-breadcrumbs').replaceChildren();
    const ancestors = []; let id = folderId;
    while (id) { const folder = inventory.folders.find(item => item.id === id); if (!folder) break; ancestors.unshift(folder); id = folder.parentId; }
    if (!root) $('file-breadcrumbs').append(button('All files', () => openFolder(null), 'folder'));
    for (const folder of ancestors) $('file-breadcrumbs').append(button(folder.name, () => openFolder(folder.id), 'folder'));
    $('file-list').replaceChildren();
    for (const folder of inventory.folders.filter(item => item.parentId === folderId && item.id !== root)) {
      const row = document.createElement('div'); row.className = 'file-row';
      row.append(button(folder.name, () => openFolder(folder.id), 'folder'));
      if (room.ownerToken) {
        row.append(button('Rename', () => perform(async () => { const name = prompt('Folder name', folder.name); if (name === null) return; await call(room, 'folders', { method: 'POST', body: { action: 'rename', id: folder.id, name } }); await refresh(true); })));
        row.append(button('Move', () => chooseMove(room, folder, 'folder')));
        row.append(button('Delete', () => perform(async () => { if (!confirm(`Delete empty folder “${folder.name}”?`)) return; await call(room, 'folders', { method: 'POST', body: { action: 'delete', id: folder.id } }); await refresh(true); }), 'trash'));
      }
      $('file-list').append(row);
    }
    for (const file of inventory.files.filter(item => (item.folderId || null) === folderId)) {
      const row = document.createElement('div'), details = document.createElement('div'), name = document.createElement('strong'), info = document.createElement('small');
      row.className = 'file-row'; name.textContent = file.name;
      info.textContent = `${readableSize(file.size)} · Original owner: ${file.uploadedBy || 'Unknown'} (${file.uploadedByIP || 'IP not recorded'}) · ${new Date(file.createdAt).toLocaleDateString()} · ID ${file.id}${file.ownerOnlyDeletion ? ' · Owner-only deletion (older upload)' : ''}`;
      details.append(name, info); row.append(details, button('Download', () => perform(() => download(room, { fileId: file.id })), 'download'));
      if (room.ownerToken) row.append(button('Move', () => chooseMove(room, file, 'file')));
      if (room.ownerToken || deletionKey(room, file)) row.append(button('Delete', () => perform(async () => {
        if (!confirm(`Delete “${file.name}” from the shared session? This cannot be undone.`)) return;
        await call(room, `files/${file.id}`, { method: 'DELETE', extraHeaders: { 'X-Deletion-Key': deletionKey(room, file) || '' } });
        try { localStorage.removeItem(keyName(room, file)); } catch {} deletionKeys.delete(keyName(room, file)); await refresh(true);
      }), 'trash'));
      $('file-list').append(row);
    }
  }
  async function refresh(force = false) {
    if (!active || refreshing || uploading || (!force && Date.now() - lastRefresh < 4000)) return;
    const selected = getCurrent(), selectedVersion = version;
    if (!selected.room) { status('Upload a file or create a folder to start a shared session.'); return; }
    refreshing = true; lastRefresh = Date.now();
    try {
      const result = await call(selected.room, 'files');
      if (selectedVersion !== version) return;
      inventory = { folders: [], ...result }; render(selected.room);
      status(`${result.files.length} accessible files · ${readableSize(result.usedBytes ?? result.files.reduce((sum, file) => sum + file.size, 0))} used in this session`);
    } catch (error) { if (selectedVersion === version) status(`Files unavailable: ${error.message} File sharing requires the LAN host to be online.`); }
    finally { if (selectedVersion === version) refreshing = false; }
  }
  function showFiles(value) {
    if (getCurrent()?.room?.kind === 'folder') value = true;
    active = value; if (value) exitFocus();
    $('editor-panel').hidden = value; $('files-panel').hidden = !value;
    $('editor-tab').setAttribute('aria-pressed', String(!value)); $('files-tab').setAttribute('aria-pressed', String(value));
    if (value) refresh(true);
  }
  $('editor-tab').onclick = () => showFiles(false); $('files-tab').onclick = () => showFiles(true);
  $('refresh-files').onclick = () => refresh(true);
  $('new-folder').onclick = () => perform(async () => {
    const target = { record: getCurrent(), version, folderId }, name = prompt('New folder name'); if (name === null) return;
    const room = await ensureRoom(target.record); if (target.version !== version) return;
    await call(room, 'folders', { method: 'POST', body: { action: 'create', name, parentId: target.folderId } }); await refresh(true);
  });
  $('download-folder').onclick = () => perform(async () => { if (!getCurrent().room) throw Error('Create a folder or upload files first.'); await download(getCurrent().room, { folderId }); });
  $('move-form').onsubmit = event => {
    event.preventDefault(); const target = moveTarget; if (!target || target.version !== version) return;
    perform(async () => {
      try {
        const parentId = $('move-destination').value || null;
        if (target.kind === 'folder') await call(target.room, 'folders', { method: 'POST', body: { action: 'move', id: target.item.id, parentId } });
        else await call(target.room, `files/${target.item.id}`, { method: 'PATCH', query: { folder: parentId || '' } });
        $('move-dialog').close(); await refresh(true);
      } catch (error) { $('move-status').textContent = error.message; }
    });
  };
  async function invitations(action, code) {
    const target = inviteTarget; if (!target || target.version !== version) return;
    try {
      const result = await call(target.room, 'folder-invitations', { method: 'POST', body: { action, code, folderId: target.folderId } });
      if (target.version !== version) return;
      $('folder-invite-list').replaceChildren();
      for (const invite of result.invitations.filter(item => item.folderId === target.folderId)) {
        const row = document.createElement('div'), link = document.createElement('input'); row.className = 'invitation-row';
        link.value = `${location.origin}/${invite.code}`; link.readOnly = true; link.setAttribute('aria-label', `Invitation ${invite.code}`);
        row.append(link, button('Copy code', () => perform(async () => { try { await navigator.clipboard.writeText(invite.code); $('folder-invite-status').textContent = 'Code copied.'; } catch { link.select(); $('folder-invite-status').textContent = 'Select and copy the invitation link.'; } })), button('Revoke', () => { if (confirm(`Revoke ${invite.code}? Future requests will be blocked.`)) invitations('revoke', invite.code); }));
        $('folder-invite-list').append(row);
      }
      $('folder-invite-status').textContent = action === 'revoke' ? 'Invitation revoked.' : 'Copy a code or link to invite a folder guest.';
    } catch (error) { $('folder-invite-status').textContent = error.message; }
  }
  $('folder-share').onclick = () => { inviteTarget = { room: getCurrent().room, folderId, version }; $('folder-invite-list').replaceChildren(); $('folder-share-dialog').showModal(); return invitations('list'); };
  $('create-folder-invite').onclick = () => invitations('create');
  function drawQueue() {
    $('upload-progress').replaceChildren();
    for (const item of queue) { const row = document.createElement('p'); row.textContent = `${item.parts.join('/')} — ${item.status}`; $('upload-progress').append(row); }
  }
  function busy(value) {
    uploading = value;
    for (const id of ['upload-file', 'upload-folder', 'new-folder']) $(id).disabled = value;
    $('cancel-upload').hidden = !value; $('retry-upload').hidden = value || !queue.some(item => !item.done);
  }
  async function sendFile(room, item, targetFolder, signal) {
    const url = path(room, 'files', { folder: targetFolder || '' });
    const requestHeaders = { ...headers(room), 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(item.file.name), 'X-Upload-Key': item.key };
    if (typeof XMLHttpRequest === 'undefined') {
      const response = await fetch(url, { method: 'POST', headers: requestHeaders, body: item.file, signal });
      const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
    }
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest(); xhr.open('POST', url);
      for (const [key, value] of Object.entries(requestHeaders)) xhr.setRequestHeader(key, value);
      const abort = () => xhr.abort(); signal.addEventListener('abort', abort, { once: true });
      xhr.upload.onprogress = event => { if (!signal.aborted && event.lengthComputable) { item.status = `Uploading ${Math.floor(event.loaded / event.total * 100)}%`; drawQueue(); } };
      xhr.onload = () => { try { const result = JSON.parse(xhr.responseText); if (xhr.status >= 200 && xhr.status < 300) resolve(result); else reject(Error(result.error || 'Upload failed.')); } catch { reject(Error('Invalid response from host. Retry this file.')); } };
      xhr.onerror = () => reject(Error('Connection lost. Retry unfinished uploads.'));
      xhr.onabort = () => reject(Error('Cancelled'));
      xhr.onloadend = () => signal.removeEventListener('abort', abort);
      if (signal.aborted) { reject(Error('Cancelled')); return; } xhr.send(item.file);
    });
  }
  async function runQueue(retry = false) {
    if (uploading || !uploadTarget || uploadTarget.version !== version) return;
    const target = uploadTarget, selectedQueue = queue; cancelled = false; deletionWarning = ''; controller = new AbortController(); busy(true);
    try {
      const room = await ensureRoom(target.record); if (target.version !== version) return;
      const result = await call(room, 'files', { signal: controller.signal });
      if (target.version !== version) return; inventory = { folders: [], ...result };
      const pending = selectedQueue.filter(item => !item.done);
      if (!retry && ((result.usedFiles ?? result.files.length) + pending.length > 1000 || (result.usedBytes ?? result.files.reduce((sum, file) => sum + file.size, 0)) + pending.reduce((sum, item) => sum + item.file.size, 0) > MAX_FILE_BYTES)) throw Error('This selection exceeds the session limit of 1 GiB or 1,000 files. Choose fewer files.');
      for (const item of pending) {
        if (cancelled || target.version !== version) break;
        try {
          let parentId = target.folderId;
          for (const name of item.parts.slice(0, -1)) {
            if (cancelled) throw Error('Cancelled');
            let folder = inventory.folders.find(folder => folder.name === name && folder.parentId === parentId);
            if (!folder) {
              try { folder = (await call(room, 'folders', { method: 'POST', body: { action: 'create', name, parentId }, signal: controller.signal })).folder; inventory.folders.push(folder); }
              catch (error) {
                const refreshed = await call(room, 'files', { signal: controller.signal }); inventory = { folders: [], ...refreshed };
                folder = inventory.folders.find(folder => folder.name === name && folder.parentId === parentId); if (!folder) throw error;
              }
            }
            parentId = folder.id;
          }
          if (cancelled || target.version !== version) break;
          item.status = 'Uploading…'; drawQueue();
          const uploaded = await sendFile(room, item, parentId, controller.signal);
          saveDeletionKey(room, uploaded); item.done = true; item.status = 'Completed';
        } catch (error) { item.status = cancelled ? 'Cancelled — ready to retry' : `Failed: ${error.message}`; if (cancelled) break; }
        if (target.version === version) drawQueue();
      }
      if (target.version === version) status(`${selectedQueue.filter(item => item.done).length} of ${selectedQueue.length} uploads completed. Completed files stay available; retry skips them.${deletionWarning}`);
    } catch (error) { if (target.version === version) status(`Upload failed: ${cancelled ? 'Cancelled' : error.message}`); }
    finally {
      if (target.version === version) {
        busy(false); drawQueue(); const summary = $('file-status').textContent;
        await refresh(true); if (target.version === version) status(summary);
      }
    }
  }
  for (const [buttonId, inputId] of [['upload-file', 'file-input'], ['upload-folder', 'folder-input']]) {
    $(buttonId).onclick = () => { uploadTarget = { record: getCurrent(), version, folderId }; $(inputId).click(); };
    $(inputId).onchange = async () => {
      const files = [...$(inputId).files]; $(inputId).value = '';
      if (!files.length || uploading) return;
      if (!uploadTarget || uploadTarget.record !== getCurrent() || uploadTarget.version !== version) { status('The document changed. Select the files again.'); return; }
      try {
        if (files.some(file => file.size > MAX_FILE_BYTES)) throw Error('Files must be 1 GiB or smaller.');
        if (files.length > 1000 || files.reduce((sum, file) => sum + file.size, 0) > MAX_FILE_BYTES) throw Error('Select at most 1,000 files totalling 1 GiB.');
        queue = files.map(file => ({ file, parts: uploadSegments(file), key: randomKey(), status: 'Waiting', done: false }));
        await runQueue();
      } catch (error) { status(error.message); }
    };
  }
  $('cancel-upload').onclick = () => { cancelled = true; controller?.abort(); };
  $('retry-upload').onclick = () => runQueue(true);
  return {
    refresh,
    reset() {
      version++; cancelled = true; controller?.abort(); refreshing = false; lastRefresh = 0; queue = []; busy(false);
      inventory = { files: [], folders: [], rootFolderId: getCurrent()?.room?.folderId || null }; folderId = inventory.rootFolderId;
      $('file-list').replaceChildren(); $('file-breadcrumbs').replaceChildren(); drawQueue(); status('Loading shared files…');
      showFiles(getCurrent()?.room?.kind === 'folder');
    },
  };
}
