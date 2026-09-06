import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';

const { fetch, WebSocket } = globalThis;

const root = process.cwd();
const benchmark = process.argv.includes('--benchmark');
await mkdir(path.join(root, '.tools'), { recursive: true });
const dest = benchmark ? await mkdtemp(path.join(root, '.tools/png-benchmark-')) : path.join(root, 'src-tauri/tests/fixtures/png');
await mkdir(dest, { recursive: true });
const spool = benchmark ? await open(path.join(dest, 'legacy.rgb'), 'wx') : undefined;
const profile = await mkdtemp(path.join(tmpdir(), 'nestra-png-chrome-'));
const vite = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0, watch: null }, clearScreen: false,
  plugins: benchmark ? [{ name: 'png-benchmark-spool', configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const files = { '/__png_benchmark/source': 'source.png', '/__png_benchmark/plan': 'plan.json' };
      if (request.method !== 'POST' || (!files[request.url] && request.url !== '/__png_benchmark/strip')) return next();
      try {
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error('Too large'); chunks.push(chunk); }
        const bytes = Buffer.concat(chunks);
        if (request.url === '/__png_benchmark/strip') await spool.write(bytes);
        else await writeFile(path.join(dest, files[request.url]), bytes, { flag: 'wx' });
        response.end('ok');
      } catch (error) { response.statusCode = 500; response.end(String(error)); }
    });
  } }] : [] });
await vite.listen();
const chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  if (!port) throw new Error('Chrome debugger did not start');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(m.error); else p.resolve(m.result); } };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); socket.send(JSON.stringify({ id: n, method, params })); });
  await call('Page.navigate', { url: vite.resolvedUrls.local[0] + (benchmark ? 'scripts/png-benchmark.html' : 'scripts/png-reference.html') });
  let fixture;
  for (let i = 0; i < (benchmark ? 6000 : 100); i++) {
    const value = await call('Runtime.evaluate', { expression: benchmark ? 'window.pngBenchmark' : 'window.pngFixtures', returnByValue: true });
    if (value.result.value) { fixture = value.result.value; break; }
    await new Promise(r => setTimeout(r, 100));
  }
  if (!fixture) throw new Error('No reference pixels produced');
  if (fixture.error) throw new Error(fixture.error);
  if (benchmark) {
    await spool.close();
    await writeFile(path.join(dest, 'browser.json'), JSON.stringify(fixture, null, 2));
    process.stdout.write(JSON.stringify({ directory: dest, browser: fixture }, null, 2) + '\n');
    const child = spawn('cargo', ['test', '--release', '--manifest-path', 'src-tauri/Cargo.toml', 'manual_png_benchmark', '--', '--ignored', '--nocapture'],
      { env: { ...process.env, NESTRA_PNG_BENCH_DIR: dest }, windowsHide: true, stdio: 'inherit' });
    const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    if (status !== 0) throw new Error('Rust benchmark failed: ' + status);
  } else {
  await writeFile(path.join(dest, 'source.png'), Buffer.from(fixture.source));
  for (const [i, f] of fixture.fixtures.entries()) {
    await writeFile(path.join(dest, `${i}.json`), JSON.stringify(f.plan, null, 2));
    await writeFile(path.join(dest, `${i}.rgb`), Buffer.from(f.rgb));
  }
  await writeFile(path.join(dest, 'browser.txt'), fixture.browser + '\nGenerated with scripts/generate-png-reference.mjs and the legacy drawStrip.\n');
  process.stdout.write(`Generated ${fixture.fixtures.length} browser pixel fixtures: ${fixture.browser}\n`);
  }
} finally {
  socket?.close();
  chrome.kill();
  await vite.close();
}
