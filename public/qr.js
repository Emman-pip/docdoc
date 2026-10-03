import qrcode from './qrcode-generator.mjs';

export function invitationQrSvg(link) {
  const code = qrcode(0, 'M');
  code.addData(String(link), 'Byte');
  code.make();
  return code.createSvgTag({ cellSize: 5, margin: 20, scalable: true, alt: 'QR code for the document invitation link' });
}
