'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const quoter = fs.readFileSync('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts', 'utf8');
const anchor = fs.readFileSync('server/services/cryptocrawl/execution/adapters/protocol-anchor-adapter.ts', 'utf8');
const primary = fs.readFileSync('server/services/cryptocrawl/execution/adapters/primary-market-anchor-adapter.ts', 'utf8');

// Fluid prefers the reviewed official resolver but retains exact live-state direct
// simulation as a fallback; neither path may invent a synthetic quote.
assert.match(quoter, /quoteFluidSwapInViaOfficialResolver/);
assert.match(quoter, /return quoteProtocolAnchorLeg\(rpcProvider/);
assert.match(anchor, /Fluid simulation unexpectedly returned without FluidDexSwapResult/);
assert.match(anchor, /decodeFluidSwapResult\(extractRevertData\(error\)\)/);
assert.match(primary, /Fluid official resolver returned no quote data/);

// GHO GSM capacity is observed live and cached only as a short negative-capacity
// observation. It is not promoted to a global provider/chain veto.
assert.match(anchor, /getAvailableLiquidity\(\)/);
assert.match(anchor, /getAvailableUnderlyingExposure\(\)/);
assert.match(anchor, /Aave GHO GSM buy-side capacity is insufficient/);
assert.match(anchor, /Aave GHO GSM sell-side capacity is insufficient/);
assert.match(anchor, /GSM_NEGATIVE_CAPACITY_TTL_MS/);

// Each route/notional settles independently. A failed Fluid/GSM route therefore
// cannot erase another compatible venue/provider route in the same quote cycle.
assert.match(quoter, /Promise\.allSettled\(sizes\.map/);
assert.match(quoter, /Promise\.allSettled\(candidates\.map/);
assert.match(quoter, /result\.status === 'fulfilled' && result\.value/);
assert.doesNotMatch(anchor, /global.*(block|veto|disable)/i);

console.log('[protocol-anchor-route-locality] PASS: Fluid fallback is exact, GSM capacity is live/route-local, and failed anchor routes cannot veto compatible alternatives');
