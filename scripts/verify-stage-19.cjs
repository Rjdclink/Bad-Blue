#!/usr/bin/env node

/**
 * Stage 19 Verification Script
 * Verifies production readiness files and configuration
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Stage 19 Verification\n');

let allPassed = true;

// Check PRODUCTION_CHECKLIST.md
console.log('📋 Checking PRODUCTION_CHECKLIST.md...');
if (!fs.existsSync('PRODUCTION_CHECKLIST.md')) {
  console.error('❌ PRODUCTION_CHECKLIST.md not found');
  allPassed = false;
} else {
  const content = fs.readFileSync('PRODUCTION_CHECKLIST.md', 'utf8');
  const requiredSections = [
    'Node.js Version',
    'Database',
    'Email Service (Resend)',
    'AI Providers',
    'OpenRouter',
    'Gemini',
    'Groq',
    'Mistral',
    'Anthropic',
    'Pre-Deployment Checks',
  ];
  
  let missingSection = false;
  for (const section of requiredSections) {
    if (!content.includes(section)) {
      console.error(`❌ Missing section: ${section}`);
      missingSection = true;
      allPassed = false;
    }
  }
  
  if (!missingSection) {
    console.log('✅ PRODUCTION_CHECKLIST.md complete with all sections');
  }
}

// Check .nvmrc
console.log('\n📄 Checking .nvmrc...');
if (!fs.existsSync('.nvmrc')) {
  console.error('❌ .nvmrc not found');
  allPassed = false;
} else {
  const nvmrc = fs.readFileSync('.nvmrc', 'utf8').trim();
  if (nvmrc === '20') {
    console.log('✅ .nvmrc correctly set to Node 20');
  } else {
    console.error(`❌ .nvmrc should be "20", found "${nvmrc}"`);
    allPassed = false;
  }
}

// Check package.json engines
console.log('\n📦 Checking package.json engines...');
if (!fs.existsSync('package.json')) {
  console.error('❌ package.json not found');
  allPassed = false;
} else {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  if (!packageJson.engines) {
    console.error('❌ package.json missing engines field');
    allPassed = false;
  } else if (packageJson.engines.node !== '20.x') {
    console.error(`❌ package.json engines.node should be "20.x", found "${packageJson.engines.node}"`);
    allPassed = false;
  } else {
    console.log('✅ package.json engines.node set to 20.x');
  }
  
  if (packageJson.engines && packageJson.engines.npm) {
    console.log('✅ package.json engines.npm specified');
  }
}

// Check Railway deployment config (railway.toml preferred, railway.json legacy)
console.log('\n🚂 Checking Railway deployment config...');
if (fs.existsSync('railway.toml')) {
  const railwayToml = fs.readFileSync('railway.toml', 'utf8');
  
  if (!railwayToml.includes('[build]')) {
    console.error('❌ railway.toml missing [build] section');
    allPassed = false;
  } else {
    console.log('✅ railway.toml build section configured');
  }

  if (!railwayToml.includes('dockerfilePath')) {
    console.error('❌ railway.toml missing dockerfilePath');
    allPassed = false;
  } else {
    console.log('✅ railway.toml Dockerfile path configured');
  }

  if (!railwayToml.includes('[deploy]') || !railwayToml.includes('startCommand')) {
    console.error('❌ railway.toml missing deploy start command');
    allPassed = false;
  } else {
    console.log('✅ railway.toml deploy start command configured');
  }
} else if (fs.existsSync('railway.json')) {
  const railwayJson = JSON.parse(fs.readFileSync('railway.json', 'utf8'));
  
  if (!railwayJson.runtime || !railwayJson.runtime.nodeVersion) {
    console.error('❌ railway.json missing runtime.nodeVersion');
    allPassed = false;
  } else if (railwayJson.runtime.nodeVersion !== '20') {
    console.error(`❌ railway.json nodeVersion should be "20", found "${railwayJson.runtime.nodeVersion}"`);
    allPassed = false;
  } else {
    console.log('✅ railway.json runtime.nodeVersion set to 20');
  }
  
  if (railwayJson.build && railwayJson.build.buildCommand) {
    console.log('✅ railway.json build command configured');
  }
  
  if (railwayJson.deploy && railwayJson.deploy.startCommand) {
    console.log('✅ railway.json start command configured');
  }
} else {
  console.error('❌ Missing Railway config: railway.toml or railway.json');
  allPassed = false;
}

// Check deployment preparation script
console.log('\n🔧 Checking scripts/prepare-deployment.sh...');
if (!fs.existsSync('scripts/prepare-deployment.sh')) {
  console.error('❌ scripts/prepare-deployment.sh not found');
  allPassed = false;
} else {
  const scriptContent = fs.readFileSync('scripts/prepare-deployment.sh', 'utf8');
  
  if (!scriptContent.includes('REQUIRED_MAJOR=20')) {
    console.error('❌ prepare-deployment.sh missing Node 20 version check');
    allPassed = false;
  } else {
    console.log('✅ prepare-deployment.sh configured for Node 20');
  }
  
  // Check if executable
  const stats = fs.statSync('scripts/prepare-deployment.sh');
  const isExecutable = (stats.mode & parseInt('0100', 8)) !== 0;
  if (isExecutable) {
    console.log('✅ prepare-deployment.sh is executable');
  } else {
    console.warn('⚠️  prepare-deployment.sh is not executable (chmod +x may be needed)');
  }
}

// Final summary
console.log('\n' + '='.repeat(50));
if (allPassed) {
  console.log('✅ Stage 19 complete - All production readiness files verified');
  console.log('✅ Ready for Railway deployment with Node 20');
  console.log('\nNext steps:');
  console.log('1. Review PRODUCTION_CHECKLIST.md');
  console.log('2. Run: bash scripts/prepare-deployment.sh');
  console.log('3. Configure environment variables in Railway');
  console.log('4. Deploy to Railway');
  process.exit(0);
} else {
  console.log('❌ Stage 19 verification failed');
  console.log('   Fix the issues above before proceeding');
  process.exit(1);
}
