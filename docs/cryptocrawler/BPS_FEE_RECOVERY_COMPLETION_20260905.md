# CryptoCrawler BPS Fee-Recovery Completion — 2026-09-05

## Handoff point

The current merged `develop` baseline at the start of this completion wave was merge PR #557 (`2a0d5128f821fad71bc67c4093851ab16385a3aa`). PR #558 is an active complementary branch for universal zero-personal-cost atomic admission. It is intentionally not duplicated here.

The prior BPS sequence already supplied the canonical foundation: authenticated Coinbase/Kraken/OKX fee evidence, signed maker rebates, TT/MT/TM/MM economics, realized CEX fee normalization, BPS Super Engine attribution/revalidation, BPS frontier routing, received-only Flashbots refunds, provider repricing feedback, Morpho zero-fee flash liquidity, OKX fee freshness, and no synthetic fee-age penalty.

This wave closes the remaining CEX fee-program/recovery integration gap without creating another economics or execution authority.

## Canonical authority model

1. `cex-fee-resolver.ts` remains the only executable CEX fee authority.
2. `cex-four-mode-matrix.ts` and downstream canonical execution continue consuming `CexFeeEvidence`; they do not read promotional-program estimates directly.
3. `cex-settlement.ts` remains the per-trade terminal venue-fee truth and preserves signed costs/rebates exactly once.
4. `cex-fee-recovery-authority.ts` observes account-level fee credits/recoveries that are asynchronous or not deterministically attributable before execution.
5. `bps-reduction-super-engine.ts` exposes the recovery snapshot as a sidecar for BPS accounting/learning. Unreceived program benefits cannot make a candidate profitable.
6. No new exchange, trading API key, referral account, or second order/execution authority is introduced.

## Mechanism status

### Executable pre-trade economics

- **Coinbase account fee tier / approved fee-tier improvements:** existing authenticated transaction-summary fee evidence remains authoritative. If Coinbase applies a better approved tier, liquidity-program rate, or fee match to the account, the resolver consumes the changed authenticated rate automatically.
- **Coinbase Stablepairs:** live Coinbase Exchange product metadata is checked for `fx_stablecoin`. A true live flag makes the maker fee exactly 0 BPS for that product. No static symbol list is trusted. If the product flag cannot be reacquired, the authenticated account maker fee is retained; zero is never assumed.
- **Kraken zero/negative maker schedules:** already preserved from authenticated `/0/private/TradeVolume` pair evidence. A negative maker rate remains a maker rebate in canonical economics.
- **OKX zero/negative fee surfaces:** already preserved from authenticated account trade-fee evidence and current live fee-group/product truth. Zero stays zero; a positive OKX rebate rate becomes signed negative economic cost.

### Observed account recovery, not pre-credited

- **Kraken Fee Credits (KFEE/FEE):** authenticated balance is observed using existing Kraken credentials. The aliases are never summed. The available dollar-equivalent fee offset is measured, but it is not inserted into pre-trade BPS until a cross-replica reservation and exact terminal deduction can be proven. Kraken can still apply the credit automatically at the venue.
- **OKX Rebate Card:** only an authenticated positive funding-account bill of type 68 is retained as received recovery. Future card face value is not pre-credited.
- **OKX received fee-rebate bills:** authenticated positive funding-account bill type 173 is retained as received recovery evidence, never as forecast profit.
- **Received-credit currency truth:** USD credits can be totaled directly as USD. USDT/USDC credits remain exact native-currency amounts with `amountUsd = null` until an authoritative quote-to-USD normalization is available. Stablecoin par is never assumed merely to make the recovery number larger.

### Catalogued but deliberately non-authoritative before receipt

- **Coinbase One Advanced fee rebate:** catalogued as a possible post-trade recovery. It is not pre-credited because the current trading integration does not prove active membership, remaining monthly cap, or receipt of the corresponding USDC rebate for a specific trade.
- **OKX Tradeback voucher:** catalogued but not pre-credited because current executable economics do not possess distinct authenticated active-voucher/cap/receipt evidence bound to the trade.
- **OKX AI Builder proprietary transactions:** excluded from CryptoCrawler proprietary-trade economics.
- **Third-party cashback/referral services:** excluded from executable economics unless an actual received credit can later be independently proven without account rebinding or a new trading-key dependency.

## Runtime wiring

`ensureAuthenticatedFeeTierOptimizationWiring()` installs `ensureCexFeeRecoveryWiring()`. Both existing runtime installers therefore receive the recovery observer through the already-authoritative authenticated-fee lifecycle instead of a competing timer/lifecycle authority.

The recovery observer uses the existing Kraken and OKX private request authorities, including their nonce/rate/region/account-read controls. Coinbase stablepair classification uses a public live product endpoint and does not add a private credential.

## BPS Super Engine integration

The Super Engine snapshot now contains `feeRecovery` with:

- authenticated received recovery rows;
- current Kraken fee-credit availability;
- program catalog and authority classification;
- exact native-currency received amounts and explicit USD-normalization gaps;
- `stablecoinParAssumptionAllowed = false`;
- `unreceivedForecastCreditBps = 0`;
- `futureOrConfiguredRecoveryCanCreateProfitability = false`;
- `preTradeKfeeCreditAllowed = false` until exact reservation is implemented;
- execution authority fixed to false.

No 26th research tactic or independent profitability model was added. The existing exactly-25 research-tactic contract remains intact.

## No-regression rules

- Never hard-code a fee-free Coinbase/Kraken/OKX pair when current live product/account evidence can prove the rate.
- Never convert a subscription, coupon, voucher, affiliate promise, cashback percentage, or future rebate into executable BPS before deterministic entitlement/receipt is proven.
- Never assume USDT/USDC equals exactly one USD for realized-recovery accounting; normalize through authoritative market evidence before converting it to USD/BPS.
- Never sum Kraken `KFEE` and `FEE` aliases.
- Never inject asynchronous program credits into immediate `cex-settlement.ts` trade P/L unless exact order-level provenance exists.
- Never make a losing trade eligible merely to reach a future fee tier, cashback threshold, or promotional reward.
- Never generate artificial volume, self-trades, wash trades, or self-referral activity for fee savings.
- Never add another execution authority, exchange account, or API key merely to claim BPS reduction.

## Permanent verification

`verify-cex-fee-recovery-completion.cjs` is included in deployment preflight. It rejects regression of live Coinbase stablepair classification, canonical signed maker economics, received-only OKX recovery, exact recovery-currency truth, conservative Kraken fee-credit accounting, one authenticated fee lifecycle, BPS Super Engine recovery visibility, no delayed-credit injection into CEX settlement, and no new trading credential dependency.
