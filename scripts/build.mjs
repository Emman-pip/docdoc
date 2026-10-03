import { build } from 'esbuild';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

rmSync('public/assets', { recursive: true, force: true });
mkdirSync('public/assets', { recursive: true });
await build({ entryPoints: { app: 'public/app.js', 'docx-worker': 'public/features/documents/docx-worker.js' }, outdir: 'public/assets', bundle: true, splitting: true, format: 'esm', platform: 'browser', target: ['es2022'], minify: true, legalComments: 'linked' });
const assets = ['/', '/index.html', '/styles.css', '/icons.svg', ...readdirSync('public/assets').filter(name => name.endsWith('.js')).map(name => `/assets/${name}`)];
const hash = createHash('sha256');
for (const asset of assets.slice(1)) hash.update(readFileSync(`public${asset}`));
const source = readFileSync('scripts/service-worker.js', 'utf8').replace('__CACHE__', `docdoc-${hash.digest('hex').slice(0, 16)}`).replace('__ASSETS__', JSON.stringify(assets));
writeFileSync('public/sw.js', source);
console.log('Built browser editor, DOCX worker, and offline cache.');
