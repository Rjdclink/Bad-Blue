import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const compatibility = readFileSync('server/services/cryptocrawl/capital-free/alchemy-integration.ts', 'utf8');
const pending = readFileSync('server/services/cryptocrawl/capital-free/provider-mesh-pending-stream.ts', 'utf8');
const pressure = readFileSync('server/services/cryptocrawl/capital-free/provider-mesh-mempool-analysis.ts', 'utf8');
const wiring = readFileSync('server/services/cryptocrawl/runtime/dynamic-rpc-provider-wiring.ts', 'utf8');

assert.doesNotMatch(compatibility, /process\.env\.ALCHEMY_API_KEY/, 'legacy compatibility facade must not read an Alchemy credential');
assert.doesNotMatch(compatibility, /g\.alchemy\.com/, 'legacy compatibility facade must not retain Alchemy endpoints');
assert.doesNotMatch(compatibility, /alchemy_getToken/, 'token reads must not use Alchemy enhanced methods');
assert.doesNotMatch(compatibility, /alchemy_pendingTransactions/, 'pending reads must not use Alchemy enhanced methods');
assert.match(compatibility, /apiKey:\s*'retired'/, 'legacy statistics must expose the provider credential as retired');
assert.match(compatibility, /dayEstimatedCu:\s*0/, 'retired compatibility surface must report zero Alchemy compute-unit spend');
assert.match(compatibility, /blockedRequests:\s*0/, 'retired compatibility surface has no provider-cost requests to block');

assert.match(pending, /drpc_pendingTransactions/, 'free full pending stream must use the provider-mesh dRPC replacement');
assert.match(pending, /MAX_FALLBACK_DETAILS_PER_MINUTE/, 'fallback detail requests remain bounded');
assert.match(pressure, /method:\s*'txpool_content'/, 'mempool pressure remains measured rather than inferred');
assert.match(pressure, /PRESSURE_SAMPLE_TTL_MS/, 'pressure requests are cached and bounded');
assert.match(wiring, /alchemyOperationalAuthority:\s*false/, 'dynamic provider mesh must explicitly deny Alchemy operational authority');
assert.match(wiring, /alchemyPaidMempoolAuthority:\s*false/, 'dynamic provider mesh must explicitly deny paid Alchemy mempool authority');

console.log('Provider-mesh Alchemy retirement / zero-provider-spend verification passed');
