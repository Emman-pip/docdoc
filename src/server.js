import { fileURLToPath } from 'node:url';
import { createApp } from './features/rooms/http.js';
export { createApp };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, process.env.HOST || '0.0.0.0', () => console.log(`DocDoc: http://localhost:${port} — share this host's LAN address with collaborators.`));
}
