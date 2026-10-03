const CACHE = 'docdoc-v9';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/crdt.js', '/vim.js', '/images.js', '/markdown.js', '/files.js', '/vim-cursor.js', '/invitations.js', '/qr.js', '/qrcode-generator.mjs', '/access.js', '/editor-size.js', '/usernames.js', '/policy.js', '/defaults.js', '/icons.js', '/icons.svg', '/focus.js', '/theme.js'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin || new URL(event.request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
