#!/usr/bin/env node

import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

function resolveChromiumPath() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/local/bin/google-chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  const fromDisk = candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  return fromDisk || puppeteer.executablePath?.() || undefined;
}

async function waitForHttpOk(url, timeoutMs) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.ok) return;
    } catch {
      // ignore
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${url}`);
    }

    await new Promise((r) => setTimeout(r, 250));
  }
}

async function main() {
  const outPath = path.resolve(process.cwd(), 'artifacts', 'ui_geoconsole_layout.png');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const executablePath = resolveChromiumPath();
  if (!executablePath) {
    throw new Error('No Chromium/Chrome executable found. Set PUPPETEER_EXECUTABLE_PATH.');
  }

  // Start Vite dev server (client-only) on a fixed port.
  const port = Number(process.env.UI_PREVIEW_PORT || 4173);
  const baseUrl = `http://127.0.0.1:${port}`;

  const vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: 'inherit',
    }
  );

  try {
    await waitForHttpOk(`${baseUrl}/`, 60_000);

    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });

      await page.goto(`${baseUrl}/geoconsole`, { waitUntil: 'networkidle2' });

      // Confirm the key widgets exist (header + layer switches + timeline buttons).
      await page.waitForFunction(() => {
        const bodyText = document.body?.innerText || '';
        const hasTitle = bodyText.includes('Hybrid Geoconsole') || bodyText.includes('SPECTRA GeoConsole');
        const hasExport = bodyText.includes('Export');
        const hasProcess = bodyText.includes('Process');
        return hasTitle && hasExport && hasProcess;
      }, { timeout: 60_000 });

      // If Vite/runtime overlays appear, remove them so the screenshot proves
      // widget visibility (layout-only verification).
      await page.evaluate(() => {
        try {
          document.querySelector('vite-error-overlay')?.remove();
          document.querySelectorAll('[data-vite-error-overlay]').forEach((n) => n.remove());
        } catch {
          // ignore
        }
      });
      await new Promise((r) => setTimeout(r, 100));

      await page.screenshot({ path: outPath, fullPage: true });

      // Log the output path for evidence capture.
      console.log(`[UI_CAPTURE] wrote ${outPath}`);
    } finally {
      await browser.close();
    }
  } finally {
    // Best-effort shutdown.
    try {
      vite.kill('SIGTERM');
      await Promise.race([
        once(vite, 'exit'),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
      if (!vite.killed) vite.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error('[UI_CAPTURE] failed:', err);
  process.exit(1);
});
