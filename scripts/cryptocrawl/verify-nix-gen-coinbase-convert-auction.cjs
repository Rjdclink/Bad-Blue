'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const auction = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/execution/coinbase-convert-execution-auction.ts'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/execution/coinbase-spot-settlement-adapter.ts'), 'utf8');

function must(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(`[verify-nix-gen-coinbase-convert-auction] ${message}`);
}
function forbid(source, pattern, message) {
  if (pattern.test(source)) throw new Error(`[verify-nix-gen-coinbase-convert-auction] ${message}`);
}

must(auction, /\/api\/v3\/brokerage\/convert\/quote/, 'current Advanced Trade Convert quote endpoint is missing');
must(auction, /\/api\/v3\/brokerage\/convert\/trade\//, 'current Advanced Trade Convert commit\/query endpoint is missing');
must(auction, /resolveCexFeeEvidence\('coinbase'/, 'Convert comparison must use authenticated Coinbase fee evidence');
must(auction, /feeEvidence\.source === 'configured_override'/, 'configured fee overrides must not authorize Convert selection');
must(auction, /measuredBenefitBps\s*<=\s*MIN_BENEFIT_BPS/, 'Convert must beat the prepared order-book fallback before selection');
must(auction, /Date\.now\(\) > quote\.expiresAt\) return input\.fallback\.dispatch\(\)/, 'stale pre-submit Convert quotes must fall back before Convert commit');
must(auction, /coinbasePrivateRequest\(`\/api\/v3\/brokerage\/convert\/trade\//, 'Convert commit must use the canonical Coinbase private signer');
forbid(auction, /catch[^]*coinbasePrivateRequest\([^]*fallback\.dispatch\(\)/, 'ambiguous post-commit Convert failures must never duplicate-submit through the fallback');
must(auction, /future_rebate_precredit:false/, 'future or unreceived rebates must not be pre-credited');
must(auction, /synthetic_bps:false/, 'synthetic BPS must remain prohibited');
must(adapter, /prepareCoinbaseConvertAuctionAgainstFallback/, 'canonical Coinbase adapter does not prepare the Convert auction');
must(adapter, /queryCoinbaseConvertSettlement/, 'canonical Coinbase adapter does not terminally query Convert');
must(adapter, /isCoinbaseConvertReceipt\(receipt\.orderId\)\) return;/, 'Convert commit must not be sent to order-cancel endpoint');

console.log('[verify-nix-gen-coinbase-convert-auction] PASS');
