import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HISTORY = 'assets/browser-asset-history.json';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FILES = 5000;
const MAX_BYTES = 256 * 1024 * 1024;

function assetPath(reference, base, origin) {
  try {
    const url = new URL(reference.startsWith('assets/') ? `/${reference}` : reference, base);
    if (url.origin !== origin || url.search || url.hash) return null;
    // Only generated assets, never HTML, API responses, or arbitrary paths.
    if (!/^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(?:js|css|woff2?|ttf|otf|png|jpe?g|webp|svg|gif|ico|wasm)$/.test(url.pathname)) return null;
    return url.pathname;
  } catch { return null; }
}

export function referencedAssets(text, base, origin) {
  const assets = new Set();
  for (const match of text.matchAll(/["'(]([^"'()\s]+\.(?:js|css|woff2?|ttf|otf|png|jpe?g|webp|svg|gif|ico|wasm))["')]/g)) {
    const asset = assetPath(match[1], base, origin);
    if (asset) assets.add(asset);
  }
  return [...assets];
}

// Carry the live build and its unexpired history into the next immutable build.
// Old tabs keep the exact files they were compiled against, including lazy pages.
// A failed copy blocks the deployment rather than silently retiring those files.
export async function preserveBrowserAssets({ outDir, origin, now = Date.now(), fetchImpl = fetch }) {
  const source = new URL(origin).origin;
  const deadline = Date.now() + 180_000;
  let bytes = 0;
  async function download(url, optional = false) {
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() >= deadline) throw new Error('Browser asset preservation exceeded 180 seconds');
      try {
        const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
        if (optional && response.status === 404) return null;
        // The first release predates the public inventory allowlist. Its gate
        // sends this nonexistent JSON URL to /login instead of returning 404.
        if (optional && response.status === 303 && response.headers.get('location') === '/login') return null;
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${new URL(url).pathname}`);
        const body = Buffer.from(await response.arrayBuffer());
        bytes += body.length;
        if (bytes > MAX_BYTES) throw new Error('Browser asset history exceeded 256 MiB');
        return { body, type: response.headers.get('content-type') || '' };
      } catch (error) { failure = error; }
    }
    throw failure;
  }

  const root = await download(`${source}/`);
  if (!root.type.includes('text/html')) throw new Error('Browser asset source did not return HTML');
  const queue = referencedAssets(root.body.toString(), `${source}/`, source);
  if (!queue.some(name => name.endsWith('.js'))) throw new Error('No live browser entry script found');
  const live = new Set(queue);
  const downloaded = new Map();
  // Discover the entire live dependency graph before adding retired files.
  async function copyQueue(discover) {
    while (queue.length) {
      if (downloaded.size + queue.length > MAX_FILES) throw new Error('Browser asset history exceeded 5000 files');
      const batch = queue.splice(0, 6);
      await Promise.all(batch.map(async name => {
        const response = await download(`${source}${name}`);
        if (response.type.includes('text/html')) throw new Error(`HTML returned for browser asset ${name}`);
        downloaded.set(name, response.body);
        if (discover && /\.(?:js|css)$/.test(name)) {
          for (const dependency of referencedAssets(response.body.toString(), `${source}${name}`, source)) {
            if (!live.has(dependency)) { live.add(dependency); queue.push(dependency); }
          }
        }
      }));
    }
  }
  await copyQueue(true);

  const history = await download(`${source}/${HISTORY}`, true);
  const retained = new Map([...live].map(name => [name, now]));
  if (history) {
    const manifest = JSON.parse(history.body.toString());
    if (manifest.version !== 1 || !Array.isArray(manifest.assets)) throw new Error('Invalid browser asset history');
    for (const item of manifest.assets) {
      const name = assetPath(item.path, `${source}/`, source);
      if (!name || !Number.isFinite(item.lastSeen) || item.lastSeen > now) throw new Error('Invalid browser asset history entry');
      if (!live.has(name) && now - item.lastSeen < RETENTION_MS) {
        retained.set(name, item.lastSeen);
        if (!downloaded.has(name) && !queue.includes(name)) queue.push(name);
      }
    }
    await copyQueue(false);
  }

  // Validate every download before modifying the new build. Never replace its
  // index.html or any newly generated file with an older deployment's content.
  const current = await fs.readdir(path.join(outDir, 'assets'));
  for (const name of current) {
    const key = assetPath(`/assets/${name}`, `${source}/`, source);
    if (key) retained.set(key, now);
  }
  let copied = 0;
  for (const [name, body] of downloaded) {
    try {
      await fs.writeFile(path.join(outDir, name.slice(1)), body, { flag: 'wx' });
      copied++;
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  await fs.writeFile(path.join(outDir, HISTORY), JSON.stringify({
    version: 1,
    assets: [...retained].sort(([a], [b]) => a.localeCompare(b)).map(([name, lastSeen]) => ({ path: name, lastSeen })),
  }));
  return { live: live.size, copied, retained: retained.size, bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await preserveBrowserAssets({ outDir: path.resolve('dist/public'), origin: 'https://legalwhat.com' });
  console.log('[BrowserAssets] Preserved live and recent browser files:', JSON.stringify(result));
}
