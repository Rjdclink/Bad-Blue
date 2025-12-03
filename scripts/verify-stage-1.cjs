#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

console.log('🔍 Stage 1 Verification\n');

const requiredDeps = ['zod', 'winston', 'drizzle-orm', '@tanstack/react-query'];
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const missing = requiredDeps.filter(dep => 
  !packageJson.dependencies[dep] && !packageJson.devDependencies[dep]
);

if (missing.length > 0) {
  console.error('❌ Missing:', missing.join(', '));
  process.exit(1);
}

const dirs = ['logs', 'server/db', 'server/routes', 'server/types', 'scripts'];
const missingDirs = dirs.filter(dir => !fs.existsSync(dir));

if (missingDirs.length > 0) {
  console.error('❌ Missing directories:', missingDirs.join(', '));
  process.exit(1);
}

console.log('✅ Stage 1 complete - Ready for Stage 2');
