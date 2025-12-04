#!/usr/bin/env node
/**
 * Verify Build Output for Railway Deployment
 * 
 * This script verifies that all required files exist before deployment.
 * Catches build issues early before Railway tries to start the server.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

console.log('[Verify Build] Starting build verification...');
console.log('[Verify Build] Project root:', projectRoot);

const requiredFiles = [
  'dist/index.js',              // Bundled server
  'public/index.html',          // Frontend entry point
  'public/manifest.json',       // PWA manifest
  'public/robots.txt',          // SEO
];

const requiredDirs = [
  'dist',
  'public',
];

const optionalDirs = [
  'public/images', // Git-tracked directory, may not exist after build copy
];

const MAX_FILES_TO_DISPLAY = 15;

let hasErrors = false;

// Check required directories
console.log('\n[Verify Build] Checking directories...');
for (const dir of requiredDirs) {
  const dirPath = path.resolve(projectRoot, dir);
  if (fs.existsSync(dirPath)) {
    console.log(`  ✓ ${dir}`);
  } else {
    console.error(`  ✗ MISSING: ${dir}`);
    hasErrors = true;
  }
}

// Check optional directories (warnings only)
for (const dir of optionalDirs) {
  const dirPath = path.resolve(projectRoot, dir);
  if (fs.existsSync(dirPath)) {
    console.log(`  ✓ ${dir} (optional)`);
  } else {
    console.log(`  ⚠ NOT FOUND: ${dir} (optional, will be restored from git)`);
  }
}

// Check required files
console.log('\n[Verify Build] Checking files...');
for (const file of requiredFiles) {
  const filePath = path.resolve(projectRoot, file);
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    console.log(`  ✓ ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
  } else {
    console.error(`  ✗ MISSING: ${file}`);
    hasErrors = true;
  }
}

// Check public directory contents
console.log('\n[Verify Build] Public directory contents:');
const publicPath = path.resolve(projectRoot, 'public');
if (fs.existsSync(publicPath)) {
  const files = fs.readdirSync(publicPath);
  console.log(`  Found ${files.length} items:`);
  files.slice(0, MAX_FILES_TO_DISPLAY).forEach(file => {
    const filePath = path.join(publicPath, file);
    const stats = fs.statSync(filePath);
    const type = stats.isDirectory() ? 'DIR' : 'FILE';
    const size = stats.isDirectory() ? '' : ` (${(stats.size / 1024).toFixed(2)} KB)`;
    console.log(`    - ${file} [${type}]${size}`);
  });
  if (files.length > MAX_FILES_TO_DISPLAY) {
    console.log(`    ... and ${files.length - MAX_FILES_TO_DISPLAY} more`);
  }
}

// Summary
console.log('\n[Verify Build] ─────────────────────────────');
if (hasErrors) {
  console.error('[Verify Build] ✗ Build verification FAILED');
  console.error('[Verify Build] Missing required files or directories');
  process.exit(1);
} else {
  console.log('[Verify Build] ✓ Build verification PASSED');
  console.log('[Verify Build] All required files present');
  process.exit(0);
}
