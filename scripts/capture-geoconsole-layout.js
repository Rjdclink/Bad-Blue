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

  return candidates.find(candidate => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || puppeteer.executablePath?.() || undefined;
}

async function waitForHttpOk(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stopProcess(processHandle) {
  if (!processHandle || processHandle.killed) return;
  try {
    processHandle.kill('SIGTERM');
    await Promise.race([
      once(processHandle, 'exit'),
      new Promise(resolve => setTimeout(resolve, 5_000)),
    ]);
    if (!processHandle.killed) processHandle.kill('SIGKILL');
  } catch {
    // Best-effort cleanup only.
  }
}

async function main() {
  const executablePath = resolveChromiumPath();
  if (!executablePath) {
    throw new Error('No Chromium/Chrome executable found. Set PUPPETEER_EXECUTABLE_PATH.');
  }

  const loginEmail = String(process.env.LEGALWHAT_E2E_EMAIL || '').trim();
  const loginPassword = String(process.env.LEGALWHAT_E2E_PASSWORD || '').trim();
  if (!loginEmail || !loginPassword) {
    throw new Error(
      'Authenticated SPECTRA capture requires LEGALWHAT_E2E_EMAIL and LEGALWHAT_E2E_PASSWORD.'
    );
  }
  if (!String(process.env.SESSION_SECRET || '').trim()) {
    throw new Error('Authenticated SPECTRA capture requires SESSION_SECRET.');
  }
  const hasDatabase = [
    process.env.SUPABASE_DATABASE_URL,
    process.env.SUPABASE_DB_URL,
    process.env.DATABASE_URL,
  ].some(value => String(value || '').trim());
  if (!hasDatabase) {
    throw new Error('Authenticated SPECTRA capture requires database configuration.');
  }

  const port = Number(process.env.UI_PREVIEW_PORT || 4173);
  const baseUrl = `http://127.0.0.1:${port}`;
  const capturePath = process.env.UI_CAPTURE_PATH || '/spectra';
  const outPath = path.resolve(
    process.cwd(),
    process.env.UI_CAPTURE_OUTPUT || 'artifacts/ui_spectra_layout.png'
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Use the full application server, not Vite-only preview. SPECTRA is an
  // authenticated surface and visual proof must exercise the same auth/router
  // contract as the actual application.
  const server = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'dev'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'development',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const serverLogs = [];
  server.stdout?.on('data', data => serverLogs.push(String(data)));
  server.stderr?.on('data', data => serverLogs.push(String(data)));

  try {
    await waitForHttpOk(`${baseUrl}/api/health`, 90_000);

    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage();
      const browserErrors = [];
      page.on('pageerror', error => browserErrors.push(`[pageerror] ${error?.message || String(error)}`));
      page.on('console', message => {
        if (message.type() === 'error') browserErrors.push(`[console.error] ${message.text()}`);
      });

      await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });

      await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#login-email', { timeout: 30_000 });
      await page.type('#login-email', loginEmail);
      await page.type('#login-password', loginPassword);
      await page.click('button[type="submit"]');
      await page.waitForFunction(
        () => window.location.pathname !== '/login',
        { timeout: 30_000 }
      );

      await page.goto(`${baseUrl}${capturePath}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('[data-testid="spectra-console"]', { timeout: 45_000 });
      await page.waitForFunction(
        () => {
          const text = document.body?.innerText || '';
          return text.includes('SPECTRA Console') &&
            text.includes('What is it that you want to locate?');
        },
        { timeout: 45_000 }
      );

      const fatalErrors = browserErrors.filter(error =>
        error.includes('getImageData') ||
        error.includes('leaflet.heat') ||
        error.includes('Uncaught') ||
        error.includes('TypeError')
      );
      if (fatalErrors.length) {
        throw new Error(`SPECTRA render error: ${fatalErrors.join(' | ')}`);
      }

      await page.screenshot({ path: outPath, fullPage: true });
      console.log(`[SPECTRA_CAPTURE] wrote ${outPath}`);
    } finally {
      await browser.close();
    }
  } catch (error) {
    if (serverLogs.length) {
      console.error('\n--- SPECTRA capture server log tail ---');
      console.error(serverLogs.slice(-100).join(''));
    }
    throw error;
  } finally {
    await stopProcess(server);
  }
}

main().catch(error => {
  console.error('[SPECTRA_CAPTURE] failed:', error);
  process.exit(1);
});
