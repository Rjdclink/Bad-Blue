'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`[cex-modernization] missing required source: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

function requirePattern(source, pattern, description) {
  if (!pattern.test(source)) throw new Error(`[cex-modernization] missing invariant: ${description}`);
}

function forbidPattern(source, pattern, description) {
  if (pattern.test(source)) throw new Error(`[cex-modernization] forbidden regression: ${description}`);
}

const stream = read('server/services/cryptocrawl/intelligence/cex-order-book-stream.ts');
const arbVerifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');
const maker = read('server/services/cryptocrawl/execution/stablecoin-maker-strategy.ts');
const makerAdapters = read('server/services/cryptocrawl/execution/post-only-maker-adapters.ts');
const hybrid = read('server/services/cryptocrawl/runtime/hybrid-cex-execution-wiring.ts');
const settlement = read('server/services/cryptocrawl/execution/cex-settlement.ts');
const rpiCapability = read('server/services/cryptocrawl/intelligence/okx-rpi-capability.ts');
const rpiAdvisory = read('server/services/cryptocrawl/intelligence/okx-rpi-fee-advisory.ts');

// One shared live-product authority drives every websocket identity. No stablecoin
// suffix parser may become an alternate product directory.
requirePattern(stream, /resolveCoinbaseAdvancedProductId\s*\(/, 'Coinbase websocket resolves exact Advanced Trade product ids from the canonical catalog');
requirePattern(stream, /getSpotProductConstraints\s*\(\s*venue\s*,\s*symbolInput\s*\)/, 'Kraken and OKX websocket identities consume canonical product constraints');
requirePattern(stream, /wss:\/\/advanced-trade-ws\.coinbase\.com/, 'Coinbase Advanced Trade websocket endpoint is authoritative');
requirePattern(stream, /channel:\s*'level2'/, 'Coinbase Advanced Trade level2 channel is used');
requirePattern(stream, /wss:\/\/ws\.kraken\.com\/v2/, 'Kraken websocket v2 endpoint is used');
requirePattern(stream, /wsus\.okx\.com[\s\S]{0,220}us\.okx\.com|us\.okx\.com[\s\S]{0,220}wsus\.okx\.com/, 'OKX US websocket stays aligned to the US REST region');
requirePattern(stream, /quoteCurrencyAllowlistUsed:\s*false/, 'websocket telemetry declares no quote allowlist authority');
forbidPattern(stream, /\(USDT\|USDC\|USD\)/, 'websocket product identity using a stablecoin-only quote regex');

// Canonical taker planning must use the same modern stream surface for every
// executable CEX and may only fall back to the exact live REST product. USD P&L
// is admitted only on products with an authoritative USD-normalized quote.
requirePattern(arbVerifier, /fetchStreamQuote\(\s*'coinbase'\s*,\s*symbol\s*,\s*maxAgeMs\s*\)/, 'Coinbase taker planning uses Advanced Trade websocket first');
requirePattern(arbVerifier, /fetchStreamQuote\(\s*'kraken'\s*,\s*symbol\s*,\s*maxAgeMs\s*\)/, 'Kraken taker planning uses websocket v2 first');
requirePattern(arbVerifier, /fetchStreamQuote\(\s*'okx'\s*,\s*symbol\s*,\s*maxAgeMs\s*\)/, 'OKX taker planning uses regional websocket first');
requirePattern(arbVerifier, /quoteTransportPolicy:\s*'coinbase_kraken_okx_websocket_first_with_exact_rest_fallback'/, 'taker telemetry declares the shared stream-first policy');
requirePattern(arbVerifier, /USD_NORMALIZED_QUOTES/, 'taker planning has an explicit USD-normalization boundary');
requirePattern(arbVerifier, /assertUsdNormalizedQuote\s*\(/, 'taker planning rejects quote assets without authoritative USD normalization');
requirePattern(arbVerifier, /nonUsdNormalizedQuoteExecutionAuthority:\s*false/, 'non-USD-normalized quote products have no execution authority');

// Request/configured fee values may remain compatibility inputs, but they can
// never replace authenticated venue fees in executable economics.
requirePattern(arbVerifier, /evidence\?\.source\s*===\s*'configured_override'\s*\?\s*null\s*:\s*evidence/, 'configured fee evidence is removed before executable economics');
requirePattern(arbVerifier, /executableFeeAuthority:\s*'authenticated_venue_evidence_only'/, 'authenticated venue fees are the sole executable taker fee authority');
requirePattern(arbVerifier, /configuredOrRequestFeeOverridesExecutable:\s*false/, 'configured/request fee overrides are explicitly non-executable');
requirePattern(arbVerifier, /if\s*\(!evidence\s*\|\|\s*evidence\.source\s*===\s*'configured_override'\)\s*return\s*null/, 'effective taker fee fails closed on missing or configured-only evidence');
forbidPattern(arbVerifier, /function\s+configuredTakerFeeBps\s*\(/, 'configured taker fee helper retaining executable authority');
forbidPattern(arbVerifier, /function\s+requestedFeeOverride\s*\(/, 'request fee override helper retaining executable authority');
forbidPattern(arbVerifier, /function\s+overrideEvidence\s*\(/, 'synthetic configured fee evidence constructor retaining executable authority');

// RPI capability is authenticated/account-specific evidence, never a synthetic
// rebate. Exact regional product identity comes from cex-spot-product-policy.
requirePattern(rpiCapability, /getSpotProductConstraints\(\s*'okx'/, 'RPI capability consumes canonical OKX live-product identity');
requirePattern(rpiCapability, /\/api\/v5\/account\/instruments/, 'RPI maker permission is authenticated from account instruments');
requirePattern(rpiCapability, /\/api\/v5\/account\/trade-fee/, 'RPI fee economics are authenticated');
requirePattern(rpiCapability, /rpiMaker/, 'authenticated RPI maker fee is consumed');
requirePattern(rpiCapability, /\/api\/v5\/market\/books-rpi/, 'RPI public spacing evidence comes from books-rpi');
requirePattern(rpiCapability, /rpiMinLevel/, 'RPI minimum organic-level spacing is enforced');
requirePattern(rpiCapability, /rpiMinPxBand/, 'RPI minimum price-band evidence is enforced');
requirePattern(rpiCapability, /Math\.max\(1_000/, 'OKX SPOT RPI $1,000 minimum notional remains a hard floor');
requirePattern(rpiCapability, /permissionState\s*===\s*'2'/, 'RPI maker execution requires maker permission state');
requirePattern(rpiCapability, /executableFeeAdvantage/, 'RPI is eligible only when it improves authenticated maker economics');
requirePattern(rpiCapability, /\.\.\.capability\.rpiBookBids,\s*\.\.\.capability\.rpiBookAsks/, 'RPI level spacing counts the complete organic price-level surface on both sides of the book');
requirePattern(rpiCapability, /return\s+bandPass\s*\|\|\s*levelPass\s*;/, 'OKX independent RPI spacing conditions are applied disjunctively rather than requiring both');
forbidPattern(rpiCapability, /\(USDT\|USDC\|USD\)/, 'RPI capability implementing an independent stablecoin quote parser');

// Standard maker and RPI compete inside one canonical maker strategy. RPI never
// grants authority by itself and cannot silently degrade to worse economics.
requirePattern(maker, /MakerOrderStyle\s*=\s*'post_only'\s*\|\s*'rpi'/, 'maker strategy models standard post-only and RPI as execution styles');
requirePattern(maker, /getOkxRpiExecutionCapability\s*\(/, 'maker strategy observes authenticated RPI capability');
requirePattern(maker, /isOkxRpiMakerPriceAdmissible\s*\(/, 'maker strategy checks RPI permission/notional/spacing before selecting the fee');
requirePattern(maker, /exactMakerLegEconomics/, 'maker fee selection is finalized after exact executable sizing');
requirePattern(makerAdapters, /getOkxRpiExecutionCapability\(request\.symbol,\s*true\)/, 'RPI permission and fee are force-refreshed at submit time');
requirePattern(makerAdapters, /ordType\s*=\s*'rpi'/, 'qualified OKX maker legs can submit as RPI');
requirePattern(makerAdapters, /OKX_RPI_REJECT_FEE_WORSENED/, 'submit-time RPI fee worsening fails closed');
requirePattern(makerAdapters, /OKX_RPI_REJECT_PERMISSION_NOTIONAL_OR_SPACING_CHANGED/, 'submit-time RPI permission/notional/spacing drift fails closed');
requirePattern(makerAdapters, /There is no silent[\s\S]{0,120}downgrade from RPI to standard/, 'RPI plan cannot silently fall back to a worse standard-maker fee');

// MT/TM reuse the maker adapter but do not carry MM makerExecution metadata.
// Optional access is required so hybrid maker submission remains standard
// post-only instead of throwing before the first order.
requirePattern(hybrid, /createPostOnlyMakerAdapters\(plan as unknown as MakerRecoveryPlan\)/, 'hybrid lifecycle reuses the shared maker adapter');
requirePattern(makerAdapters, /const\s+execution\s*=\s*plan\.makerExecution/, 'shared maker adapter isolates optional MM execution metadata');
requirePattern(makerAdapters, /execution\?\.orderStyle\?\.buy/, 'hybrid-safe buy maker style defaults through optional metadata');
requirePattern(makerAdapters, /execution\?\.orderStyle\?\.sell/, 'hybrid-safe sell maker style defaults through optional metadata');
forbidPattern(makerAdapters, /plan\.makerExecution\.orderStyle/, 'shared maker adapter directly dereferencing absent hybrid makerExecution metadata');

// The default settlement adapters must consume the same live-product authority as
// planning, fee discovery, FOK and maker paths. No local Kraken/OKX instrument-id
// reconstruction is allowed to survive into MT/TM taker settlement.
requirePattern(settlement, /getSpotProductConstraints\(\s*'kraken'\s*,\s*request\.symbol\s*,\s*true\s*\)/, 'Kraken default settlement force-refreshes canonical live product identity at submit');
requirePattern(settlement, /pair:\s*constraints\.exchangeSymbol/, 'Kraken default settlement submits exact live exchange symbol');
requirePattern(settlement, /getSpotProductConstraints\(\s*'okx'\s*,\s*request\.symbol\s*,\s*true\s*\)/, 'OKX default settlement force-refreshes canonical live product identity at submit');
requirePattern(settlement, /instId:\s*constraints\.exchangeSymbol/, 'OKX default settlement uses exact regional live exchange symbol');
requirePattern(settlement, /getSpotProductConstraints\(\s*'okx'\s*,\s*order\.symbol/, 'OKX query/cancel settlement remains bound to canonical product identity');
forbidPattern(settlement, /instId:\s*`\$\{base\}-\$\{quote\}`/, 'OKX settlement locally reconstructing an instrument id');

// Normalize venue-native terminal fee signs before realized P&L. OKX reports
// fees as negative and rebates as positive, opposite the canonical economic-cost
// convention. A charged fee must decrease realized P&L and a rebate must increase it.
requirePattern(settlement, /order\.venue\s*===\s*'okx'\s*\?\s*-order\.feeAmount\s*:\s*order\.feeAmount/, 'OKX terminal fee/rebate sign is converted to canonical economic cost');
requirePattern(settlement, /proceedsUsd\s*-\s*acquisitionCostUsd\s*-\s*exchangeFeeUsd/, 'realized P&L subtracts canonical signed economic fee cost');
requirePattern(settlement, /venue_native_fee_sign_normalized_to_economic_cost/, 'terminal provenance records fee-sign normalization');

// RPI-taker access can expose additional executable depth for standard OKX order
// types, but the API does not expose a safe read-only account permission probe.
// Observe/prewarm the incremental RPI depth and keep execution disabled rather
// than testing eligibility with a live one-leg order.
requirePattern(rpiAdvisory, /documentedStandardOrderTypes:\s*\['limit',\s*'market',\s*'fok',\s*'ioc'\]/, 'RPI taker advisory recognizes every documented standard order type');
requirePattern(rpiAdvisory, /observedAdditionalBidBaseQty/, 'RPI taker advisory measures extra bid-side RPI depth');
requirePattern(rpiAdvisory, /observedAdditionalAskBaseQty/, 'RPI taker advisory measures extra ask-side RPI depth');
requirePattern(rpiAdvisory, /permissionProven:\s*false/, 'RPI taker access cannot claim unproven account permission');
requirePattern(rpiAdvisory, /rpiTakerExecutionAuthority:\s*false/, 'RPI taker depth observation cannot grant execution authority');
requirePattern(rpiAdvisory, /prewarm_and_measure_only_until_non_mutating_account_permission_evidence_exists/, 'RPI taker access remains prewarm-only until safe permission evidence exists');
forbidPattern(makerAdapters, /rpiTakerAccess\s*:\s*true/, 'maker execution cannot smuggle unproven RPI taker access into orders');

// Advisory scheduling remains read-only and is separated from execution-time
// capability to avoid intelligence/integration initialization cycles.
requirePattern(rpiAdvisory, /from '\.\/okx-rpi-capability\.js'/, 'RPI advisory consumes the dedicated capability authority');
requirePattern(rpiAdvisory, /await import\('\.\.\/integration\/cex-four-mode-observability-wiring\.js'\)/, 'four-mode advisory dependency is lazy and non-authoritative');
requirePattern(rpiAdvisory, /executionAuthority:\s*false/, 'RPI advisory never grants execution authority');

console.log('[cex-modernization] Coinbase Advanced/Kraken v2/OKX regional stream-first books, authenticated-only executable taker fees, USD-normalized P&L, authenticated OKX RPI maker with correct independent spacing semantics, hybrid-safe maker adapters, canonical settlement product ids/fee signs, and safe RPI-taker depth observability invariants passed');
