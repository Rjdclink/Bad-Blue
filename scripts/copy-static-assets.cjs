#!/usr/bin/env node
/**
 * Copy Static Assets for Production
 * 
 * This script copies the Vite-built frontend assets from dist/public/ to public/
 * so that the production server can find them at the expected path.
 * 
 * Background:
 * - Vite builds frontend to dist/public/
 * - esbuild bundles server to dist/index.js
 * - serveStatic() in vite.ts looks for path.resolve(__dirname, "..", "public")
 * - When running from dist/index.js, __dirname is /app/dist
 * - So it looks for /app/public/ but files are at /app/dist/public/
 * 
 * This script copies dist/public/ → public/ to fix the path mismatch.
 * 
 * NOTE: Uses CommonJS syntax for Railway compatibility (plain node invocation)
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.resolve(projectRoot, 'dist', 'public');
const destPath = path.resolve(projectRoot, 'public');

console.log('[Copy Static Assets] Starting...');
console.log('  Source: ' + sourcePath);
console.log('  Destination: ' + destPath);

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPathEntry = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPathEntry);
    } else {
      fs.copyFileSync(srcPath, destPathEntry);
    }
  }
}

try {
  if (!fs.existsSync(sourcePath)) {
    console.error('[Copy Static Assets] ✗ Source directory does not exist: ' + sourcePath);
    console.error('[Copy Static Assets] Make sure vite build completed successfully');
    process.exit(1);
  }
  
  if (fs.existsSync(destPath)) {
    console.log('[Copy Static Assets] Removing existing public directory...');
    fs.rmSync(destPath, { recursive: true, force: true });
  }
  
  console.log('[Copy Static Assets] Copying files...');
  copyDir(sourcePath, destPath);
  
  const indexPath = path.join(destPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    console.log('[Copy Static Assets] ✓ Successfully copied static assets');
    console.log('[Copy Static Assets] ✓ index.html verified at: ' + indexPath);
    
    const files = fs.readdirSync(destPath);
    const fileList = files.slice(0, 10).join(', ') + (files.length > 10 ? '...' : '');
    console.log('[Copy Static Assets] Copied ' + files.length + ' items: ' + fileList);
  } else {
    console.error('[Copy Static Assets] ✗ index.html not found after copy');
    process.exit(1);
  }
  
} catch (error) {
  console.error('[Copy Static Assets] ✗ Failed: ' + error.message);
  process.exit(1);
}
