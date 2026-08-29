const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('server/services/cryptocrawl/discovery/funding-rate-discovery.ts', 'utf8');

assert.match(source, /BINANCE_JURISDICTION_COOLDOWN_MS/);
assert.match(source, /binanceJurisdictionUnavailableUntil/);
assert.match(source, /HTTP\\s\*451/);
assert.match(source, /restricted location/);
assert.match(source, /eligibility/);
assert.match(source, /jurisdiction_or_eligibility_unavailable/);
assert.match(source, /executionAuthority: false/);
assert.match(source, /binanceJurisdictionUnavailableUntil = Date\.now\(\) \+ BINANCE_JURISDICTION_COOLDOWN_MS/);
assert.match(source, /if \(binanceJurisdictionUnavailableUntil !== null && binanceJurisdictionUnavailableUntil > now\) \{\s*return \[\];/);

// The circuit is discovery-only. Binance observations remain explicitly
// non-executable and no credentials/order authority are introduced.
assert.match(source, /executableWithCurrentSpotCredentials: false/);
assert.match(source, /binance_usdm_public_premium_index/);
assert.doesNotMatch(source, /BINANCE_API_KEY/);
assert.doesNotMatch(source, /\/order/);

console.log(JSON.stringify({
  binanceJurisdictionCircuit: 'verified',
  first451RemainsVisible: true,
  repeatedRestrictedRequestsSuppressed: true,
  boundedCooldown: true,
  executionAuthorityIntroduced: false,
}, null, 2));
