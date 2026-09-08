const assert = require('node:assert/strict');
const fs = require('node:fs');

const gasProof = fs.readFileSync('server/services/cryptocrawl/runtime/system-owned-gas-funding-proof-wiring.ts', 'utf8');
const observability = fs.readFileSync('server/services/cryptocrawl/integration/runtime-observability.ts', 'utf8');
const readiness = fs.readFileSync('server/services/cryptocrawl/runtime/readiness-policy.ts', 'utf8');

assert.match(gasProof, /const latestDecisions = new Map<SupportedChain, GasFundingDecision>\(\)/);
assert.match(gasProof, /getLatestProvenZeroCapitalGasFundingDecisions/);
assert.match(gasProof, /rememberDecision\(chain, chooseGasFundingMode/);
assert.match(gasProof, /sponsorOperatorMonetaryCostProvenZero: false/);
assert.match(gasProof, /nativeSystemOwnedProven: authority !== null/);

assert.match(observability, /getLatestProvenZeroCapitalGasFundingDecisions/);
assert.match(observability, /decision\.strictZeroInitialCapitalEligible === true/);
assert.match(observability, /decision\.operatorMonetaryInputRequired === false/);
assert.match(observability, /zeroCapitalFundingReady,/);
assert.doesNotMatch(observability, /zeroCapitalFundingReady:\s*stageManager\.isInitialGasReady/);

assert.match(readiness, /const zeroCapitalFundingReady = input\.zeroCapitalFundingReady === true/);
assert.match(readiness, /zeroCapitalExecutionEnabled && zeroCapitalFundingReady && input\.criticalRpcReady/);

console.log('[zero-capital-funding-readiness-wiring] PASS: runtime readiness consumes the cached canonical strict gas proof without inferring zero-personal-cost funding from generic stage state or weakening hosted-sponsor/native-capital provenance requirements');
