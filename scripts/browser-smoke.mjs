// Dependency-free Chromium smoke checks via the DevTools pipe. Uses isolated data.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
const temporary = mkdtempSync(join(tmpdir(), 'docdoc-browser-'));
const server = createApp({ dataDir: join(temporary, 'data') });
await new Promise((resolve, reject) => { server.on('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(process.env.CHROMIUM || 'chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-pipe', `--user-data-dir=${join(temporary, 'profile')}`, '--no-first-run', '--no-default-browser-check'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let sequence = 0, buffer = '', errors = '', runtimeErrors = []; const pending = new Map();
browser.stderr.on('data', chunk => { errors += chunk; });
browser.stdio[4].on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    if (message.id) { const task = pending.get(message.id); if (task) { pending.delete(message.id); clearTimeout(task.timer); message.error ? task.reject(Error(JSON.stringify(message.error))) : task.resolve(message.result); } }
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails);
  }
});
function cdp(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out: ${errors.slice(-1500)}`)); }, 20000);
    pending.set(id, { resolve, reject, timer }); browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
async function page(url = base) {
  const { browserContextId } = await cdp('Target.createBrowserContext');
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Runtime.enable', {}, sessionId); await cdp('Page.enable', {}, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp('Page.navigate', { url }, sessionId);
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  const wait = async expression => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw Error(`Timed out waiting for ${expression}`);
  };
  await wait("!!document.querySelector('#title') && document.querySelector('#title').value.length > 0");
  return { sessionId, evaluate, wait };
}
const screenshot = async (page, name) => {
  await new Promise(resolve => setTimeout(resolve, 250)); // Let theme transitions settle.
  mkdirSync(resolve('docs/screenshots'), { recursive: true });
  const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page.sessionId);
  writeFileSync(resolve('docs/screenshots', name + '.png'), Buffer.from(result.data, 'base64'));
};
try {
  const owner = await page();
  assert.equal(await owner.evaluate("document.querySelector('#preview').hidden"), true);
  await owner.evaluate("document.querySelector('#defaults-open').click(); document.querySelector('#defaults-users').value='Alice'; document.querySelector('#defaults-enabled').checked=true; document.querySelector('#defaults-save').click()");
  assert.match(await owner.evaluate("document.querySelector('#defaults-status').textContent"), /Saved/);
  await owner.evaluate("document.querySelector('#defaults-dialog').close(); document.querySelector('#new').click(); document.querySelector('#title').value='Team notes'; document.querySelector('#title').dispatchEvent(new Event('input')); document.querySelector('#editor').value='# Meeting notes\\n\\nPrivate document content.'; document.querySelector('#editor').dispatchEvent(new Event('input'))");
  assert.equal(await owner.evaluate("JSON.parse(localStorage.getItem('docdoc.documents.v1')).find(r => r.state.title.value==='Team notes').policy.enabled"), true);
  await owner.evaluate("document.querySelector('#focus-toggle').click(); document.querySelector('#preview-toggle').click()");
  assert.equal(await owner.evaluate("document.body.classList.contains('focus-mode') && !document.querySelector('#preview').hidden && !!document.querySelector('#preview-toggle svg')"), true);
  await screenshot(owner, 'focus-light');
  await owner.evaluate("document.querySelector('#defaults-open').click()");
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, owner.sessionId);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, owner.sessionId);
  assert.equal(await owner.evaluate("document.body.classList.contains('focus-mode')"), true);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, owner.sessionId);
  assert.equal(await owner.evaluate("document.body.classList.contains('focus-mode')"), false);
  await owner.evaluate("document.querySelector('#focus-toggle').click(); document.querySelector('#files-tab').click()");
  assert.equal(await owner.evaluate("document.body.classList.contains('focus-mode')"), false);
  // Set a directory selection without any fixture dependencies or file-picker UI.
  await owner.evaluate(`(async () => {
    document.querySelector('#upload-folder').onclick();
    const files = [new File(['first'], 'one.txt'), new File(['second'], 'two.txt')];
    Object.defineProperty(files[0], 'webkitRelativePath', { value: 'Team/one.txt' });
    Object.defineProperty(files[1], 'webkitRelativePath', { value: 'Team/Nested/two.txt' });
    Object.defineProperty(document.querySelector('#folder-input'), 'files', { value: files, configurable: true });
    await document.querySelector('#folder-input').onchange();
  })()`);
  assert.match(await owner.evaluate("document.querySelector('#file-status').textContent"), /2 of 2 uploads completed/);
  assert.equal(await owner.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('docdoc.file-delete.')).length"), 2);
  await owner.evaluate("[...document.querySelectorAll('#file-list button')].find(b=>b.textContent==='Team').click(); document.querySelector('#folder-share').click()");
  await owner.wait("document.querySelector('#folder-invite-status').textContent.includes('Copy')");
  await owner.evaluate("document.querySelector('#create-folder-invite').click()");
  await owner.wait("!!document.querySelector('#folder-invite-list input')");
  const folderLink = await owner.evaluate("document.querySelector('#folder-invite-list input').value");
  const record = await owner.evaluate("JSON.parse(localStorage.getItem('docdoc.documents.v1')).find(r=>r.state.title.value==='Team notes')");
  await owner.evaluate("document.querySelector('#folder-share-dialog').close()");
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, owner.sessionId);
  await screenshot(owner, 'folders-dark');
  // Each guest gets isolated browser storage and must match the inherited policy.
  const guest = await page();
  await guest.evaluate(`localStorage.setItem('docdoc.name','Alice'); location.href=${JSON.stringify(folderLink)}`);
  await guest.wait("document.body.classList.contains('folder-guest') && document.querySelector('#file-list').children.length>0");
  assert.equal(await guest.evaluate("getComputedStyle(document.querySelector('#editor-panel')).display"), 'none');
  assert.equal(await guest.evaluate("getComputedStyle(document.querySelector('#share')).display"), 'none');
  assert.equal(await guest.evaluate("document.body.textContent.includes('Private document content.')"), false);
  await screenshot(guest, 'folder-guest-light');
  const collaborator = await page();
  await collaborator.evaluate(`localStorage.setItem('docdoc.name','Alice'); location.href=${JSON.stringify(base + '/' + record.room.code)}`);
  await collaborator.wait("!document.querySelector('#preview').hidden && document.querySelector('#preview').textContent.includes('Private document content.')");
  assert.equal(await collaborator.evaluate("document.querySelector('#preview-toggle').textContent"), 'Edit');
  await collaborator.evaluate("document.querySelector('#preview-toggle').click()");
  assert.equal(await collaborator.evaluate("document.querySelector('#editor').hidden"), false);
  await cdp('Page.reload', {}, collaborator.sessionId);
  await collaborator.wait("!!document.querySelector('#preview') && !document.querySelector('#preview').hidden");
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, collaborator.sessionId);
  await collaborator.evaluate("document.querySelector('#focus-toggle').click()");
  assert.equal(await collaborator.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  await screenshot(collaborator, 'focus-mobile');
  await cdp('Network.enable', {}, owner.sessionId);
  await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, owner.sessionId);
  await owner.evaluate("document.querySelector('#editor-tab').click(); document.querySelector('#focus-toggle').click(); document.querySelector('#new').click(); document.querySelector('#editor').value='Offline work'; document.querySelector('#editor').dispatchEvent(new Event('input'))");
  assert.equal(await owner.evaluate("document.body.classList.contains('focus-mode')"), false);
  assert.equal(await owner.evaluate("document.querySelector('#editor').hidden"), false);
  assert.equal(await owner.evaluate("document.querySelector('#save-status').textContent.includes('Saved')"), true);
  await owner.evaluate("document.querySelector('#defaults-open').click(); document.querySelector('#defaults-enabled').checked=false; document.querySelector('#defaults-save').click(); document.querySelector('#defaults-dialog').close()");
  assert.equal(await owner.evaluate("JSON.parse(localStorage.getItem('docdoc.access-defaults.v1')).enabled"), false);
  assert.equal(await owner.evaluate("JSON.parse(localStorage.getItem('docdoc.documents.v1')).find(r=>r.state.title.value==='Team notes').policy.enabled"), true);
  assert.deepEqual(runtimeErrors, []);
  console.log('Browser checks passed: access inheritance, SVG labels, focus/Escape, folder uploads, private deletion keys, guest isolation, joined preview, offline editing/templates, light/dark/mobile.');
} finally {
  await cdp('Browser.close').catch(() => {}); browser.kill();
  await new Promise(resolve => server.close(resolve)); rmSync(temporary, { recursive: true, force: true });
}
