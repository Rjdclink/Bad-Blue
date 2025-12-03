#!/usr/bin/env node
const fs = require('fs');

console.log('🔍 Stage 16 Verification\n');

// Check constants.ts exists
if (!fs.existsSync('server/constants.ts')) {
  console.error('❌ server/constants.ts not found');
  process.exit(1);
}

console.log('✅ server/constants.ts exists');

const content = fs.readFileSync('server/constants.ts', 'utf8');

// Check for key exports
const requiredExports = [
  'US_STATES',
  'US_STATE_NAMES',
  'AI_PROVIDERS',
  'OPENROUTER_MODELS',
  'LAW_TYPES',
  'SESSION_TYPES',
  'DOCUMENT_TYPES',
  'VALIDATION',
  'HTTP_STATUS',
  'RATE_LIMITS'
];

let allExportsFound = true;
for (const exportName of requiredExports) {
  if (!content.includes(`export const ${exportName}`)) {
    console.error(`❌ Missing export: ${exportName}`);
    allExportsFound = false;
  } else {
    console.log(`✅ Export found: ${exportName}`);
  }
}

// Check for type exports
const requiredTypes = [
  'USState',
  'AIProvider',
  'LawType',
  'SessionType',
  'DocumentType'
];

for (const typeName of requiredTypes) {
  if (!content.includes(`export type ${typeName}`)) {
    console.error(`❌ Missing type: ${typeName}`);
    allExportsFound = false;
  } else {
    console.log(`✅ Type found: ${typeName}`);
  }
}

// Check for Qwen in OpenRouter models (as mentioned in requirements)
if (!content.includes('qwen')) {
  console.error('❌ Qwen models not found in OPENROUTER_MODELS');
  allExportsFound = false;
} else {
  console.log('✅ Qwen models included in OPENROUTER_MODELS');
}

// Check all 50 US states are present
const stateCount = (content.match(/'[A-Z]{2}'/g) || []).length;
if (stateCount < 50) {
  console.error(`❌ Expected 50 US states, found ${stateCount}`);
  allExportsFound = false;
} else {
  console.log(`✅ All 50 US states included`);
}

if (!allExportsFound) {
  console.error('\n❌ Stage 16 verification failed');
  process.exit(1);
}

console.log('\n✅ All constants exported correctly');
console.log('✅ Stage 16 complete - Shared constants created');
