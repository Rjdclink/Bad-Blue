import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const feeResolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');
const privateAuthority = read('server/services/cryptocrawl/intelligence/cex-private-authority.ts');
const observability = read('server/services/cryptocrawl/integration/runtime-observability.ts');
const readinessPolicy = read('server/services/cryptocrawl/runtime/readiness-policy.ts');

assert.match(feeResolver, /from '.\/cex-private-authority\.js'/);
assert.match(feeResolver, /krakenPrivateRequest\('\/0\/private\/TradeVolume'/);
assert.match(privateAuthority, /serializeKrakenPrivate/);
assert.match(privateAuthority, /krakenPrivateTail/);
assert.match(privateAuthority, /nextKrakenNonce\(\)/);
assert.match(privateAuthority, /scheduleOkxLane/);
assert.match(privateAuthority, /OKX_FEE_MIN_INTERVAL_MS/);
assert.match(privateAuthority, /Math\.max\(425/);
assert.match(feeResolver, /lane: 'trade_fee'/);
assert.match(feeResolver, /OKX fee batch resolved using regional live-instrument groups/);
assert.doesNotMatch(feeResolver, /let krakenPrivateTail/);
assert.doesNotMatch(feeResolver, /const OKX_FEE_MIN_INTERVAL_MS/);
assert.match(observability, /computeCryptoRuntimeReadiness/);
for (const key of ['APP_READY', 'CONFIG_READY', 'DATA_READY', 'DISCOVERY_READY', 'EXECUTION_READY', 'TRADING_READY']) {
  assert.ok(readinessPolicy.includes(`${key}:`), `missing readiness key ${key}`);
}
assert.match(readinessPolicy, /EXECUTION_CAPABILITY_READY:/);
assert.match(readinessPolicy, /INVENTORY_READY:/);
assert.match(readinessPolicy, /CANDIDATE_READY:/);
assert.match(readinessPolicy, /GOVERNANCE_READY:/);
assert.match(readinessPolicy, /ready: tradingReady/);

console.log('[verify-preflight-authority-relocation] PASS');
