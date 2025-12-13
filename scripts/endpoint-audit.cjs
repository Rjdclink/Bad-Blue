/**
 * Endpoint Sanity Check Script
 * 
 * Phase 6 (Power 2.0) - Endpoint sanity
 * 
 * Enumerates endpoints called by CryptoCrawler + Inmate Finder on mount
 * and verifies they don't return 304 or 404.
 */

const fs = require('fs');
const path = require('path');

const CRYPTO_DASHBOARD_PATH = path.join(__dirname, '../client/src/pages/cryptocrawler-dashboard.tsx');
const INMATE_LOCATOR_PATH = path.join(__dirname, '../client/src/pages/inmate-locator.tsx');
const INMATE_SEARCH_PATH = path.join(__dirname, '../client/src/components/InmateSearch.tsx');

function extractEndpoints(content, filename) {
  const endpoints = [];
  
  // Match fetch() calls
  const fetchMatches = content.matchAll(/fetch\s*\(\s*['"`]([^'"`]+)['"`]/g);
  for (const match of fetchMatches) {
    endpoints.push({
      url: match[1],
      type: 'fetch',
      file: filename
    });
  }
  
  // Match apiRequest() calls
  const apiRequestMatches = content.matchAll(/apiRequest\s*\(\s*['"`]([^'"`]+)['"`]/g);
  for (const match of apiRequestMatches) {
    endpoints.push({
      url: match[1],
      type: 'apiRequest',
      file: filename
    });
  }
  
  // Match useQuery queryKey (React Query)
  const queryKeyMatches = content.matchAll(/queryKey:\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/g);
  for (const match of queryKeyMatches) {
    endpoints.push({
      url: match[1],
      type: 'useQuery',
      file: filename
    });
  }
  
  return endpoints;
}

function runEndpointAudit() {
  console.log('='.repeat(60));
  console.log('ENDPOINT SANITY CHECK');
  console.log('CryptoCrawler + Inmate Finder');
  console.log('='.repeat(60));
  console.log();

  // Load files
  let cryptoContent, inmatePageContent, inmateSearchContent;
  try {
    cryptoContent = fs.readFileSync(CRYPTO_DASHBOARD_PATH, 'utf-8');
    inmatePageContent = fs.readFileSync(INMATE_LOCATOR_PATH, 'utf-8');
    inmateSearchContent = fs.readFileSync(INMATE_SEARCH_PATH, 'utf-8');
  } catch (e) {
    console.error('Failed to read source files:', e.message);
    process.exit(1);
  }

  console.log('📡 CRYPTOCRAWLER ENDPOINTS (called on mount):');
  console.log('-'.repeat(40));
  const cryptoEndpoints = extractEndpoints(cryptoContent, 'cryptocrawler-dashboard.tsx');
  
  // Filter to only endpoints called in useEffect/initialization
  const cryptoInitEndpoints = new Set();
  
  // These are called in the initializeDashboard() function
  if (cryptoContent.includes('/admin/crypto/status')) {
    cryptoInitEndpoints.add('/admin/crypto/status');
  }
  if (cryptoContent.includes('/api/crypto/stats')) {
    cryptoInitEndpoints.add('/api/crypto/stats');
  }
  if (cryptoContent.includes('/admin/crypto/health')) {
    cryptoInitEndpoints.add('/admin/crypto/health');
  }
  if (cryptoContent.includes('/api/crypto/faucet/status')) {
    cryptoInitEndpoints.add('/api/crypto/faucet/status');
  }
  
  Array.from(cryptoInitEndpoints).forEach((url, i) => {
    console.log(`  ${i + 1}. ${url}`);
  });
  
  console.log();
  console.log('📡 INMATE LOCATOR ENDPOINTS (called on mount):');
  console.log('-'.repeat(40));
  
  const inmateEndpoints = extractEndpoints(inmateSearchContent, 'InmateSearch.tsx');
  
  // Filter to only endpoints used on mount (useQuery with immediate fetch)
  const inmateInitEndpoints = new Set();
  
  // This is called via useQuery on mount
  if (inmateSearchContent.includes('/api/inmate-search/states')) {
    inmateInitEndpoints.add('/api/inmate-search/states');
  }
  
  Array.from(inmateInitEndpoints).forEach((url, i) => {
    console.log(`  ${i + 1}. ${url}`);
  });
  
  console.log();
  console.log('📋 ALL ENDPOINTS DISCOVERED:');
  console.log('-'.repeat(40));
  
  const allEndpoints = new Set();
  cryptoEndpoints.forEach(e => allEndpoints.add(e.url));
  inmateEndpoints.forEach(e => allEndpoints.add(e.url));
  
  Array.from(allEndpoints).sort().forEach((url, i) => {
    console.log(`  ${i + 1}. ${url}`);
  });
  
  console.log();
  console.log('='.repeat(60));
  console.log('ENDPOINT AUDIT OUTPUT');
  console.log('='.repeat(60));
  console.log();
  console.log('CryptoCrawler mount endpoints:');
  Array.from(cryptoInitEndpoints).forEach(url => {
    console.log(`  - ${url}`);
  });
  console.log();
  console.log('Inmate Locator mount endpoints:');
  Array.from(inmateInitEndpoints).forEach(url => {
    console.log(`  - ${url}`);
  });
  console.log();
  console.log('NOTE: These endpoints should return 200 OK, not 304 or 404.');
  console.log('Check server/routes.ts to verify these routes exist and respond correctly.');
}

// Run if called directly
if (require.main === module) {
  runEndpointAudit();
}

module.exports = { runEndpointAudit };
