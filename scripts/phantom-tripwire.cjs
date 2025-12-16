#!/usr/bin/env node
/**
 * Phase 3: Phantom Tripwire - Build-Time Guard
 * 
 * Fails the build if any dependency, script, or lockfile introduces Chromium
 * Validates "no local browsers" constraint at build time
 */

const fs = require('fs');
const path = require('path');

console.log('[Phantom Tripwire] Checking for Chromium violations...\n');

let violationsFound = 0;

// Check 1: package.json scripts
console.log('[Check 1] Scanning package.json scripts...');
const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

const bannedScriptPatterns = [
  /playwright install/i,
  /npx playwright install/i,
  /playwright install chromium/i,
  /apt-get install.*chromium/i,
  /download-browser/i,
];

for (const [scriptName, scriptCommand] of Object.entries(packageJson.scripts || {})) {
  for (const pattern of bannedScriptPatterns) {
    if (pattern.test(scriptCommand)) {
      console.error(`  ✗ VIOLATION: Script "${scriptName}" contains banned pattern: ${pattern}`);
      console.error(`    Command: ${scriptCommand}`);
      violationsFound++;
    }
  }
}

if (violationsFound === 0) {
  console.log('  ✓ No Chromium install scripts found');
}

// Check 2: Dockerfile
console.log('\n[Check 2] Scanning Dockerfile...');
const dockerfilePath = path.join(__dirname, '../Dockerfile');
if (fs.existsSync(dockerfilePath)) {
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf-8');
  
  const bannedDockerPatterns = [
    /npx playwright install chromium/i,
    /apt-get install.*chromium[^\s]*/i,
    /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0/i,
  ];
  
  const lines = dockerfile.split('\n');
  lines.forEach((line, index) => {
    for (const pattern of bannedDockerPatterns) {
      if (pattern.test(line)) {
        console.error(`  ✗ VIOLATION: Dockerfile line ${index + 1} contains banned pattern: ${pattern}`);
        console.error(`    Line: ${line.trim()}`);
        violationsFound++;
      }
    }
  });
  
  if (violationsFound === 0) {
    console.log('  ✓ No Chromium install commands in Dockerfile');
  }
} else {
  console.log('  ⚠ Dockerfile not found, skipping');
}

// Check 3: Environment variables that would trigger browser downloads
console.log('\n[Check 3] Checking environment configuration...');
const envExamplePath = path.join(__dirname, '../.env.example');
if (fs.existsSync(envExamplePath)) {
  const envExample = fs.readFileSync(envExamplePath, 'utf-8');
  
  // Check for PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 (would allow downloads)
  if (envExample.includes('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0')) {
    console.error('  ✗ VIOLATION: .env.example sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0');
    violationsFound++;
  } else {
    console.log('  ✓ No environment violations found');
  }
}

// Check 4: Verify playwright-core (not playwright) in dependencies
console.log('\n[Check 4] Verifying playwright-core usage...');
if (packageJson.dependencies && packageJson.dependencies['playwright']) {
  console.error('  ✗ VIOLATION: package.json contains "playwright" dependency');
  console.error('    Use "playwright-core" instead (no bundled browsers)');
  violationsFound++;
} else if (packageJson.dependencies && packageJson.dependencies['playwright-core']) {
  console.log('  ✓ Using playwright-core (no bundled browsers)');
} else {
  console.log('  ⚠ No playwright dependency found');
}

// Summary
console.log('\n═══════════════════════════════════════');
if (violationsFound === 0) {
  console.log('✓ TRIPWIRE PASSED');
  console.log('  No Chromium install/download violations detected');
  console.log('  Build can proceed');
  process.exit(0);
} else {
  console.log('✗ TRIPWIRE FAILED');
  console.log(`  Found ${violationsFound} violation(s)`);
  console.log('  Build MUST NOT proceed');
  console.log('');
  console.log('Fix: Remove Chromium install commands and use remote browsers only');
  console.log('  - Use playwright-core (not playwright)');
  console.log('  - Remove "npx playwright install" commands');
  console.log('  - Set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1');
  console.log('  - Use BROWSER_WS_ENDPOINT or ZENROWS_API_KEY for remote rendering');
  process.exit(1);
}
