export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=';
export const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
export const richContent = {
  type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Team report' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' italic', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' linked', marks: [{ type: 'link', attrs: { href: 'https://example.com/' } }] },
      { type: 'image', attrs: { src: PNG, alt: 'A small image' } },
    ] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Bullet item')] }] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [paragraph('Numbered item'), { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Nested item')] }] }] }] },
  ],
};
