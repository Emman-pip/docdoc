// Dependency-free Chromium smoke checks via the DevTools pipe. Uses isolated data.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../../src/server.js';
export async function withBrowser(verify) {
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
      while (Date.now() < deadline) {
        try { if (await evaluate(expression)) return; }
        catch (error) { if (!/Cannot read properties of null|Execution context|Cannot find context|Inspected target navigated/.test(error.message)) throw error; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw Error(`Timed out waiting for ${expression}; runtime errors: ${JSON.stringify(runtimeErrors.map(item => item.exception?.description || item.text))}: ${JSON.stringify(await evaluate("({notice:document.querySelector('#notice')?.textContent,content:document.querySelector('#rich-editor')?.innerHTML,connection:document.querySelector('#connection')?.textContent})"))}`);
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
    await verify({ page, cdp, base, screenshot });
    if (runtimeErrors.length) throw new Error(JSON.stringify(runtimeErrors));
  } finally {
    await cdp('Browser.close').catch(() => {}); browser.kill();
    await new Promise(resolve => server.close(resolve)); rmSync(temporary, { recursive: true, force: true });
  }

}
