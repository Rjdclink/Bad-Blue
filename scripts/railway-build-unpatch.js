#!/usr/bin/env node
/**
 * Railway Build Unpatch Script
 * This script restores vite.config.ts to its original state after patching for Railway.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viteConfigPath = path.resolve(__dirname, '..', 'vite.config.ts');

console.log('[Railway Build Unpatch] Restoring vite.config.ts to original state...');

try {
  // Read the current vite.config.ts
  let content = fs.readFileSync(viteConfigPath, 'utf8');
  
  // Check if not patched
  if (!content.includes('// Node 20 compatibility: polyfill for __dirname')) {
    console.log('[Railway Build Unpatch] File not patched, skipping...');
    process.exit(0);
  }
  
  // Remove the fileURLToPath import
  content = content.replace('import { fileURLToPath } from "url";\n', '');
  
  // Remove the __dirname polyfill
  content = content.replace('\n// Node 20 compatibility: polyfill for __dirname\n', '');
  content = content.replace('const __dirname = path.dirname(fileURLToPath(import.meta.url));\n', '');
  
  // Replace all instances of __dirname back to import.meta.dirname
  content = content.replace(/path\.resolve\(__dirname,/g, 'path.resolve(import.meta.dirname,');
  
  // Write the restored file
  fs.writeFileSync(viteConfigPath, content, 'utf8');
  
  console.log('[Railway Build Unpatch] ✓ Successfully restored vite.config.ts');
  console.log('[Railway Build Unpatch] Restorations made:');
  console.log('  - Removed fileURLToPath import');
  console.log('  - Removed __dirname polyfill');
  console.log('  - Replaced all __dirname back to import.meta.dirname');
  
} catch (error) {
  console.error('[Railway Build Unpatch] ✗ Failed to restore vite.config.ts:', error);
  process.exit(1);
}