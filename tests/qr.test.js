import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationQrSvg } from '../public/qr.js';
import { invitationLink } from '../public/invitations.js';

test('generates an accessible QR image locally for invitation links with URL-sensitive characters', () => {
  const link = `${invitationLink('https://docdoc.example:8443', 'xyz-jnk-dvc')}?next=%23team&name=A%26B`;
  const svg = invitationQrSvg(link);
  assert.match(svg, /^<svg/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /QR code for the document invitation link/);
  assert.match(svg, /<path d="[Mm]/);
  assert.notEqual(invitationQrSvg(link), invitationQrSvg(`${link}x`));
});
