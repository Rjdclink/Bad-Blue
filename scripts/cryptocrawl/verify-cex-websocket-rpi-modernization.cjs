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
const maker = read('server/services/cryptocrawl/execution/stablecoin-maker-strategy.ts');
const makerAdapters = read('server/services/cryptocrawl/execution/post-only-maker-adapters.ts');
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
requirePattern(makerAdapters, /There is no silent[\s\S]{0,120}downgrade from RPI to standard maker/, 'RPI plan cannot silently fall back to a worse standard-maker fee');

// Advisory scheduling remains read-only and is separated from execution-time
// capability to avoid intelligence/integration initialization cycles.
requirePattern(rpiAdvisory, /from '\.\/okx-rpi-capability\.js'/, 'RPI advisory consumes the dedicated capability authority');
requirePattern(rpiAdvisory, /await import\('\.\.\/integration\/cex-four-mode-observability-wiring\.js'\)/, 'four-mode advisory dependency is lazy and non-authoritative');
requirePattern(rpiAdvisory, /executionAuthority:\s*false/, 'RPI advisory never grants execution authority');

console.log('[cex-modernization] Coinbase Advanced/Kraken v2/OKX regional websocket product authority and authenticated OKX RPI maker invariants passed');
