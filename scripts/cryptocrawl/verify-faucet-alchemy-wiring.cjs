const assert = require('node:assert/strict');
const fs = require('node:fs');

const graph = fs.readFileSync('server/services/cryptocrawl/discovery/opportunity-graph.ts', 'utf8');
const runtime = fs.readFileSync('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts', 'utf8');
const faucet = fs.readFileSync('server/services/cryptocrawl/faucet/autonomous-faucet.ts', 'utf8');
const compatibility = fs.readFileSync('server/services/cryptocrawl/capital-free/alchemy-integration.ts', 'utf8');
const pending = fs.readFileSync('server/services/cryptocrawl/capital-free/provider-mesh-pending-stream.ts', 'utf8');
const pressure = fs.readFileSync('server/services/cryptocrawl/capital-free/provider-mesh-mempool-analysis.ts', 'utf8');

assert.match(graph, /marketDataProviders\.discoverUniverse\(\)/, 'Canonical opportunity graph must own market-universe discovery');
assert.match(graph, /arbitrageVerifier\.evaluateOnce\(/, 'Canonical opportunity graph must own deterministic live quote verification');
assert.match(graph, /getCryptara\(\)/, 'Canonical opportunity graph must route positive candidates through Cryptara');
assert.match(runtime, /ensureProviderMeshPendingStream\(\)/, 'Canonical runtime must install the provider-mesh pending evidence path');
assert.match(runtime, /alchemyGasSponsorshipAuthority:\s*false/, 'Canonical runtime must deny Alchemy gas-sponsorship authority');
assert.match(pending, /params:\s*\['drpc_pendingTransactions'\]/, 'Provider mesh must carry full pending observations without Alchemy');
assert.match(pressure, /method:\s*'txpool_content'/, 'Provider mesh must retain measured mempool pressure evidence');
assert.match(pressure, /mempool_pressure:measured_not_inferred/, 'Mempool pressure cannot be inferred from a filtered subset');

// Old imports may remain temporarily as compatibility symbols, but the imported
// implementation itself must be transport-retired and must never read credentials
// or call an Alchemy endpoint. This lets hidden callers migrate without restoring
// paid-provider authority.
assert.match(compatibility, /No request in this module is sent to Alchemy/, 'Legacy compatibility boundary must be explicitly transport-retired');
assert.match(compatibility, /alchemyNetworkRequestsAllowed:\s*false/, 'Legacy compatibility boundary must deny Alchemy network requests');
assert.doesNotMatch(compatibility, /process\.env\.ALCHEMY_API_KEY/, 'Compatibility boundary must not read an Alchemy key');
assert.doesNotMatch(compatibility, /g\.alchemy\.com/, 'Compatibility boundary must not contain Alchemy endpoints');
assert.doesNotMatch(compatibility, /alchemy_pendingTransactions/, 'Compatibility boundary must not invoke Alchemy enhanced APIs');
assert.doesNotMatch(faucet, /alchemyIntegration/, 'Retired faucet facade must not own provider-specific market intelligence');

console.log('Canonical opportunity-graph provider-mesh replacement verification passed');
