import { Readable, Writable } from 'node:stream';

// Exercise the actual HTTP request listener without opening a TCP port.
// This keeps handler integration tests usable in restricted environments.
export function request(server, path, { method = 'GET', body, rawBody, rawChunks, headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(rawChunks || (rawBody !== undefined ? [Buffer.from(rawBody)] : body === undefined ? [] : [Buffer.from(JSON.stringify(body))]));
    req.socket = { remoteAddress };
    req.url = path; req.method = method;
    req.headers = { host: 'localhost:3000', ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])) };
    const responseHeaders = new Map();
    const chunks = [];
    const res = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    res.status = 200;
    res.setHeader = (key, value) => responseHeaders.set(key.toLowerCase(), value);
    res.writeHead = (status, headers = {}) => { res.status = status; res.headersSent = true; for (const [key, value] of Object.entries(headers)) res.setHeader(key, value); };
    res.on('error', reject);
    res.on('finish', () => {
      const bytes = Buffer.concat(chunks), text = bytes.toString();
      resolve({ status: res.status, headers: { get: key => responseHeaders.get(key.toLowerCase()) }, text: async () => text, json: async () => JSON.parse(text), bytes: async () => bytes });
    });
    try { server.emit('request', req, res); } catch (error) { reject(error); }
  });
}
