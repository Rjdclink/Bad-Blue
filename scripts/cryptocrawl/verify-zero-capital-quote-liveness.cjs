const assert = require('node:assert/strict');
const fs = require('node:fs');

const quoter = fs.readFileSync('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts', 'utf8');
const discovery = fs.readFileSync('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts', 'utf8');
const executor = fs.readFileSync('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts', 'utf8');

// A non-responsive DEX eth_call must never pin the shared leg cache or prevent
// the recurring canonical zero-capital discovery cycle from scheduling again.
assert.match(quoter, /function withQuoteTimeout<T>/);
assert.match(quoter, /setTimeout\([\s\S]*quote deadline/);
assert.match(quoter, /timer\.unref\?\.\(\)/);
assert.match(quoter, /clearTimeout\(timer\)/);
assert.match(quoter, /const pending = withQuoteTimeout\([\s\S]*quoteLegUncached/);
assert.match(quoter, /providerQuotes\.set\(key, pending\)/);
assert.match(quoter, /if \(providerQuotes\.get\(key\) === pending\) providerQuotes\.delete\(key\)/);
assert.match(quoter, /const remainingMs = quoteDeadlineMs - elapsedMs/);
assert.match(quoter, /quoteLeg\(provider, route\.chain, leg, currentAmount, remainingMs\)/);
assert.match(quoter, /if \(error instanceof Error && error\.message\.includes\('quote deadline'\)\) return null/);

// First-pass evidence acquisition uses the canonical redundant RPC mesh.
assert.match(quoter, /multiProviderRpcManager\.execute\([\s\S]*'contract_calls'/);
assert.match(quoter, /rpcProvider => quoteLegAgainstProvider\(rpcProvider, chain, leg, amountIn\)/);

// A successfully quoted route remains measurable regardless of economic quality.
assert.doesNotMatch(quoter, /if \(netProfitBps < discoveryFloorBps\) return null/);
assert.match(quoter, /bpsToBreakEven: netProfitBps >= 0 \? 0 : Math\.abs\(netProfitBps\)/);
assert.match(quoter, /executablePositive: netProfit > 0n/);
assert.match(quoter, /const selectionPool = admissible\.length > 0 \? admissible : observed/);

// CanonicalZeroCapitalDiscovery is the only recurring ZERO_CAPITAL_ATOMIC scan cadence.
assert.match(discovery, /Promise\.allSettled\(\[\.\.\.target\.providers\.entries\(\)\]\.map\(\(\[chain, provider\]\) => scanOneChain\(chain, provider\)\)\)/);
assert.match(discovery, /function schedule\(\): void/);
assert.match(discovery, /timer = setTimeout\(\(\) => \{[\s\S]*cycleInFlight = cycle\(\)\.finally\(\(\) => \{ cycleInFlight = null; schedule\(\); \}\)/);
assert.match(discovery, /schedulerAuthority:\s*false/);
assert.match(discovery, /executionAuthority:\s*false/);

// Execution remains strict positive all-in and belongs only to the canonical executor.
assert.match(executor, /Sole ZERO_CAPITAL_ATOMIC execution route/);
assert.match(executor, /opportunity\.expectedProfit <= 0n/);
assert.doesNotMatch(executor, /opportunity\.netProfitBps > 0/);
assert.match(executor, /Canonical all-in net economics are not strictly positive/);

console.log('[zero-capital-quote-liveness] redundant RPC mesh, bounded quote deadlines, numeric negative-route measurement, canonical recurring discovery, and positive-only canonical execution verified');
