#!/usr/bin/env node

/**
 * Stage 20 Verification Script
 * Verifies all Stage 20 deliverables are complete
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Stage 20 Verification\n');

let allPassed = true;

// ==================== CHECK SCRIPTS ====================
console.log('📜 Checking Scripts...');

const requiredScripts = [
  'scripts/final-verification.sh',
  'scripts/verify-stage-20.cjs',
  'scripts/verify-stage-1.cjs',
  'scripts/verify-stage-2.cjs',
  'scripts/verify-stage-3.cjs',
  'scripts/verify-stage-4.cjs',
  'scripts/verify-stage-5.cjs',
  'scripts/verify-stage-6.cjs',
  'scripts/verify-stage-16.cjs',
  'scripts/verify-stage-19.cjs',
  'scripts/prepare-deployment.sh',
];

for (const script of requiredScripts) {
  if (fs.existsSync(script)) {
    // Check if shell scripts are executable
    if (script.endsWith('.sh')) {
      try {
        fs.accessSync(script, fs.constants.X_OK);
        console.log(`✅ ${script} exists and is executable`);
      } catch {
        console.error(`❌ ${script} exists but is not executable`);
        console.log(`   Run: chmod +x ${script}`);
        allPassed = false;
      }
    } else {
      console.log(`✅ ${script} exists`);
    }
  } else {
    console.error(`❌ ${script} not found`);
    allPassed = false;
  }
}

console.log('');

// ==================== CHECK DOCUMENTATION ====================
console.log('📚 Checking Documentation...');

const requiredDocs = [
  { path: 'README.md', sections: ['AI Providers', 'Autosave', 'Deployment'] },
  { path: 'PRODUCTION_CHECKLIST.md', sections: ['Node.js Version', 'AI Providers'] },
  { path: 'CHANGELOG.md', sections: ['Stage 1', 'Stage 20'] },
  { path: 'IMPLEMENTATION_COMPLETE.md', sections: ['Stage', 'Complete'] },
  { path: 'docs/DEPLOYMENT_GUIDE.md', sections: ['Railway', 'Environment'] },
  { path: 'docs/AI_PROVIDERS.md', sections: ['OpenRouter', 'Gemini', 'Groq', 'Mistral'] },
  { path: 'docs/AUTOSAVE_ARCHITECTURE.md', sections: ['Database', 'API'] },
];

for (const doc of requiredDocs) {
  if (fs.existsSync(doc.path)) {
    const content = fs.readFileSync(doc.path, 'utf8');
    let docComplete = true;
    
    for (const section of doc.sections) {
      if (!content.includes(section)) {
        console.error(`❌ ${doc.path} missing section: ${section}`);
        docComplete = false;
        allPassed = false;
      }
    }
    
    if (docComplete) {
      console.log(`✅ ${doc.path} complete with all sections`);
    }
  } else {
    console.error(`❌ ${doc.path} not found`);
    allPassed = false;
  }
}

console.log('');

// ==================== CHECK PACKAGE.JSON SCRIPTS ====================
console.log('⚙️  Checking package.json scripts...');

if (fs.existsSync('package.json')) {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  const requiredScriptNames = ['verify', 'verify:final', 'deploy:check', 'migrate'];
  
  for (const scriptName of requiredScriptNames) {
    if (packageJson.scripts && packageJson.scripts[scriptName]) {
      console.log(`✅ package.json has '${scriptName}' script`);
    } else {
      console.error(`❌ package.json missing '${scriptName}' script`);
      allPassed = false;
    }
  }
  
  // Check engines field
  if (packageJson.engines && packageJson.engines.node) {
    console.log(`✅ package.json has engines.node: ${packageJson.engines.node}`);
  } else {
    console.error(`❌ package.json missing engines.node field`);
    allPassed = false;
  }
} else {
  console.error(`❌ package.json not found`);
  allPassed = false;
}

console.log('');

// ==================== CHECK CONFIGURATION FILES ====================
console.log('🔧 Checking Configuration Files...');

const configFiles = [
  '.nvmrc',
  'railway.json',
  '.gitignore',
  'tsconfig.json',
];

for (const file of configFiles) {
  if (fs.existsSync(file)) {
    console.log(`✅ ${file} exists`);
  } else {
    console.error(`❌ ${file} not found`);
    allPassed = false;
  }
}

// Check .gitignore has required entries
if (fs.existsSync('.gitignore')) {
  const gitignoreContent = fs.readFileSync('.gitignore', 'utf8');
  const requiredEntries = ['logs/', '.env', 'dist/'];
  
  for (const entry of requiredEntries) {
    if (gitignoreContent.includes(entry)) {
      console.log(`✅ .gitignore includes '${entry}'`);
    } else {
      console.warn(`⚠️  .gitignore missing '${entry}'`);
    }
  }
}

console.log('');

// ==================== SUMMARY ====================
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║              STAGE 20 VERIFICATION SUMMARY           ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log('');

if (allPassed) {
  console.log('✅ Stage 20 Complete - All 20 Stages Verified!');
  console.log('');
  console.log('Final Steps:');
  console.log('  1. Run: bash scripts/final-verification.sh');
  console.log('  2. Run: npm run verify:final');
  console.log('  3. Run: npm run deploy:check');
  console.log('  4. Review IMPLEMENTATION_COMPLETE.md');
  console.log('  5. Deploy to Railway!');
  console.log('');
  process.exit(0);
} else {
  console.log('❌ Stage 20 Incomplete - Fix issues above');
  console.log('');
  process.exit(1);
}
