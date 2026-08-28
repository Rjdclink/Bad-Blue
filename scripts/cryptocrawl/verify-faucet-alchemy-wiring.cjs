const assert = require('node:assert/strict');
const fs = require('node:fs');

const graph = fs.readFileSync('server/services/cryptocrawl/discovery/opportunity-graph.ts', 'utf8');
const runtime = fs.readFileSync('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts', 'utf8');
const faucet = fs.readFileSync('server/services/cryptocrawl/faucet/autonomous-faucet.ts', 'utf8');

assert.match(
  graph,
  /import\s*\{\s*alchemyIntegration\s*\}\s*from ['"]\.\.\/capital-free\/alchemy-integration\.js['"];/,
  'MeasuredOpportunityGraph must import the authoritative Alchemy singleton',
);
assert.match(graph, /alchemyIntegration/, 'Canonical opportunity graph must bind Alchemy evidence into assessment context');
assert.match(graph, /marketDataProviders\.discoverUniverse\(\)/, 'Canonical opportunity graph must own market-universe discovery');
assert.match(graph, /arbitrageVerifier\.evaluateOnce\(/, 'Canonical opportunity graph must own deterministic live quote verification');
assert.match(graph, /getCryptara\(\)/, 'Canonical opportunity graph must route positive candidates through Cryptara');
assert.match(runtime, /measuredOpportunityGraph\.start\(\)/, 'Canonical runtime must start measured opportunity discovery');
assert.doesNotMatch(graph, /new\s+AlchemyIntegration\s*\(/, 'Canonical graph must not create a duplicate Alchemy integration');
assert.doesNotMatch(faucet, /alchemyIntegration/, 'Retired faucet facade must not own Alchemy market intelligence');

console.log('Canonical opportunity-graph Alchemy wiring verification passed');
