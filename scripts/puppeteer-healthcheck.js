#!/usr/bin/env node

import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const STAGE1 = process.env.LEGALWHAT_E2E_STAGE1 === '1' || process.env.LEGALWHAT_E2E_STAGE1 === 'true';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttpOk(url, { timeoutMs = 60000, intervalMs = 500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return true;
    } catch (_) {
      // ignore
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for server: ${url}`);
}

async function clickButtonByText(page, text) {
  const clicked = await page.evaluate((t) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find((b) => (b.textContent || '').includes(t));
    if (!btn) return false;
    btn.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Button not found: "${text}"`);
}

async function runStage1E2E({ executablePath }) {
  const port = Number(process.env.PORT || 5010);
  const baseUrl = `http://localhost:${port}`;

  console.log(`\n🔧 Starting LegalWhat dev server on ${baseUrl} (dev-lite mode)...`);

  // Spawn "npm run dev" and let this script own lifecycle.
  const serverProc = spawn('npm', ['run', 'dev'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      LEGALWHAT_DEV_LITE: '1',
      // Ensure stable sessions even in dev-lite mode.
      SESSION_SECRET: process.env.SESSION_SECRET || 'dev-session-secret-legalwhat-000000000000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverLogs = [];
  serverProc.stdout.on('data', (d) => serverLogs.push(String(d)));
  serverProc.stderr.on('data', (d) => serverLogs.push(String(d)));

  const stopServer = async () => {
    if (serverProc.killed) return;
    serverProc.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => serverProc.on('exit', resolve)),
      sleep(10000),
    ]);
    if (!serverProc.killed) {
      serverProc.kill('SIGKILL');
    }
  };

  try {
    await waitForHttpOk(`${baseUrl}/api/health`, { timeoutMs: 90000 });
    console.log('✓ Server is responding');

    console.log('✓ Launching browser...');
    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1400, height: 900 });

      const reqCounts = {
        osint: 0,
        inmate: 0,
      };

      page.on('request', (req) => {
        const url = req.url();
        const method = req.method();
        if (method === 'POST' && url.includes('/api/osint/full-search')) reqCounts.osint += 1;
        if (method === 'POST' && url.includes('/api/inmate-search')) reqCounts.inmate += 1;
      });

      // -----------------------
      // Login (master creds)
      // -----------------------
      console.log('\n▶ Login');
      await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle2' });
      await page.type('#login-email', 'rjdclink@outlook.com', { delay: 10 });
      await page.type('#login-password', 'SARBEAR', { delay: 10 });
      // Click the actual submit button (avoid the "Login" tab trigger).
      await page.click('button[type="submit"]');

      // Wouter is client-side routing; wait for pathname to change.
      await page.waitForFunction(() => window.location.pathname !== '/login', { timeout: 30000 });
      console.log(`✓ Logged in, now at ${await page.evaluate(() => window.location.pathname)}`);

      // -----------------------
      // 1) Pantheon
      // -----------------------
      console.log('\n▶ Pantheon');
      reqCounts.osint = 0;
      await page.goto(`${baseUrl}/pantheon`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#pantheon-name', { timeout: 30000 });

      // Ensure no refresh loop: stable pathname for a short window
      await sleep(1500);
      const pantheonPath = await page.evaluate(() => window.location.pathname);
      if (pantheonPath !== '/pantheon') throw new Error(`Pantheon redirect/loop detected: ${pantheonPath}`);

      await page.click('#pantheon-name', { clickCount: 3 });
      await page.type('#pantheon-name', 'John Smith', { delay: 10 });
      await page.click('#pantheon-location', { clickCount: 3 });
      await page.type('#pantheon-location', 'New York, NY', { delay: 10 });

      await clickButtonByText(page, 'Initiate PANTHEON Search');
      await page.waitForFunction(() => document.body && document.body.innerText.includes('Search Results'), { timeout: 60000 });
      await page.waitForFunction(() => document.body && document.body.innerText.includes('Location Intelligence Map'), { timeout: 60000 });
      if (reqCounts.osint !== 1) throw new Error(`Pantheon: expected 1 OSINT run, saw ${reqCounts.osint}`);
      console.log('✓ Search finished, report + visualization present, no duplicate runs');

      // Refresh must not re-fire searches
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(1000);
      if (reqCounts.osint !== 1) throw new Error(`Pantheon: refresh re-fired OSINT (${reqCounts.osint})`);
      console.log('✓ Refresh did not re-fire Pantheon search');

      // -----------------------
      // 2) People Finder
      // -----------------------
      console.log('\n▶ People Finder');
      reqCounts.osint = 0;
      await page.goto(`${baseUrl}/people-finder`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#name', { timeout: 30000 });
      await sleep(1500);
      const pfPath = await page.evaluate(() => window.location.pathname);
      if (pfPath !== '/people-finder') throw new Error(`People Finder redirected unexpectedly: ${pfPath}`);

      await page.click('#name', { clickCount: 3 });
      await page.type('#name', 'Jane Doe', { delay: 10 });
      await clickButtonByText(page, 'Search');

      await page.waitForFunction(() => document.body && document.body.innerText.includes('Identity Summary'), { timeout: 60000 });
      if (reqCounts.osint !== 1) throw new Error(`People Finder: expected 1 OSINT run, saw ${reqCounts.osint}`);
      await sleep(1500);
      const stillHasIdentity = await page.evaluate(() => document.body && document.body.innerText.includes('Identity Summary'));
      if (!stillHasIdentity) throw new Error('People Finder: results disappeared after rendering');
      console.log('✓ Search populated and stayed rendered; no redirect');

      // Refresh must not re-fire searches
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(1000);
      if (reqCounts.osint !== 1) throw new Error(`People Finder: refresh re-fired OSINT (${reqCounts.osint})`);
      console.log('✓ Refresh did not re-fire People Finder search');

      // -----------------------
      // 3) Inmate Locator
      // -----------------------
      console.log('\n▶ Inmate Locator');
      reqCounts.inmate = 0;
      await page.goto(`${baseUrl}/inmate-locator`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#firstName', { timeout: 30000 });

      await page.type('#firstName', 'John', { delay: 10 });
      await page.type('#lastName', 'Doe', { delay: 10 });
      await clickButtonByText(page, 'Search Inmates');

      await page.waitForFunction(() => document.body && document.body.innerText.includes('Search Results'), { timeout: 60000 });
      if (reqCounts.inmate !== 1) throw new Error(`Inmate Locator: expected 1 run, saw ${reqCounts.inmate}`);
      console.log('✓ Search executed and returned results; no dependency on Pantheon state');

      // Refresh must not re-fire searches
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(1000);
      if (reqCounts.inmate !== 1) throw new Error(`Inmate Locator: refresh re-fired search (${reqCounts.inmate})`);
      console.log('✓ Refresh did not re-fire Inmate Locator search');

      console.log('\n✅ STAGE 1 E2E checks passed\n');
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error('\n❌ STAGE 1 E2E checks failed:', err.message);
    try {
      console.error('\n--- Server logs (tail) ---');
      console.error(serverLogs.slice(-200).join(''));
    } catch (_) {}
    throw err;
  } finally {
    await stopServer();
  }
}

async function testPuppeteer() {
  console.log('🧪 Testing Puppeteer setup...\n');

  try {
    // Check for Chromium
    const candidatePaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/bin/chromium',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
    ].filter(Boolean);
    const executablePath = candidatePaths.find((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });
    if (!executablePath) {
      throw new Error(`No Chromium/Chrome executable found (tried: ${candidatePaths.join(', ')})`);
    }
    console.log(`✓ Chromium path: ${executablePath}`);

    if (STAGE1) {
      await runStage1E2E({ executablePath });
      process.exit(0);
    }

    // Launch browser
    console.log('✓ Launching browser...');
    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    console.log('✓ Browser launched successfully');

    // Test page navigation
    const page = await browser.newPage();
    await page.goto('https://example.com', { waitUntil: 'networkidle2' });
    const title = await page.title();
    console.log(`✓ Page loaded: ${title}`);

    // Cleanup
    await browser.close();
    console.log('\n✅ All Puppeteer tests passed!\n');
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Puppeteer test failed:', message);
    process.exit(1);
  }
}

testPuppeteer();
