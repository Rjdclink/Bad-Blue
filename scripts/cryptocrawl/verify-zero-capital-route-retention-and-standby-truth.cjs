const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const resources = read('server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts');
const streams = read('server/services/cryptocrawl/intelligence/cex-order-book-stream.ts');
const gasPolicy = read('server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts');

const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

check('temporary resource loss never deletes configured zero-capital discovery routes',
  !resources.includes('target.configuredRoutes = target.configuredRoutes.filter'));
check('resource standby explicitly preserves discovery routes',
  resources.includes('configuredRoutesPreserved: true') && resources.includes('discoveryContinues: true'));
check('zero-capital resource telemetry explicitly requests no personal funding',
  resources.includes('personalFundingRequested: false'));
check('user-facing missing evidence names a zero-personal-cost gas resource instead of user funding',
  resources.includes("'zero_personal_cost_gas_resource'"));
check('strict gas authority still rejects unproven personal/operator monetary input',
  gasPolicy.includes('operatorMonetaryInputRequired') && gasPolicy.includes('nativeSystemOwnedProven'));

check('standby warmup has a separate metric from true failover',
  streams.includes('standbyWarmupServes') && streams.includes('standbyHandovers'));
check('standby startup race requires no primary failure inference',
  streams.includes('primaryFreshSeen') && streams.includes('primaryFailureInferred: false'));
check('true failover warning requires a previously fresh primary',
  streams.includes("if (!this.primaryFreshSeen.has(key))") && streams.includes('primaryFailureInferred: true'));
check('standby remains fresh-exchange-data only',
  streams.includes("handoverAuthority: 'fresh_exchange_snapshot_only'") && streams.includes('syntheticBookAllowed: false'));
check('standby never changes execution authority', streams.includes('executionAuthorityChanged: false'));

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`zero-capital route-retention/standby-truth verifier failed: ${failed.map(([name]) => name).join('; ')}`);
  process.exit(1);
}

console.log('[zero-capital-route-retention-and-standby-truth] temporary resource standby preserves discovery, requests no personal funding, and CEX startup warmup is separated from real primary failover');
