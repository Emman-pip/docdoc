import { emptyPolicy, validatePolicy } from '../../shared/policy.js';
export const DEFAULTS_KEY = 'docdoc.access-defaults.v1';
export function newDocumentPolicy(storage) {
  try { return validatePolicy(JSON.parse(storage.getItem(DEFAULTS_KEY)) || emptyPolicy()); }
  catch { return emptyPolicy(); }
}
export function saveDefaults(storage, policy) {
  const validated = validatePolicy(policy);
  storage.setItem(DEFAULTS_KEY, JSON.stringify(validated));
  return validated;
}
export function attachDefaults($) {
  $('defaults-open').onclick = () => {
    const policy = newDocumentPolicy(localStorage);
    $('defaults-enabled').checked = policy.enabled;
    for (const [field, key] of [['ips', 'ips'], ['users', 'usernames'], ['macs', 'macs']]) $('defaults-' + field).value = policy[key].join('\n');
    $('defaults-status').textContent = 'These defaults apply when you create a document, even offline.';
    $('defaults-dialog').showModal();
  };
  $('defaults-form').onsubmit = event => { event.preventDefault(); $('defaults-save').onclick(); };
  $('defaults-save').onclick = () => {
    try {
      const entries = field => $('defaults-' + field).value.split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
      saveDefaults(localStorage, { enabled: $('defaults-enabled').checked, ips: entries('ips'), usernames: entries('users'), macs: entries('macs') });
      $('defaults-status').textContent = 'Saved. Future documents will use these defaults.';
    } catch (error) { $('defaults-status').textContent = `Could not save: ${error.message}. Previous defaults are retained.`; }
  };
}
