const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const railway = fs.readFileSync(path.join(root, 'railway.toml'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server', 'index.ts'), 'utf8');
const failures = [];

function requireText(source, needle, label) {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
}

requireText(railway, 'healthcheckPath = "/api/ready"', 'Railway activation must use strict readiness endpoint');
requireText(server, 'app.get("/api/ready"', 'strict readiness route exists');
requireText(server, 'if (isFullyInitialized && !isShuttingDown && !startupError)', 'strict readiness requires full initialization and healthy lifecycle');
requireText(server, 'res.status(200).json({ ready: true, fullyInitialized: true })', 'strict readiness returns 200 only for fully initialized runtime');
requireText(server, 'res.status(503).json({', 'strict readiness fails closed before full initialization');
requireText(server, 'databaseInitialized = true;', 'database initialization is recorded before full application readiness');
requireText(server, 'isFullyInitialized = true;', 'application initialization publishes a terminal ready state');

const readyRouteIndex = server.indexOf('app.get("/api/ready"');
const readyGuardIndex = server.indexOf('if (isFullyInitialized && !isShuttingDown && !startupError)', readyRouteIndex);
const ready200Index = server.indexOf('res.status(200).json({ ready: true, fullyInitialized: true })', readyRouteIndex);
if (readyRouteIndex < 0 || readyGuardIndex < readyRouteIndex || ready200Index < readyGuardIndex) {
  failures.push('strict /api/ready route ordering is not intact');
}

if (failures.length) {
  console.error('[verify-railway-readiness-contract] FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[verify-railway-readiness-contract] PASS');
console.log(' - Railway activation waits for the existing strict /api/ready contract');
console.log(' - socket liveness alone cannot make a deployment active');
