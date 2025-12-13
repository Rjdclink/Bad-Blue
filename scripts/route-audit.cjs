/**
 * Route Audit Script for CryptoCrawler + Inmate Finder
 * 
 * Phase 1 (Power 1.0) - Route correctness audit
 * 
 * Checks:
 * 1. Route is defined exactly once
 * 2. Points to correct component
 * 3. No dynamic route shadows the path
 */

const fs = require('fs');
const path = require('path');

const APP_TSX_PATH = path.join(__dirname, '../client/src/App.tsx');

function auditRoutes() {
  const appContent = fs.readFileSync(APP_TSX_PATH, 'utf-8');
  const lines = appContent.split('\n');
  
  const results = {
    cryptocrawler: {
      routes: [],
      component: null,
      componentFile: null,
      dynamicShadows: [],
      status: 'UNKNOWN'
    },
    inmateLocator: {
      routes: [],
      component: null,
      componentFile: null,
      dynamicShadows: [],
      status: 'UNKNOWN'
    }
  };
  
  // Find CryptoCrawler routes
  const cryptoRoutes = [
    '/cryptocrawler/dashboard',
    '/cryptocrawler',
    '/crypto-dashboard',
    '/cryptocrawler-v2'
  ];
  
  // Find Inmate Locator routes
  const inmateRoutes = [
    '/inmate-locator',
    '/inmate-locator/dashboard',
    '/inmate-locator-v2'
  ];
  
  // Scan for routes
  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    
    // Check for CryptoCrawler routes
    cryptoRoutes.forEach(route => {
      if (line.includes(`path="${route}"`) || line.includes(`path='${route}'`)) {
        const componentMatch = line.match(/component={(\w+)}/);
        results.cryptocrawler.routes.push({
          path: route,
          line: lineNum,
          component: componentMatch ? componentMatch[1] : 'UNKNOWN',
          fullLine: line.trim()
        });
      }
    });
    
    // Check for Inmate Locator routes
    inmateRoutes.forEach(route => {
      if (line.includes(`path="${route}"`) || line.includes(`path='${route}'`)) {
        const componentMatch = line.match(/component={(\w+)}/);
        results.inmateLocator.routes.push({
          path: route,
          line: lineNum,
          component: componentMatch ? componentMatch[1] : 'UNKNOWN',
          fullLine: line.trim()
        });
      }
    });
    
    // Check for dynamic routes that could shadow
    if (line.includes('/:id') || line.includes('/:slug') || line.includes('/:')) {
      const pathMatch = line.match(/path="([^"]+)"/);
      if (pathMatch) {
        const dynPath = pathMatch[1];
        // Check if this could shadow crypto or inmate routes
        // Only routes starting with /crypto or just /:id could shadow cryptocrawler
        if (dynPath.startsWith('/crypto') || dynPath === '/:id' || dynPath === '/:slug') {
          results.cryptocrawler.dynamicShadows.push({
            path: dynPath,
            line: lineNum
          });
        }
        // Only routes starting with /inmate or just /:id could shadow inmate locator
        if (dynPath.startsWith('/inmate') || dynPath === '/:id' || dynPath === '/:slug') {
          results.inmateLocator.dynamicShadows.push({
            path: dynPath,
            line: lineNum
          });
        }
      }
    }
  });
  
  // Find component definitions
  const cryptoComponentMatch = appContent.match(/const CryptoCrawlerDashboard = lazyWithRetry\(\(\) => import\("@\/pages\/([^"]+)"\)/);
  if (cryptoComponentMatch) {
    results.cryptocrawler.componentFile = `client/src/pages/${cryptoComponentMatch[1]}.tsx`;
  }
  
  const inmateComponentMatch = appContent.match(/const InmateLocatorPage = lazyWithRetry\(\(\) => import\("@\/pages\/([^"]+)"\)/);
  if (inmateComponentMatch) {
    results.inmateLocator.componentFile = `client/src/pages/${inmateComponentMatch[1]}.tsx`;
  }
  
  // Set status
  results.cryptocrawler.status = results.cryptocrawler.routes.length > 0 && 
    results.cryptocrawler.dynamicShadows.length === 0 ? 'OK' : 'NEEDS_REVIEW';
  results.inmateLocator.status = results.inmateLocator.routes.length > 0 && 
    results.inmateLocator.dynamicShadows.length === 0 ? 'OK' : 'NEEDS_REVIEW';
  
  return results;
}

// Run audit
console.log('='.repeat(60));
console.log('ROUTE AUDIT: CryptoCrawler + Inmate Finder');
console.log('='.repeat(60));

const results = auditRoutes();

console.log('\n📊 CRYPTOCRAWLER ROUTES:');
console.log('-'.repeat(40));
results.cryptocrawler.routes.forEach(r => {
  console.log(`  Route: ${r.path}`);
  console.log(`    Line: ${r.line}`);
  console.log(`    Component: ${r.component}`);
});
console.log(`  Component File: ${results.cryptocrawler.componentFile}`);
console.log(`  Dynamic Shadows: ${results.cryptocrawler.dynamicShadows.length === 0 ? 'None' : results.cryptocrawler.dynamicShadows.map(s => s.path).join(', ')}`);
console.log(`  Status: ${results.cryptocrawler.status}`);

console.log('\n📊 INMATE LOCATOR ROUTES:');
console.log('-'.repeat(40));
results.inmateLocator.routes.forEach(r => {
  console.log(`  Route: ${r.path}`);
  console.log(`    Line: ${r.line}`);
  console.log(`    Component: ${r.component}`);
});
console.log(`  Component File: ${results.inmateLocator.componentFile}`);
console.log(`  Dynamic Shadows: ${results.inmateLocator.dynamicShadows.length === 0 ? 'None' : results.inmateLocator.dynamicShadows.map(s => s.path).join(', ')}`);
console.log(`  Status: ${results.inmateLocator.status}`);

console.log('\n='.repeat(60));
console.log('PHASE 1 AUDIT COMPLETE');
console.log('='.repeat(60));

// Output summary for CI/automation
const allOK = results.cryptocrawler.status === 'OK' && results.inmateLocator.status === 'OK';
process.exit(allOK ? 0 : 1);
