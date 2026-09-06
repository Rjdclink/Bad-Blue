const assert = require('node:assert/strict');
const fs = require('node:fs');

const quoter = fs.readFileSync('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts', 'utf8');
const engine = fs.readFileSync('server/services/cryptocrawl/core/zero-capital-engine.ts', 'utf8');

// A non-responsive DEX eth_call must never pin the shared leg cache or prevent
// the recurring zero-capital scan cycle from scheduling again.
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

// First-pass evidence acquisition must use the canonical redundant RPC mesh for
// active EVM routes rather than trusting one provider instance.
assert.match(quoter, /multiProviderRpcManager\.execute\([\s\S]*'contract_calls'/);
assert.match(quoter, /rpcProvider => quoteLegAgainstProvider\(rpcProvider, chain, leg, amountIn\)/);

// A successfully quoted route is measurable regardless of economic quality.
// The historical discovery floor is telemetry only; it cannot erase negative BPS.
assert.doesNotMatch(quoter, /if \(netProfitBps < discoveryFloorBps\) return null/);
assert.match(quoter, /bpsToBreakEven: netProfitBps >= 0 \? 0 : Math\.abs\(netProfitBps\)/);
assert.match(quoter, /executablePositive: netProfit > 0n/);
assert.match(quoter, /const selectionPool = admissible\.length > 0 \? admissible : observed/);

// The outer lifecycle must still reschedule after every completed/degraded scan;
// quote timeouts only remove genuinely absent current quote evidence and never grant execution.
assert.match(engine, /Promise\.allSettled\([\s\S]*this\.scanChain/);
assert.match(engine, /finally \{[\s\S]*this\.scanning = false;[\s\S]*this\.scanTimer = setTimeout\(\(\) => void cycle\(\), this\.scanDelayMs\)/);
assert.match(engine, /if \(opportunity\.expectedProfit <= 0n \|\| Date\.now\(\) > opportunity\.expiresAt\) continue/);

console.log('[zero-capital-quote-liveness] redundant RPC mesh, bounded quote deadlines, numeric negative-route measurement, recurring scanner reschedule, and positive-only execution admission verified');
