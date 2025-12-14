#!/usr/bin/env node

import puppeteer from 'puppeteer';
import fs from 'node:fs';

async function testPuppeteer() {
  console.log('🧪 Testing Puppeteer setup...\n');

  try {
    // Check for Chromium
    const candidates = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/local/bin/google-chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ].filter(Boolean);

    const executablePath =
      candidates.find((p) => {
        try {
          return fs.existsSync(p);
        } catch {
          return false;
        }
      }) || puppeteer.executablePath?.() || undefined;

    if (!executablePath) {
      throw new Error('No Chromium/Chrome executable found. Set PUPPETEER_EXECUTABLE_PATH.');
    }
    console.log(`✓ Chromium path: ${executablePath}`);

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
