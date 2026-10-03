const entries = value => value.split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
export function attachAccessControls({ $, getCurrent, ensureRoom, getName, persist, sync }) {
  let selected, key = '';
  const status = message => { $('access-status').textContent = message; };
  function readPolicy() {
    return { enabled: $('access-enabled').checked, ips: entries($('access-ips').value), usernames: entries($('access-users').value), macs: entries($('access-macs').value) };
  }
  async function call(action, policy) {
    const response = await fetch(`/api/rooms/${selected.room.id}/access`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selected.room.token}`, 'X-Owner-Key': key },
      body: JSON.stringify({ action, policy, name: getName() }), signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update whitelist.');
    return result;
  }
  function fill(result) {
    $('access-enabled').checked = result.policy.enabled;
    $('access-ips').value = result.policy.ips.join('\n');
    $('access-users').value = result.policy.usernames.join('\n');
    $('access-macs').value = result.policy.macs.join('\n');
    $('access-connection').textContent = `Your connection: ${result.connection.ip || 'IP unknown'} · MAC: ${result.connection.mac || 'not detected'}`;
    $('access-participants').replaceChildren();
    for (const user of result.participants) {
      const row = document.createElement('li'); row.textContent = `${user.name} · ${user.ip || 'IP unknown'} · ${user.mac || 'MAC not detected'}`;
      $('access-participants').append(row);
    }
    $('access-save').disabled = false;
  }
  async function load() {
    $('access-save').disabled = true;
    try {
      const result = await call('get');
      if (selected !== getCurrent()) return;
      fill(result);
      selected.room.ownerToken = key; persist(); $('access-key-section').hidden = true; $('access-key').value = '';
      status('Whitelist settings loaded. The owner keeps access even when the list is empty.');
    } catch (error) { status(error.message); }
  }
  $('access-open').onclick = async () => {
    $('access-open').disabled = true; $('access-save').disabled = true;
    selected = getCurrent();
    $('access-enabled').checked = false;
    for (const id of ['access-ips', 'access-users', 'access-macs']) $(id).value = '';
    $('access-connection').textContent = ''; $('access-participants').replaceChildren();
    try {
      await ensureRoom(selected);
      if (selected !== getCurrent()) return;
      key = selected.room.ownerToken || '';
      $('access-key').value = '';
      $('access-key-section').hidden = Boolean(key);
      $('access-dialog').showModal();
      if (key) await load();
      else status(`Paste the ownerToken from the host’s data/${selected.room.id}.json file. Collaborator invitations cannot manage access.`);
    } catch (error) { status(error.message); $('access-dialog').showModal(); }
    finally { $('access-open').disabled = false; }
  };
  $('access-unlock').onclick = async () => { key = $('access-key').value.trim(); await load(); };
  $('access-save').onclick = async () => {
    if (selected !== getCurrent()) { status('The document changed. Reopen Access settings.'); return; }
    $('access-save').disabled = true;
    try {
      const result = await call('set', readPolicy());
      if (selected !== getCurrent()) return;
      fill(result); status(result.policy.enabled ? 'Whitelist enabled. Unlisted connections are blocked on their next request.' : 'Whitelist disabled. An invitation is still required.');
      sync();
    } catch (error) { status(error.message); }
    finally { $('access-save').disabled = false; }
  };
  $('access-form').onsubmit = event => { event.preventDefault(); if (!$('access-save').disabled) $('access-save').onclick(); };
  return { readPolicy };
}
