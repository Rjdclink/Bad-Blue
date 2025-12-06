#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function testPuppeteer() {
  console.log('🧪 Testing Puppeteer setup...\n');

  try {
    // Check for Chromium
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
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
    console.error('\n❌ Puppeteer test failed:', error.message);
    process.exit(1);
  }
}

testPuppeteer();
