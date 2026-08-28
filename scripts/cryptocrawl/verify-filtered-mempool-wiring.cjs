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

const filtered = read('server/services/cryptocrawl/capital-free/alchemy-filtered-mempool.ts');
const wiring = read('server/services/cryptocrawl/runtime/alchemy-filtered-mempool-wiring.ts');
const legacy = read('server/services/cryptocrawl/capital-free/alchemy-integration.ts');

assertContains(filtered, "process.env.ALCHEMY_FILTERED_MEMPOOL_ENABLED", 'filtered mempool has an independent enable/disable control');
assertContains(filtered, "|| 'ethereum'", 'filtered mempool has a conservative Ethereum default when no network list is supplied');
assertContains(filtered, "'alchemy_pendingTransactions'", 'filtered mempool uses Alchemy pending-transaction subscriptions');
assertContains(filtered, 'toAddress,', 'filtered stream applies server-side router address filters');
assertContains(filtered, 'hashesOnly: false', 'filtered stream receives full transactions without per-hash detail RPC');
assertContains(wiring, "process.env.ALCHEMY_FILTERED_MEMPOOL_ENABLED", 'runtime wiring uses the independent filtered-mempool control');
assertContains(wiring, '!!process.env.ALCHEMY_API_KEY?.trim()', 'runtime wiring requires an Alchemy credential');
assertContains(wiring, 'enabledByDefaultWhenConfigured: true', 'runtime observability reports filtered default posture');
assertContains(legacy, "process.env.ALCHEMY_MEMPOOL_MONITORING_ENABLED === 'true'", 'legacy broad mempool remains opt-in');
assertContains(legacy, "process.env.ALCHEMY_ALLOW_UNFILTERED_PENDING === 'true'", 'legacy unfiltered stream retains its explicit emergency gate');
assertNotContains(wiring, 'ALCHEMY_ALLOW_UNFILTERED_PENDING =', 'filtered wiring never enables the broad pending stream');

console.log('Filtered Alchemy mempool wiring verification passed.');
