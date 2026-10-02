const MAX_FILE_BYTES = 20 * 1024 * 1024;
const readableSize = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function attachFileSharing({ $, user, getCurrent, getName, ensureRoom }) {
  let active = false, refreshing = false, uploading = false, version = 0, lastRefresh = 0;
  const status = message => { $('file-status').textContent = message; };
  const path = (room, fileId = '') => `/api/rooms/${room.id}/files${fileId ? `/${fileId}` : ''}?${new URLSearchParams({ user, name: getName() || 'Collaborator' })}`;
  async function fetchFiles(room, fileId = '', options = {}) {
    const response = await fetch(path(room, fileId), { ...options, headers: { Authorization: `Bearer ${room.token}`, ...(room.ownerToken ? { 'X-Owner-Key': room.ownerToken } : {}), ...options.headers }, signal: AbortSignal.timeout(options.method === 'POST' ? 90000 : 10000) });
    if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'File transfer failed.'); }
    return response;
  }
  function render(files, room) {
    $('file-list').replaceChildren();
    for (const file of files) {
      const row = document.createElement('div'), details = document.createElement('div'), name = document.createElement('strong'), info = document.createElement('small'), download = document.createElement('button');
      row.className = 'file-row'; name.textContent = file.name;
      info.textContent = `${readableSize(file.size)} · Original owner: ${file.uploadedBy || 'Unknown'} (${file.uploadedByIP || 'IP not recorded'}) · ${new Date(file.createdAt).toLocaleDateString()}`;
      download.textContent = '↓ Download';
      download.onclick = async () => {
        const selectedVersion = version; download.disabled = true;
        try {
          const response = await fetchFiles(room, file.id), blob = await response.blob();
          const url = URL.createObjectURL(blob), link = document.createElement('a');
          link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          if (selectedVersion === version) status(`Downloaded ${file.name}.`);
        } catch (error) { if (selectedVersion === version) status(`Download failed: ${error.message}`); }
        finally { download.disabled = false; }
      };
      details.append(name, info); row.append(details, download); $('file-list').append(row);
    }
  }
  async function refresh(force = false) {
    if (!active || refreshing || uploading || (!force && Date.now() - lastRefresh < 4000)) return;
    const selected = getCurrent(), selectedVersion = version;
    if (!selected.room) { status('Upload a file to start a shared session, then use Share document to invite your team.'); return; }
    refreshing = true; lastRefresh = Date.now();
    try {
      const result = await (await fetchFiles(selected.room)).json();
      if (selectedVersion !== version) return;
      render(result.files, selected.room);
      status(result.files.length ? `${result.files.length} files · ${readableSize(result.files.reduce((sum, file) => sum + file.size, 0))} shared in this session` : 'No files yet. Upload the first one.');
    } catch (error) { if (selectedVersion === version) status(`Files unavailable: ${error.message} File sharing requires the LAN host to be online.`); }
    finally { if (selectedVersion === version) refreshing = false; }
  }
  function showFiles(value) {
    active = value; $('editor-panel').hidden = value; $('files-panel').hidden = !value;
    $('editor-tab').setAttribute('aria-pressed', String(!value)); $('files-tab').setAttribute('aria-pressed', String(value));
    if (value) refresh(true);
  }
  $('editor-tab').onclick = () => showFiles(false);
  $('files-tab').onclick = () => showFiles(true);
  $('refresh-files').onclick = () => refresh(true);
  let uploadTarget;
  $('upload-file').onclick = () => { uploadTarget = { record: getCurrent(), version }; $('file-input').click(); };
  $('file-input').onchange = async () => {
    const file = $('file-input').files[0], target = uploadTarget;
    $('file-input').value = '';
    if (!file || !target || uploading) return;
    if (target.record !== getCurrent() || target.version !== version) { status('The document changed. Select the file again.'); return; }
    if (file.size > MAX_FILE_BYTES) { status('Files must be 20 MB or smaller.'); return; }
    uploading = true; $('upload-file').disabled = true; status(`Uploading ${file.name}…`);
    try {
      const room = await ensureRoom(target.record);
      if (target.version !== version) return;
      await fetchFiles(room, '', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      if (target.version === version) { uploading = false; await refresh(true); status(`Uploaded ${file.name}. Share the document invitation to let your team download it.`); }
    } catch (error) { if (target.version === version) status(`Upload failed: ${error.message}`); }
    finally { uploading = false; $('upload-file').disabled = false; }
  };
  return {
    refresh,
    reset() { version++; refreshing = false; lastRefresh = 0; $('file-list').replaceChildren(); status('Loading shared files…'); if (active) refresh(true); },
  };
}
