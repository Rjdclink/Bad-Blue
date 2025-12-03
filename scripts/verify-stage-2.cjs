#!/usr/bin/env node
const fs = require('fs');

console.log('🔍 Stage 2 Verification\n');

// Check config.ts exists
if (!fs.existsSync('server/config.ts')) {
  console.error('❌ server/config.ts not found');
  process.exit(1);
}

// Check server/index.ts has loadConfig import
const indexContent = fs.readFileSync('server/index.ts', 'utf8');
if (!indexContent.includes('loadConfig')) {
  console.error('❌ server/index.ts missing loadConfig integration');
  process.exit(1);
}

console.log('✅ Configuration system created');
console.log('✅ Stage 2 complete - Ready for Stage 3');
