import { isIP } from 'node:net';
import { readFileSync } from 'node:fs';
export const emptyPolicy = () => ({ enabled: false, ips: [], usernames: [], macs: [] });
export function normalizeIP(value) {
  if (typeof value !== 'string') return null;
  const address = value.trim().split('%')[0].toLowerCase();
  if (!isIP(address)) return null;
  if (isIP(address) === 4) return address;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
  if (mapped) { const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16); return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`; }
  return canonical;
}
export function normalizeMAC(value) {
  if (typeof value !== 'string') return null;
  const mac = value.trim().toLowerCase().replace(/-/g, ':');
  return /^(?:[a-f0-9]{2}:){5}[a-f0-9]{2}$/.test(mac) && mac !== '00:00:00:00:00:00' && mac !== 'ff:ff:ff:ff:ff:ff' ? mac : null;
}
export function normalizeUsername(value) {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFKC').trim().toLowerCase();
  return name && name.length <= 40 && !/[\x00-\x1f\x7f]/.test(name) ? name : null;
}
export function validatePolicy(value) {
  if (!value || typeof value.enabled !== 'boolean') throw new Error('Invalid whitelist settings');
  const result = { enabled: value.enabled };
  for (const [key, normalize] of [['ips', normalizeIP], ['usernames', normalizeUsername], ['macs', normalizeMAC]]) {
    if (!Array.isArray(value[key]) || value[key].length > 100) throw new Error(`Invalid whitelist ${key}: provide at most 100 entries`);
    result[key] = [...new Set(value[key].map(entry => {
      const normalized = normalize(entry);
      if (!normalized) throw new Error(`Invalid whitelist ${key} entry: ${String(entry).slice(0, 80)}`);
      return normalized;
    }))];
  }
  return result;
}
export function macFromARP(ip, contents) {
  if (isIP(ip || '') !== 4) return null;
  for (const line of contents.split('\n').slice(1)) {
    const [address, , flags, mac] = line.trim().split(/\s+/);
    if (address === ip && (parseInt(flags, 16) & 2)) return normalizeMAC(mac);
  }
  return null;
}
export function lookupLanMAC(ip) {
  if (process.platform !== 'linux' || isIP(ip || '') !== 4) return null;
  try { return macFromARP(ip, readFileSync('/proc/net/arp', 'utf8')); } catch { return null; }
}
export function matchesPolicy(policy, identity) {
  if (!policy?.enabled || identity.owner) return true;
  return Boolean((identity.ip && policy.ips.includes(normalizeIP(identity.ip))) || (identity.name && policy.usernames.includes(normalizeUsername(identity.name))) || (identity.mac && policy.macs.includes(normalizeMAC(identity.mac))));
}
