#!/usr/bin/env node
const fs = require('fs');

console.log('🔍 Stage 5 Verification\n');

const requiredFiles = [
  'server/routes/autosave.routes.ts',
  'server/routes/law-types.routes.ts'
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    console.error(`❌ ${file} not found`);
    process.exit(1);
  }
  console.log(`✅ ${file} exists`);
}

// Check routes.ts includes new routes
const routesContent = fs.readFileSync('server/routes.ts', 'utf8');
if (!routesContent.includes('setupAutosaveRoutes')) {
  console.error('❌ server/routes.ts missing setupAutosaveRoutes');
  process.exit(1);
}
if (!routesContent.includes('setupLawTypesRoutes')) {
  console.error('❌ server/routes.ts missing setupLawTypesRoutes');
  process.exit(1);
}

console.log('✅ Routes properly registered');
console.log('✅ Stage 5 complete - Ready for Stage 6');
