#!/usr/bin/env node
/**
 * Crypto Crawler Faucet Status Checker
 * 
 * Checks:
 * 1. If faucet is running
 * 2. If pointing to correct destination
 * 3. If stalled, duplicated, or silently failing
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}`;

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkServerHealth() {
  return new Promise((resolve) => {
    http.get(`${BASE_URL}/api/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const health = JSON.parse(data);
          resolve({ success: true, health });
        } catch (e) {
          resolve({ success: false, error: 'Invalid JSON response' });
        }
      });
    }).on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

function checkFaucetStatus() {
  return new Promise((resolve) => {
    // Try without auth first
    const req = http.request(`${BASE_URL}/api/crypto/faucet/status`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const status = JSON.parse(data);
          resolve({ success: true, status, statusCode: res.statusCode });
        } catch (e) {
          resolve({ success: false, error: 'Invalid JSON response', statusCode: res.statusCode });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    
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
          const health = JSON.parse(data);
          resolve({ success: true, health, statusCode: res.statusCode });
        } catch (e) {
          resolve({ success: false, error: 'Invalid JSON response', statusCode: res.statusCode });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    
    req.end();
  });
}

function checkForDuplicates() {
  const faucetFiles = [
    './server/services/cryptocrawl/faucet/autonomous-faucet.ts',
    './server/faucetGateway.ts',
    './server/services/cryptocrawl/api/dashboard-api.ts',
  ];
  
  const results = [];
  
  for (const file of faucetFiles) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      
      // Check for singleton pattern
      const singletonPattern = /const\s+autonomousFaucet\s*=\s*new\s+AutonomousCryptoFaucet\(\)/g;
      const matches = content.match(singletonPattern);
      
      // Check for multiple instances
      const instancePattern = /new\s+AutonomousCryptoFaucet\(/g;
      const instanceMatches = content.match(instancePattern);
      
      results.push({
        file,
        exists: true,
        singletonCount: matches ? matches.length : 0,
        instanceCount: instanceMatches ? instanceMatches.length : 0,
      });
    } else {
      results.push({ file, exists: false });
    }
  }
  
  return results;
}

function checkFaucetConfiguration() {
  const configFile = './server/services/cryptocrawl/faucet/autonomous-faucet.ts';
  
  if (!fs.existsSync(configFile)) {
    return { error: 'Faucet file not found' };
  }
  
  const content = fs.readFileSync(configFile, 'utf8');
  
  // Extract configuration
  const dailyTargetMatch = content.match(/dailyTarget:\s*(\d+)/);
  const tradingWindowsMatch = content.match(/tradingWindows:\s*(\d+)/);
  const supportedExchangesMatch = content.match(/supportedExchanges:\s*\[(.*?)\]/s);
  
  // Check for destination/exchange configuration
  const exchangeConfig = supportedExchangesMatch 
    ? supportedExchangesMatch[1].split(',').map(e => e.trim().replace(/['"]/g, ''))
    : [];
  
  return {
    dailyTarget: dailyTargetMatch ? parseInt(dailyTargetMatch[1]) : null,
    tradingWindows: tradingWindowsMatch ? parseInt(tradingWindowsMatch[1]) : null,
    supportedExchanges: exchangeConfig,
  };
}

async function main() {
  log('\n=== Crypto Crawler Faucet Status Check ===\n', 'cyan');
  
  // 1. Check server health
  log('1. Checking server health...', 'blue');
  const healthCheck = await checkServerHealth();
  if (!healthCheck.success) {
    log(`   ❌ Server is not running: ${healthCheck.error}`, 'red');
    log('\n   ⚠️  Cannot check faucet status - server must be running', 'yellow');
    log('   To start server: npm start or npm run dev\n', 'yellow');
    return;
  }
  log(`   ✅ Server is running (status: ${healthCheck.health?.status || 'unknown'})`, 'green');
  
  // 2. Check faucet status
  log('\n2. Checking faucet status...', 'blue');
  const statusCheck = await checkFaucetStatus();
  if (!statusCheck.success) {
    if (statusCheck.statusCode === 401) {
      log('   ⚠️  Authentication required - faucet endpoint exists but needs auth', 'yellow');
    } else {
      log(`   ❌ Failed to get faucet status: ${statusCheck.error}`, 'red');
    }
  } else {
    const status = statusCheck.status;
    log(`   ✅ Faucet Status API responding`, 'green');
    log(`   - Enabled: ${status.enabled ? '✅ YES' : '❌ NO'}`, status.enabled ? 'green' : 'red');
    log(`   - Mode: ${status.mode || 'unknown'}`, status.mode === 'open' ? 'green' : 'yellow');
    log(`   - Daily Target: $${status.dailyTarget?.toLocaleString() || 'N/A'}`);
    log(`   - Daily Progress: ${status.dailyTargetProgress?.toFixed(1) || 0}%`);
    log(`   - Profit Today: $${status.profitThisDay?.toFixed(2) || 0}`);
    log(`   - Profit This Hour: $${status.profitThisHour?.toFixed(2) || 0}`);
    log(`   - Health Score: ${status.healthScore || 0}%`);
    log(`   - Stealth Level: ${status.stealthLevel || 0}/10`);
  }
  
  // 3. Check faucet health
  log('\n3. Checking faucet health endpoint...', 'blue');
  const healthEndpoint = await checkFaucetHealth();
  if (healthEndpoint.success) {
    log('   ✅ Faucet Health API responding', 'green');
    const health = healthEndpoint.health;
    log(`   - Overall: ${health.overall || 'unknown'}`);
    log(`   - Faucet Enabled: ${health.faucetEnabled ? '✅ YES' : '❌ NO'}`);
    log(`   - Circuit Breaker: ${health.circuitBreaker?.isOpen ? '🔴 OPEN' : '🟢 CLOSED'}`);
    if (health.components && health.components.length > 0) {
      log('   - Components:');
      health.components.forEach(comp => {
        const statusIcon = comp.status === 'healthy' ? '✅' : comp.status === 'degraded' ? '⚠️' : '❌';
        log(`     ${statusIcon} ${comp.component}: ${comp.status} (${comp.latency}ms)`);
      });
    }
  } else {
    log(`   ⚠️  Health endpoint not accessible: ${healthEndpoint.error}`, 'yellow');
  }
  
  // 4. Check for duplicates
  log('\n4. Checking for duplicate instances...', 'blue');
  const duplicateCheck = checkForDuplicates();
  let hasDuplicates = false;
  duplicateCheck.forEach(result => {
    if (result.exists) {
      if (result.instanceCount > 1) {
        log(`   ⚠️  ${result.file}: ${result.instanceCount} instances found`, 'yellow');
        hasDuplicates = true;
      } else {
        log(`   ✅ ${path.basename(result.file)}: Single instance (singleton pattern)`, 'green');
      }
    }
  });
  
  if (!hasDuplicates) {
    log('   ✅ No duplicate instances detected', 'green');
  }
  
  // 5. Check configuration
  log('\n5. Checking faucet configuration...', 'blue');
  const config = checkFaucetConfiguration();
  if (config.error) {
    log(`   ❌ ${config.error}`, 'red');
  } else {
    log('   ✅ Configuration found:', 'green');
    log(`   - Daily Target: $${config.dailyTarget?.toLocaleString() || 'N/A'}`);
    log(`   - Trading Windows: ${config.tradingWindows || 'N/A'}`);
    log(`   - Supported Exchanges: ${config.supportedExchanges?.join(', ') || 'N/A'}`);
    
    if (config.supportedExchanges && config.supportedExchanges.length > 0) {
      log('   ✅ Faucet is configured with exchange destinations', 'green');
    } else {
      log('   ⚠️  No exchange destinations configured', 'yellow');
    }
  }
  
  // 6. Check for auto-start code
  log('\n6. Checking auto-start initialization...', 'blue');
  const dashboardApiFile = './server/services/cryptocrawl/api/dashboard-api.ts';
  if (fs.existsSync(dashboardApiFile)) {
    const content = fs.readFileSync(dashboardApiFile, 'utf8');
    const hasAutoStart = content.includes('runAutonomousLoop') && content.includes('setTimeout');
    if (hasAutoStart) {
      log('   ✅ Auto-start code detected in dashboard-api.ts', 'green');
    } else {
      log('   ⚠️  Auto-start code not found', 'yellow');
    }
  }
  
  // Summary
  log('\n=== Summary ===', 'cyan');
  if (!healthCheck.success) {
    log('❌ Server is not running - faucet cannot be active', 'red');
    log('   Action: Start the server with "npm start" or "npm run dev"', 'yellow');
  } else {
    if (statusCheck.success && statusCheck.status?.enabled) {
      log('✅ Faucet appears to be configured and enabled', 'green');
      if (statusCheck.status.mode === 'open') {
        log('✅ Faucet is in OPEN mode', 'green');
      } else {
        log(`⚠️  Faucet is in ${statusCheck.status.mode} mode (not actively trading)`, 'yellow');
      }
    } else {
      log('⚠️  Faucet may not be running or is disabled', 'yellow');
    }
    
    if (!hasDuplicates) {
      log('✅ No duplicate instances detected', 'green');
    } else {
      log('⚠️  Potential duplicate instances found - review code', 'yellow');
    }
    
    if (config.supportedExchanges && config.supportedExchanges.length > 0) {
      log('✅ Faucet has exchange destinations configured', 'green');
    }
  }
  
  log('\n');
}

main().catch(err => {
  log(`\n❌ Error: ${err.message}`, 'red');
  process.exit(1);
});
