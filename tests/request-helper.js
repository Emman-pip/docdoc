import { Readable } from 'node:stream';

// Exercise the actual HTTP request listener without opening a TCP port.
// This keeps handler integration tests usable in restricted environments.
export function request(server, path, { method = 'GET', body, rawBody, rawChunks, headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(rawChunks || (rawBody !== undefined ? [Buffer.from(rawBody)] : body === undefined ? [] : [Buffer.from(JSON.stringify(body))]));
    req.socket = { remoteAddress };
    req.url = path; req.method = method;
    req.headers = { host: 'localhost:3000', ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])) };
    const responseHeaders = new Map();
    const res = {
      status: 200,
      setHeader(key, value) { responseHeaders.set(key.toLowerCase(), value); },
      writeHead(status, headers = {}) { this.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); },
      end(body = '') {
        const text = body.toString();
        resolve({ status: this.status, headers: { get: key => responseHeaders.get(key.toLowerCase()) }, text: async () => text, json: async () => JSON.parse(text), bytes: async () => Buffer.from(body) });
      },
    };
    try { server.emit('request', req, res); } catch (error) { reject(error); }
  });
}
