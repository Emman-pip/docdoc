export const INVITATION_CODE = /^[a-z]{3}-[a-z]{3}-[a-z]{3}$/;
export function normalizeCode(value) {
  const code = String(value || '').trim().toLowerCase();
  if (!INVITATION_CODE.test(code)) throw new Error('Enter a code like xyz-jnk-dvc.');
  return code;
}
export function invitationLink(origin, code) { return `${origin}/${normalizeCode(code)}`; }
export function invitationFromLocation(location) {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('room') && params.get('token')) return { room: { id: params.get('room'), token: params.get('token') } };
  const code = location.pathname.replace(/^\//, '').replace(/\/$/, '');
  if (INVITATION_CODE.test(code)) return { code };
  const hash = location.hash.slice(1).toLowerCase();
  return INVITATION_CODE.test(hash) ? { code: hash } : null;
}
