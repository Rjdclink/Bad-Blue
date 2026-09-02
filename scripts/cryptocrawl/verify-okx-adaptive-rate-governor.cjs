const fs = require('node:fs');

const source = fs.readFileSync('server/services/cryptocrawl/intelligence/cex-private-authority.ts', 'utf8');
const fees = fs.readFileSync('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts', 'utf8');
const accountFeeAuthority = fs.readFileSync('server/services/cryptocrawl/intelligence/okx-account-fee-authority.ts', 'utf8');
const settlement = fs.readFileSync('server/services/cryptocrawl/execution/cex-settlement.ts', 'utf8');

function must(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`FAIL ${label}: missing ${needle}`);
}
function mustNot(text, needle, label) {
  if (text.includes(needle)) throw new Error(`FAIL ${label}: forbidden ${needle}`);
}

must(source, "export type OkxPrivateLane = 'trade_fee' | 'order_write' | 'order_read' | 'account_read'", 'lane contract preserved');
must(source, "CRYPTO_OKX_FEE_BUCKET_CAPACITY', 5", 'official fee bucket capacity');
must(source, "CRYPTO_OKX_FEE_BUCKET_WINDOW_MS', 2_000", 'official fee bucket window');
must(source, "CRYPTO_OKX_ORDER_BUCKET_CAPACITY', 60", 'protected order-write bucket');
must(source, 'tokens: OKX_LANE_POLICIES[lane].capacity', 'token bucket starts full');
must(source, 'await acquireOkxToken(lane);', 'token acquisition before private request');
must(source, 'await acquireOkxDistributedQuota(lane);', 'Overflow cluster-wide quota before every trade-fee attempt');
must(source, "} finally {\n    // A rejected request still consumes the venue's rate window.", 'failed requests retain distributed pacing');
must(source, "['429', '50011', '51071', '50061']", 'explicit OKX rate-limit codes only');
must(source, 'Math.random() * ceiling', 'full jitter backoff');
must(source, 'state.consecutiveRateLimits >= 5', 'circuit breaker threshold');
must(source, 'OKX_RATE_BREAKER_MS', 'circuit breaker cooldown');
must(source, "response.headers.get('retry-after')", 'standard retry-after support');
must(source, "response.headers.get('OK-RateLimit-Remaining')", 'optional OKX rate metadata support');
must(source, 'Number.isFinite(parsed) ? parsed : fallback', 'malformed env fail-safe');
must(source, 'executeOkxWithAdaptiveRetry', 'adaptive retry authority');
must(source, 'getOkxPrivateAuthoritySnapshot', 'governor observability');

// Do not retry ambiguous network failures or arbitrary exchange failures. Only
// OkxPrivateApiError instances with explicit rate-limit codes are admitted.
must(source, 'error instanceof OkxPrivateApiError', 'typed retry gate');
mustNot(source, "error instanceof TypeError &&", 'no network-error order replay');

must(accountFeeAuthority, "lane: 'trade_fee'", 'fee lookups retain dedicated lane through the sole account-fee authority');
must(fees, 'byGroup', 'fee group batching retained');
must(fees, 'FEE_CACHE_TTL_MS', 'fee cache retained');
must(settlement, "lane: 'order_write'", 'settlement order writes retain protected lane');
must(settlement, "lane: 'order_read'", 'settlement order reads retain protected lane');

console.log('PASS OKX adaptive private rate governor wiring');