import { isIP } from 'node:net';
import { readFileSync } from 'node:fs';
import { normalizeIP, normalizeMAC, normalizeUsername } from '../../../public/shared/policy.js';
export { emptyPolicy, normalizeIP, normalizeMAC, normalizeUsername, validatePolicy } from '../../../public/shared/policy.js';
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
