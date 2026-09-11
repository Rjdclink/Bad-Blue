const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assertContains = (source, pattern, description) => {
  if (!source.includes(pattern)) throw new Error(`Missing invariant: ${description}`);
};
const assertNotContains = (source, pattern, description) => {
  if (source.includes(pattern)) throw new Error(`Unsafe invariant: ${description}`);
};

const stream = read('server/services/cryptocrawl/capital-free/provider-mesh-pending-stream.ts');
const analysis = read('server/services/cryptocrawl/capital-free/provider-mesh-mempool-analysis.ts');
const wiring = read('server/services/cryptocrawl/runtime/alchemy-filtered-mempool-wiring.ts');
const compatibility = read('server/services/cryptocrawl/capital-free/alchemy-integration.ts');

assertContains(stream, "params: ['drpc_pendingTransactions']", 'free provider mesh receives full pending transactions');
assertContains(stream, 'applicationSideRouterFilter: true', 'route relevance is applied locally without paid provider filtering');
assertContains(stream, 'operatorBillingLiability: false', 'pending evidence transport creates no operator billing liability');
assertContains(analysis, "method: 'txpool_content'", 'mempool pressure uses measured provider-neutral txpool evidence');
assertContains(wiring, 'provider-mesh', 'legacy installer is an inert provider-mesh compatibility shim');
assertContains(compatibility, 'No request in this module is sent to Alchemy', 'legacy facade is transport-retired');
assertNotContains(stream, 'ALCHEMY_API_KEY', 'replacement stream cannot read Alchemy credentials');
assertNotContains(stream, 'alchemy_pendingTransactions', 'replacement stream cannot invoke Alchemy enhanced pending APIs');
assertNotContains(compatibility, 'g.alchemy.com', 'compatibility facade cannot contain Alchemy endpoints');
assertNotContains(compatibility, 'process.env.ALCHEMY_API_KEY', 'compatibility facade cannot reactivate Alchemy from configuration');

console.log('Alchemy-free provider-mesh pending wiring verification passed.');
