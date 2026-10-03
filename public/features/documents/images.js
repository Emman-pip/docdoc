export const MAX_IMAGE_BYTES = 256 * 1024;
export const IMAGE_LINK = /!\[([^\]\n]*)\]\(docdoc-image:([a-zA-Z0-9-]{1,64})\)/g;

export function validateImage(image) {
  if (!image || typeof image.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(image.id) || typeof image.data !== 'string') throw new Error('Invalid photo');
  const match = image.data.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error('Invalid photo format or size (maximum 256 KB)');
  let bytes;
  try { bytes = atob(match[2]); } catch { throw new Error('Invalid photo encoding'); }
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Invalid photo size (maximum 256 KB)');
  const valid = match[1] === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n') : match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff') : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  if (!valid) throw new Error('Invalid photo content');
}

export async function preparePhoto(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP photo.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a photo smaller than 10 MB.');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('This photo could not be decoded.')); image.src = url; });
    const canvas = document.createElement('canvas');
    let scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Photo processing is unavailable in this browser.');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.8 - attempt * 0.08);
      if (data.length < MAX_IMAGE_BYTES * 4 / 3) return data;
      scale *= 0.75;
    }
    throw new Error('This photo is too large after resizing. Choose a smaller image.');
  } finally { URL.revokeObjectURL(url); }
}

export function exportMarkdown(text, images) {
  return text.replace(IMAGE_LINK, (link, alt, id) => images.has(id) ? `![${alt}](${images.get(id).data})` : link);
}
