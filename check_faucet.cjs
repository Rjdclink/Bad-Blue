#!/usr/bin/env node
/**
 * Crypto Crawler Faucet Status Checker
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}`;

function log(message, color = '') {
  const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m',
  };
  console.log(`${colors[color] || ''}${message}${colors.reset}`);
}

function checkServerHealth() {
  return new Promise((resolve) => {
    http.get(`${BASE_URL}/api/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ success: true, health: JSON.parse(data) });
        } catch (e) {
          resolve({ success: false, error: 'Invalid JSON' });
        }
      });
    }).on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

function checkFaucetStatus() {
  return new Promise((resolve) => {
    const req = http.request(`${BASE_URL}/api/crypto/faucet/status`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ success: true, status: JSON.parse(data), code: res.statusCode });
        } catch (e) {
          resolve({ success: false, error: 'Invalid JSON', code: res.statusCode });
        }
      });
    });
    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.end();
  });
}

function checkFaucetHealth() {
  return new Promise((resolve) => {
    const req = http.request(`${BASE_URL}/api/crypto/faucet/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ success: true, health: JSON.parse(data), code: res.statusCode });
        } catch (e) {
          resolve({ success: false, error: 'Invalid JSON', code: res.statusCode });
        }
      });
    });
    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.end();
  });
}

function checkForDuplicates() {
  const file = './server/services/cryptocrawl/faucet/autonomous-faucet.ts';
  if (!fs.existsSync(file)) return { error: 'File not found' };
  
  const content = fs.readFileSync(file, 'utf8');
  const singletonMatches = content.match(/const\s+autonomousFaucet\s*=\s*new\s+AutonomousCryptoFaucet\(\)/g);
  const instanceMatches = content.match(/new\s+AutonomousCryptoFaucet\(/g);
  
  return {
    singletonCount: singletonMatches ? singletonMatches.length : 0,
    instanceCount: instanceMatches ? instanceMatches.length : 0,
    hasDuplicates: instanceMatches ? instanceMatches.length > 1 : false,
  };
}

function checkConfiguration() {
  const file = './server/services/cryptocrawl/faucet/autonomous-faucet.ts';
  if (!fs.existsSync(file)) return { error: 'File not found' };
  
  const content = fs.readFileSync(file, 'utf8');
  const dailyTargetMatch = content.match(/dailyTarget:\s*(\d+)/);
  const tradingWindowsMatch = content.match(/tradingWindows:\s*(\d+)/);
  const exchangesMatch = content.match(/supportedExchanges:\s*\[(.*?)\]/s);
  
  const exchanges = exchangesMatch 
    ? exchangesMatch[1].split(',').map(e => e.trim().replace(/['"]/g, ''))
    : [];
  
  return {
    dailyTarget: dailyTargetMatch ? parseInt(dailyTargetMatch[1]) : null,
    tradingWindows: tradingWindowsMatch ? parseInt(tradingWindowsMatch[1]) : null,
    exchanges: exchanges,
  };
}

function checkAutoStart() {
  const file = './server/services/cryptocrawl/api/dashboard-api.ts';
  if (!fs.existsSync(file)) return { error: 'File not found' };
  
  const content = fs.readFileSync(file, 'utf8');
  const hasAutoStart = content.includes('runAutonomousLoop') && content.includes('setTimeout');
  const hasAutoStartDelay = content.match(/setTimeout.*?(\d+)/);
  
  return {
    hasAutoStart,
    delay: hasAutoStartDelay ? parseInt(hasAutoStartDelay[1]) : null,
  };
}

async function main() {
  log('\n=== Crypto Crawler Faucet Status Check ===\n', 'cyan');
  
  // 1. Server Health
  log('1. Server Health Check...', 'blue');
  const health = await checkServerHealth();
  if (!health.success) {
    log(`   ❌ Server not running: ${health.error}`, 'red');
    log('   ⚠️  Start server with: npm start', 'yellow');
    return;
  }
  log(`   ✅ Server running (${health.health?.status || 'unknown'})`, 'green');
  
  // 2. Faucet Status
  log('\n2. Faucet Status...', 'blue');
  const status = await checkFaucetStatus();
  if (!status.success) {
    if (status.code === 401) {
      log('   ⚠️  Authentication required', 'yellow');
    } else {
      log(`   ❌ Error: ${status.error}`, 'red');
    }
  } else {
    const s = status.status;
    log(`   ✅ API responding`, 'green');
    log(`   - Enabled: ${s.enabled ? '✅ YES' : '❌ NO'}`, s.enabled ? 'green' : 'red');
    log(`   - Mode: ${s.mode || 'unknown'}`, s.mode === 'open' ? 'green' : 'yellow');
    log(`   - Daily Target: $${(s.dailyTarget || 0).toLocaleString()}`);
    log(`   - Progress: ${(s.dailyTargetProgress || 0).toFixed(1)}%`);
    log(`   - Profit Today: $${(s.profitThisDay || 0).toFixed(2)}`);
    log(`   - Health Score: ${s.healthScore || 0}%`);
  }
  
  // 3. Faucet Health
  log('\n3. Faucet Health Endpoint...', 'blue');
  const healthEndpoint = await checkFaucetHealth();
  if (healthEndpoint.success) {
    const h = healthEndpoint.health;
    log('   ✅ Health API responding', 'green');
    log(`   - Overall: ${h.overall || 'unknown'}`);
    log(`   - Enabled: ${h.faucetEnabled ? '✅' : '❌'}`);
    log(`   - Circuit Breaker: ${h.circuitBreaker?.isOpen ? '🔴 OPEN' : '🟢 CLOSED'}`);
  } else {
    log(`   ⚠️  ${healthEndpoint.error}`, 'yellow');
  }
  
  // 4. Duplicates
  log('\n4. Duplicate Instance Check...', 'blue');
  const dupCheck = checkForDuplicates();
  if (dupCheck.error) {
    log(`   ❌ ${dupCheck.error}`, 'red');
  } else {
    if (dupCheck.hasDuplicates) {
      log(`   ⚠️  Found ${dupCheck.instanceCount} instances`, 'yellow');
    } else {
      log('   ✅ Single instance (singleton)', 'green');
    }
  }
  
  // 5. Configuration
  log('\n5. Configuration Check...', 'blue');
  const config = checkConfiguration();
  if (config.error) {
    log(`   ❌ ${config.error}`, 'red');
  } else {
    log('   ✅ Configuration found:', 'green');
    log(`   - Daily Target: $${(config.dailyTarget || 0).toLocaleString()}`);
    log(`   - Trading Windows: ${config.tradingWindows || 'N/A'}`);
    log(`   - Exchanges: ${config.exchanges.join(', ') || 'N/A'}`);
    if (config.exchanges.length > 0) {
      log('   ✅ Exchange destinations configured', 'green');
    }
  }
  
  // 6. Auto-start
  log('\n6. Auto-start Check...', 'blue');
  const autoStart = checkAutoStart();
  if (autoStart.error) {
    log(`   ⚠️  ${autoStart.error}`, 'yellow');
  } else {
    if (autoStart.hasAutoStart) {
      log(`   ✅ Auto-start enabled (${autoStart.delay ? autoStart.delay + 'ms delay' : 'no delay'})`, 'green');
    } else {
      log('   ⚠️  Auto-start not found', 'yellow');
    }
  }
  
  // Summary
  log('\n=== Summary ===', 'cyan');
  if (!health.success) {
    log('❌ Server not running', 'red');
  } else if (status.success && status.status?.enabled) {
    log('✅ Faucet is enabled', 'green');
    if (status.status.mode === 'open') {
      log('✅ Faucet is OPEN (actively trading)', 'green');
    } else {
      log(`⚠️  Faucet is ${status.status.mode} (not actively trading)`, 'yellow');
    }
  } else {
    log('⚠️  Faucet may not be running', 'yellow');
  }
  
  if (!dupCheck.hasDuplicates) {
    log('✅ No duplicates detected', 'green');
  }
  
  if (config.exchanges && config.exchanges.length > 0) {
    log('✅ Exchange destinations configured', 'green');
  }
  
  log('\n');
}

main().catch(err => {
  log(`\n❌ Error: ${err.message}`, 'red');
  process.exit(1);
});
