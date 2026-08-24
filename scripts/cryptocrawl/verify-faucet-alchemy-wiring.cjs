const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server/services/cryptocrawl/faucet/autonomous-faucet.ts', 'utf8');

assert.match(
  source,
  /import\s*\{\s*alchemyIntegration\s*\}\s*from ['"]\.\.\/capital-free\/alchemy-integration\.js['"];/,
  'AutonomousFaucet must import the authoritative Alchemy singleton',
);
assert.match(source, /alchemyIntegration\.getMempoolAnalysis\(\)/, 'Faucet must consume Alchemy mempool observations');
assert.match(source, /alchemyIntegration\.isReady\(\)/, 'Faucet must record Alchemy readiness provenance');
assert.match(source, /await\s+cryptara\.assessOpportunity\(/, 'Faucet must route the selected opportunity through Cryptara assessment');
assert.doesNotMatch(source, /new\s+AlchemyIntegration\s*\(/, 'Faucet must not create a duplicate Alchemy integration');

console.log('AutonomousFaucet Alchemy wiring verification passed');
