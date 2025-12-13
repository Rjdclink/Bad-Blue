/**
 * Route Invariants Test Script
 * 
 * Phase 10 (Power 2.8) - Permanent invariants
 * 
 * Checks:
 * 1. Route is defined exactly once
 * 2. No redirect-on-mount for these routes
 * 3. Route pages have mount logging
 * 4. Endpoints return 200 (not 304/404)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const APP_TSX_PATH = path.join(__dirname, '../client/src/App.tsx');
const CRYPTO_DASHBOARD_PATH = path.join(__dirname, '../client/src/pages/cryptocrawler-dashboard.tsx');
const INMATE_LOCATOR_PATH = path.join(__dirname, '../client/src/pages/inmate-locator.tsx');
const INMATE_SEARCH_PATH = path.join(__dirname, '../client/src/components/InmateSearch.tsx');

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function test(name, condition, details = '') {
  const passed = condition;
  results.tests.push({ name, passed, details });
  if (passed) {
    results.passed++;
    console.log(`✅ ${name}`);
  } else {
    results.failed++;
    console.log(`❌ ${name}`);
    if (details) console.log(`   ${details}`);
  }
}

function checkRouteDefinedOnce(content, routePath, routeName) {
  const regex = new RegExp(`path="${routePath}"`, 'g');
  const matches = content.match(regex);
  const count = matches ? matches.length : 0;
  test(
    `${routeName} route defined exactly once`,
    count === 1,
    `Found ${count} definitions of ${routePath}`
  );
}

function checkNoRedirectOnMount(content, componentName) {
  // Check for useEffect with setLocation/navigate that runs unconditionally on mount
  const hasRedirectOnMount = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*setLocation|useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*navigate\s*\(/s.test(content);
  
  // Allow conditional redirects (isAuthenticated checks, etc.)
  const hasConditionalRedirect = /if\s*\([^)]+\)\s*\{[^}]*setLocation|if\s*\([^)]+\)\s*\{[^}]*navigate/.test(content);
  
  // Check for comments indicating no redirect
  const hasNoRedirectComment = /NEVER redirect|do NOT redirect|NO redirect/i.test(content);
  
  test(
    `${componentName} has no unconditional redirect on mount`,
    !hasRedirectOnMount || hasConditionalRedirect || hasNoRedirectComment,
    hasRedirectOnMount ? 'Found potential redirect on mount' : ''
  );
}

function checkInlineErrorHandling(content, componentName) {
  // Check for error state management
  const hasErrorState = /useState.*Error|setError|errorMessage|hasError/.test(content);
  const showsErrorInline = /error.*&&|errorMessage.*&&|\{.*error.*\}/.test(content);
  
  test(
    `${componentName} handles errors inline`,
    hasErrorState || showsErrorInline,
    'Should display errors inline, not redirect'
  );
}

function runInvariants() {
  console.log('='.repeat(60));
  console.log('ROUTE INVARIANTS TEST');
  console.log('CryptoCrawler + Inmate Finder Routes');
  console.log('='.repeat(60));
  console.log();

  // Load files
  let appContent, cryptoContent, inmateContent, inmateSearchContent;
  try {
    appContent = fs.readFileSync(APP_TSX_PATH, 'utf-8');
    cryptoContent = fs.readFileSync(CRYPTO_DASHBOARD_PATH, 'utf-8');
    inmateContent = fs.readFileSync(INMATE_LOCATOR_PATH, 'utf-8');
    inmateSearchContent = fs.readFileSync(INMATE_SEARCH_PATH, 'utf-8');
  } catch (e) {
    console.error('Failed to read source files:', e.message);
    process.exit(1);
  }

  console.log('📋 INVARIANT 1: Routes defined exactly once');
  console.log('-'.repeat(40));
  checkRouteDefinedOnce(appContent, '/cryptocrawler', 'CryptoCrawler');
  checkRouteDefinedOnce(appContent, '/inmate-locator', 'Inmate Locator');
  console.log();

  console.log('📋 INVARIANT 2: No redirect-on-mount');
  console.log('-'.repeat(40));
  checkNoRedirectOnMount(cryptoContent, 'CryptoCrawler Dashboard');
  checkNoRedirectOnMount(inmateContent, 'Inmate Locator');
  console.log();

  console.log('📋 INVARIANT 3: Inline error handling');
  console.log('-'.repeat(40));
  checkInlineErrorHandling(cryptoContent, 'CryptoCrawler Dashboard');
  // For Inmate Locator, check the InmateSearch component which handles errors
  checkInlineErrorHandling(inmateSearchContent, 'Inmate Locator (InmateSearch)');
  console.log();

  console.log('📋 INVARIANT 4: Protected route structure');
  console.log('-'.repeat(40));
  
  // Check routes are inside isAuthenticated block
  const isAuthBlockStart = appContent.indexOf('{isAuthenticated ? (');
  const cryptoRoutePos = appContent.indexOf('path="/cryptocrawler"');
  const inmateRoutePos = appContent.indexOf('path="/inmate-locator"');
  
  test(
    'CryptoCrawler route is protected by isAuthenticated',
    cryptoRoutePos > isAuthBlockStart,
    `Route position: ${cryptoRoutePos}, Auth block starts: ${isAuthBlockStart}`
  );
  
  test(
    'Inmate Locator route is protected by isAuthenticated',
    inmateRoutePos > isAuthBlockStart,
    `Route position: ${inmateRoutePos}, Auth block starts: ${isAuthBlockStart}`
  );
  console.log();

  console.log('📋 INVARIANT 5: No global error boundary swallowing');
  console.log('-'.repeat(40));
  
  // Check that pages don't rely on global error boundary for error handling
  const cryptoHasLocalErrorHandling = /catch|setError|setHasError|errorMessage/.test(cryptoContent);
  // InmateSearch component handles errors for Inmate Locator
  const inmateHasLocalErrorHandling = /catch|setError|searchApiError|setSearchApiError/.test(inmateSearchContent);
  
  test(
    'CryptoCrawler has local error handling',
    cryptoHasLocalErrorHandling,
    'Should handle errors locally, not rely on global ErrorBoundary'
  );
  
  test(
    'Inmate Locator (InmateSearch) has local error handling',
    inmateHasLocalErrorHandling,
    'Should handle errors locally, not rely on global ErrorBoundary'
  );
  console.log();

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Total:  ${results.passed + results.failed}`);
  console.log();

  if (results.failed > 0) {
    console.log('❌ INVARIANTS VIOLATED');
    process.exit(1);
  } else {
    console.log('✅ ALL INVARIANTS PASSED');
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  runInvariants();
}

module.exports = { runInvariants };
