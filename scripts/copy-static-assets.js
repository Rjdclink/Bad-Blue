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
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.resolve(projectRoot, 'dist', 'public');
const destPath = path.resolve(projectRoot, 'public');

console.log('[Copy Static Assets] Starting...');
console.log(`  Source: ${sourcePath}`);
console.log(`  Destination: ${destPath}`);

function copyDir(src, dest) {
  // Create destination directory
  fs.mkdirSync(dest, { recursive: true });
  
  // Read source directory
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

try {
  // Check if source exists
  if (!fs.existsSync(sourcePath)) {
    console.error('[Copy Static Assets] ✗ Source directory does not exist:', sourcePath);
    console.error('[Copy Static Assets] Make sure vite build completed successfully');
    process.exit(1);
  }
  
  // Remove existing public directory if it exists (to ensure clean copy)
  if (fs.existsSync(destPath)) {
    console.log('[Copy Static Assets] Removing existing public directory...');
    fs.rmSync(destPath, { recursive: true, force: true });
  }
  
  // Copy the directory
  console.log('[Copy Static Assets] Copying files...');
  copyDir(sourcePath, destPath);
  
  // Verify index.html exists
  const indexPath = path.join(destPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    console.log('[Copy Static Assets] ✓ Successfully copied static assets');
    console.log('[Copy Static Assets] ✓ index.html verified at:', indexPath);
    
    // List copied files
    const files = fs.readdirSync(destPath);
    console.log(`[Copy Static Assets] Copied ${files.length} items:`, files.slice(0, 10).join(', ') + (files.length > 10 ? '...' : ''));
  } else {
    console.error('[Copy Static Assets] ✗ index.html not found after copy');
    process.exit(1);
  }
  
} catch (error) {
  console.error('[Copy Static Assets] ✗ Failed:', error.message);
  process.exit(1);
}
