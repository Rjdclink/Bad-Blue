'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('server/services/cryptocrawl/integration/cryptara-two-speed-revalidation-wiring.ts', 'utf8');

// Fresh candidate events still use the canonical exact-symbol graph and no
// independent execution/economics authority is introduced.
assert.match(source, /measuredOpportunityGraph\.revalidateSymbols\(batch\)/);
assert.match(source, /economicAuthority: 'arbitrage_verifier_only'/);
assert.match(source, /executionAuthority: false/);
assert.match(source, /independentBpsThreshold: false/);

// Expired integrated CEX observations may request bounded reacquisition, but
// cannot themselves be promoted or executed.
assert.match(source, /shouldFastRevalidate\(candidate, true\)/);
assert.match(source, /candidate\.status === 'expired' \|\| candidate\.expiresAt <= now/);
assert.match(source, /now - candidate\.expiresAt > windowMs/);
assert.match(source, /queueCandidateRevalidation\(candidate, staleRecoveryCooldownMs\(\), true\)/);
assert.match(source, /staleEvidenceExecutionAllowed: false/);
assert.match(source, /publicOnlyVenuePairRevalidationAllowed: false/);

// Reacquisition remains bounded and lifecycle-owned.
assert.match(source, /function staleSweepIntervalMs\(\)/);
assert.match(source, /function staleRecoveryCooldownMs\(\)/);
assert.match(source, /function staleRecoveryWindowMs\(\)/);
assert.match(source, /if \(!installed \|\| staleSweepTimer \|\| process\.env\.NO_INTERVALS === 'true'\) return/);
assert.match(source, /if \(staleSweepTimer\) clearTimeout\(staleSweepTimer\)/);

console.log('[stale-evidence-reacquisition] PASS: stale integrated CEX evidence triggers bounded canonical reacquisition and never gains execution authority');
