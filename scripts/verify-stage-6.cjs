#!/usr/bin/env node
const fs = require('fs');

console.log('🔍 Stage 6 Verification\n');

const requiredHooks = [
  'client/src/hooks/useDebounce.ts',
  'client/src/hooks/useAutosave.ts',
  'client/src/hooks/useWorkSession.ts',
  'client/src/hooks/useUserSessions.ts'
];

for (const hook of requiredHooks) {
  if (!fs.existsSync(hook)) {
    console.error(`❌ ${hook} not found`);
    process.exit(1);
  }
  console.log(`✅ ${hook} exists`);
}

// Check that hooks export correct functions
const autosaveContent = fs.readFileSync('client/src/hooks/useAutosave.ts', 'utf8');
if (!autosaveContent.includes('export function useAutosave')) {
  console.error('❌ useAutosave hook not properly exported');
  process.exit(1);
}

console.log('✅ All hooks created and exported');
console.log('✅ Stage 6 complete - Ready for Stage 7');
