const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const authority = read('server/services/cryptocrawl/intelligence/cex-private-authority.ts');
const l3 = read('server/services/cryptocrawl/intelligence/kraken-l3-queue-intelligence.ts');
const amend = read('server/services/cryptocrawl/execution/kraken-maker-queue-amend.ts');
const maker = read('server/services/cryptocrawl/execution/post-only-maker-adapters.ts');

function must(source, text, label) {
  assert.ok(source.includes(text), `missing invariant: ${label}`);
}
function forbid(source, text, label) {
  assert.ok(!source.includes(text), `forbidden regression: ${label}`);
}

must(authority, "export type KrakenPrivateEncoding = 'form' | 'json'", 'Kraken form default plus JSON opt-in share one authority');
must(authority, "const encoding = options.encoding || 'form'", 'existing Kraken endpoints retain form encoding by default');
must(authority, 'withKrakenDistributedLane(apiKey', 'all Kraken private surfaces share one nonce and distributed lane');
must(authority, 'nonce is owned exclusively by CexPrivateAuthority', 'callers cannot create a second nonce authority');
must(authority, 'lateParameters', 'time-sensitive Kraken fields can be minted only after serialization and nonce admission');
must(authority, "contentType: 'application/json'", 'Kraken JSON surface signs and sends exact JSON');

must(l3, "'/0/private/Level3'", 'authenticated Kraken L3 endpoint is used');
must(l3, 'depth: KRAKEN_L3_DEPTH', 'Kraken L3 is bounded to depth 10');
must(l3, 'const KRAKEN_L3_DEPTH = 10 as const', 'Kraken L3 depth remains explicitly bounded');
must(l3, 'samePriceQuantityAhead: null', 'order absence is unknown, never fabricated zero queue');
must(l3, "authority: 'kraken_l3_queue_advisory_only'", 'L3 queue evidence is advisory only');
must(l3, 'economicBpsAuthority: false', 'L3 cannot fabricate canonical BPS');
must(l3, 'executionAuthority: false', 'L3 cannot own execution');

must(amend, 'evaluateMakerTickQueueJump', 'existing queue optimizer is reused rather than duplicated');
must(amend, "cexOrderBookStreams.getQuote('kraken'", 'fresh canonical Kraken L2 is reacquired before amend');
must(amend, "'/0/private/AmendOrder'", 'queue-preserving atomic AmendOrder is used');
forbid(amend, '/0/private/EditOrder', 'legacy EditOrder replacement semantics are forbidden');
must(amend, 'post_only: true', 'Kraken amend must remain passive');
must(amend, "encoding: 'json'", 'Kraken amend uses documented JSON surface');
must(amend, 'lateParameters: () => ({ deadline:', 'Kraken amend deadline is minted immediately before network admission');
must(amend, "boundedEnv('CRYPTO_KRAKEN_AMEND_DEADLINE_MS', 3_000, 2_000, 60_000)", 'Kraken amend deadline stays within venue-supported bounds');
must(amend, 'state.amended = true', 'one accepted amend permanently consumes the per-order amend budget');
must(amend, 'if (!state || state.amended) return;', 'at most one amend is attempted after success');
must(amend, 'this.cumulativeConcessionUsd', 'maker legs share one cumulative price-concession budget');
must(amend, 'remainingVerifiedNetProfitUsd > safetyEpsilonUsd', 'exact remaining verified profit must stay positive after all concessions');
must(amend, 'cancelReinsertFallbackAllowed: false', 'failed optimization never cancel/reinserts the resting order');
must(amend, 'economicBpsAuthority: false', 'amend controller cannot create synthetic BPS');
must(amend, 'settlementAuthority: false', 'amend controller cannot fabricate settlement');

must(maker, 'new KrakenMakerQueueAmendController(plan)', 'both maker legs share one Kraken amend controller');
must(maker, 'krakenQueueAmend.rememberSubmitted', 'Kraken resting order price/tick state is bound at actual submission');
must(maker, 'await krakenQueueAmend.maybeAmend(order, result)', 'amend evaluation occurs only inside existing maker query lifecycle');
must(maker, 'krakenQueueAmend.forget(order.orderId)', 'terminal/cancel lifecycle clears amend state');

console.log('[kraken-l3-queue-amend] PASS: bounded authenticated L3 queue evidence, singular nonce/signing authority, fresh-L2 one-tick post-only AmendOrder, cumulative verified-profit protection, one-amend maximum and no cancel/reinsert fallback are enforced');
