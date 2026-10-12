import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { preserveBrowserAssets, referencedAssets } from './preserve-browser-assets.mjs';

const origin = 'https://legalwhat.com';
const day = 86400000;
const now = 1800000000000;
async function output(t, files = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-assets-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'assets'));
  for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(dir, name), body);
  return dir;
}
function remote(files, calls = []) {
  return async url => {
    const name = new URL(url).pathname;
    calls.push(name);
    return new Response(files[name] ?? 'Not found', {
      status: name in files ? 200 : 404,
      headers: { 'content-type': name === '/' ? 'text/html' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'application/json' },
    });
  };
}
const liveFiles = {
  '/': '<script type="module" src="/assets/entry-old12345.js"></script>',
  '/assets/entry-old12345.js': 'const deps=["assets/page-old12345.js", "assets/page-old12345.css"]; import("./page-old12345.js");',
  '/assets/page-old12345.js': 'import "./shared-old12345.js"; export default "old page";',
  '/assets/shared-old12345.js': 'export default "old shared dependency";',
  '/assets/page-old12345.css': '@font-face {src:url("./font-old12345.woff2")}',
  '/assets/font-old12345.woff2': 'font binary',
};

test('copies the full live lazy graph without replacing current files or HTML', async t => {
  const dir = await output(t, { 'index.html': 'NEW HTML', 'assets/entry-new12345.js': 'new entry', 'assets/shared-old12345.js': 'existing immutable file' });
  const calls = [];
  const result = await preserveBrowserAssets({ outDir: dir, origin, now, fetchImpl: remote(liveFiles, calls) });
  assert.equal(result.live, 5);
  assert.equal(result.copied, 4);
  assert.equal(await fs.readFile(path.join(dir, 'index.html'), 'utf8'), 'NEW HTML');
  assert.equal(await fs.readFile(path.join(dir, 'assets/shared-old12345.js'), 'utf8'), 'existing immutable file');
  assert.equal(await fs.readFile(path.join(dir, 'assets/page-old12345.js'), 'utf8'), liveFiles['/assets/page-old12345.js']);
  assert.equal(calls.filter(x => x === '/assets/page-old12345.js').length, 1);
  const history = JSON.parse(await fs.readFile(path.join(dir, 'assets/browser-asset-history.json')));
  assert.equal(history.assets.length, 6);
});

test('a third deployment retains the first deployment, but expires 30-day history', async t => {
  const first = await output(t, { 'assets/entry-second12.js': 'import("./page-second12.js")', 'assets/page-second12.js': 'second page' });
  await preserveBrowserAssets({ outDir: first, origin, now, fetchImpl: remote(liveFiles) });
  const firstHistory = JSON.parse(await fs.readFile(path.join(first, 'assets/browser-asset-history.json')));
  firstHistory.assets.push({ path: '/assets/expired-Ab123456.js', lastSeen: now - 31 * day });
  const secondRemote = { '/': '<script src="/assets/entry-second12.js"></script>', '/assets/browser-asset-history.json': JSON.stringify(firstHistory) };
  for (const item of firstHistory.assets.filter(item => !item.path.includes('expired'))) {
    secondRemote[item.path] = await fs.readFile(path.join(first, item.path.slice(1)), 'utf8');
  }
  const third = await output(t, { 'assets/entry-third123.js': 'third entry' });
  const calls = [];
  await preserveBrowserAssets({ outDir: third, origin, now: now + day, fetchImpl: remote(secondRemote, calls) });
  assert.equal(await fs.readFile(path.join(third, 'assets/shared-old12345.js'), 'utf8'), liveFiles['/assets/shared-old12345.js']);
  assert(!calls.includes('/assets/expired-Ab123456.js'));
  const history = JSON.parse(await fs.readFile(path.join(third, 'assets/browser-asset-history.json')));
  assert.equal(history.assets.find(x => x.path === '/assets/page-old12345.js').lastSeen, now);
  assert.equal(history.assets.find(x => x.path === '/assets/page-second12.js').lastSeen, now + day);
  assert(!history.assets.some(x => x.path === '/assets/expired-Ab123456.js'));
});

test('failed dependency downloads abort before writing any old files', async t => {
  const dir = await output(t, { 'assets/new.js': 'new file' });
  const files = { ...liveFiles };
  delete files['/assets/shared-old12345.js'];
  const calls = [];
  await assert.rejects(preserveBrowserAssets({ outDir: dir, origin, now, fetchImpl: remote(files, calls) }), /HTTP 404/);
  assert.deepEqual(await fs.readdir(path.join(dir, 'assets')), ['new.js']);
  assert.equal(calls.filter(x => x === '/assets/shared-old12345.js').length, 3);
});

test('bootstraps from the legacy inventory redirect without following login', async t => {
  const dir = await output(t);
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (new URL(url).pathname.endsWith('browser-asset-history.json')) {
      return new Response(null, { status: 303, headers: { location: '/login' } });
    }
    return remote(liveFiles)(url);
  };
  const result = await preserveBrowserAssets({ outDir: dir, origin, now, fetchImpl });
  assert.equal(result.copied, 5);
  assert.equal(result.retained, 5);
});

test('rejects invalid history and HTML disguised as an asset', async t => {
  const dir = await output(t);
  const badHistory = { ...liveFiles, '/assets/browser-asset-history.json': JSON.stringify({ version: 1, assets: [{ path: '/api/auth/user', lastSeen: now }] }) };
  await assert.rejects(preserveBrowserAssets({ outDir: dir, origin, now, fetchImpl: remote(badHistory) }), /Invalid browser asset history entry/);
  const fetchImpl = async url => new URL(url).pathname === '/assets/entry-old12345.js'
    ? new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } }) : remote(liveFiles)(url);
  await assert.rejects(preserveBrowserAssets({ outDir: dir, origin, now, fetchImpl }), /HTML returned for browser asset/);
  assert.deepEqual(await fs.readdir(path.join(dir, 'assets')), []);
});

test('finds Vite preload maps, imports and CSS URLs, excluding external or nonasset files', () => {
  const found = referencedAssets('const deps=["assets/page-Ab123456.js"]; import("./shared-Zy912345.js"); url(font-Ab234567.woff2); "https://other.test/assets/external.js"; "/api/example.js";', `${origin}/assets/entry.js`, origin);
  assert.deepEqual(found, ['/assets/page-Ab123456.js', '/assets/shared-Zy912345.js', '/assets/font-Ab234567.woff2']);
});

test('production static handler serves preserved files and keeps current navigation and real 404s', async t => {
  const { default: express } = await import('express');
  const { serveStatic } = await import('../server/vite.ts');
  const { createSubscriptionGate } = await import('../server/subscriptionGate.ts');
  const root = await output(t);
  const dir = path.join(root, 'dist/public');
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), '<html><title>NEW BUILD</title><script src="/assets/new-Ab123456.js"></script></html>');
  await fs.writeFile(path.join(dir, 'assets/new-Ab123456.js'), 'new build');
  await preserveBrowserAssets({ outDir: dir, origin, now, fetchImpl: remote(liveFiles) });
  const previousCwd = process.cwd();
  process.chdir(root);
  const app = express();
  app.use(createSubscriptionGate(async () => ({ authenticated: false, authorized: false, accessState: 'anonymous', reason: 'not_authenticated' })));
  try { serveStatic(app); } finally { process.chdir(previousCwd); }
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const local = `http://127.0.0.1:${server.address().port}`;
  for (const name of Object.keys(liveFiles).filter(name => name !== '/')) {
    const response = await fetch(local + name);
    assert.equal(response.status, 200, name);
    assert.equal(await response.text(), liveFiles[name], name);
    if (name.endsWith('.js')) assert.match(response.headers.get('content-type'), /javascript/);
    if (name.endsWith('.css')) assert.match(response.headers.get('content-type'), /text\/css/);
  }
  const page = await fetch(`${local}/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(await page.text(), /new-Ab123456.js/);
  const missing = await fetch(`${local}/assets/missing-Ab123456.js`);
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Static asset not found');
  assert.equal(missing.headers.get('cache-control'), 'no-store');
  const redirect = await fetch(`${local}/support`, { redirect: 'manual' });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/contact');
  const manifest = await fetch(`${local}/assets/browser-asset-history.json`);
  assert.equal(manifest.status, 200);
  assert.equal((await manifest.json()).version, 1);
  for (const protectedPath of ['/assets/export.json', '/legal-consultation']) {
    const denied = await fetch(local + protectedPath, { redirect: 'manual' });
    assert.equal(denied.status, 303);
    assert.equal(denied.headers.get('location'), '/login');
  }
});
