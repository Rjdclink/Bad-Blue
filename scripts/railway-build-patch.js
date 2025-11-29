#!/usr/bin/env node
/**
 * Railway Build Patch Script
 * This script patches vite.config.ts for Node 20 compatibility during Railway builds.
 * It replaces import.meta.dirname with a Node 20 compatible __dirname polyfill.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viteConfigPath = path.resolve(__dirname, '..', 'vite.config.ts');

console.log('[Railway Build Patch] Starting vite.config.ts patch for Node 20 compatibility...');

try {
  // Read the current vite.config.ts
  let content = fs.readFileSync(viteConfigPath, 'utf8');
  
  // Check if already patched
  if (content.includes('// Node 20 compatibility: polyfill for __dirname')) {
    console.log('[Railway Build Patch] File already patched, skipping...');
    process.exit(0);
  }
  
  // Add the import for fileURLToPath
  if (!content.includes("import { fileURLToPath } from")) {
    content = content.replace(
      'import path from "path";',
      'import path from "path";\nimport { fileURLToPath } from "url";'
    );
  }
  
  // Add the __dirname polyfill after imports
  const importEndIndex = content.lastIndexOf('import ');
  const importEndLineIndex = content.indexOf('\n', importEndIndex);
  content = content.slice(0, importEndLineIndex + 1) +
    '\n// Node 20 compatibility: polyfill for __dirname\n' +
    'const __dirname = path.dirname(fileURLToPath(import.meta.url));\n' +
    content.slice(importEndLineIndex + 1);
  
  // Replace all instances of import.meta.dirname with __dirname
  content = content.replace(/import\.meta\.dirname/g, '__dirname');
  
  // Write the patched file
  fs.writeFileSync(viteConfigPath, content, 'utf8');
  
  console.log('[Railway Build Patch] ✓ Successfully patched vite.config.ts for Node 20');
  console.log('[Railway Build Patch] Replacements made:');
  console.log('  - Added fileURLToPath import');
  console.log('  - Added __dirname polyfill');
  console.log('  - Replaced all import.meta.dirname with __dirname');
  
} catch (error) {
  console.error('[Railway Build Patch] ✗ Failed to patch vite.config.ts:', error);
  process.exit(1);
}