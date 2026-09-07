# CryptoCrawler Kalshi Runbook

## Scope

Kalshi is integrated as two distinct canonical trading domains:

- `PREDICTION_EVENT` for directional event positions, event market making, and Kalshi↔Polymarket complementary-payout arbitrage.
- `FUNDING_ARBITRAGE` for Kalshi perpetual funding trades hedged on an authenticated CEX spot/margin venue.

Kalshi must never be injected into same-transaction flash-loan execution. Zero-capital eligibility means **zero operator/personal principal, collateral, and gas**, not false atomicity. Multi-period Kalshi strategies may use only provenance-backed system-owned capital or authenticated external liabilities that are fully reconciled before profit ownership.

## Global execution posture

Live submission requires all canonical execution gates to be satisfied. Relevant switches include:

- `NO_EXECUTION` must not be `true`.
- `CRYPTO_ARBITRAGE_LIVE_EXECUTION=true`.
- `CRYPTO_ARBITRAGE_LIVE_CONFIRMATION=I_ACCEPT_LIVE_ORDER_RISK`.
- `CRYPTOCRAWL_KALSHI_ENABLED` must not be `false`.
- `CRYPTOCRAWL_KALSHI_EVENT_LIVE_EXECUTION=true` for directional event execution.
- `CRYPTOCRAWL_KALSHI_EVENT_MAKER_LIVE_EXECUTION=true` for event market making.
- `CRYPTOCRAWL_KALSHI_FUNDING_DISCOVERY` controls funding discovery; execution still requires the canonical governance/capital/evidence gates.

Do not treat these switches as authorization by themselves. Stage Manager, Dynamic Profitability Admission, Profit Ladder, operator trade-slot accounting, resource leases, exact current evidence, and the canonical scheduler remain authoritative.

## Credential and permission requirements

Kalshi credentials must be supplied only through environment/secret configuration consumed by the authenticated Kalshi authorities. Never store credentials in source, logs, plans, provenance, or runbook files.

Before execution the authenticated authority must prove the specific product/account permissions needed for the intended lane. Missing entitlement, account access, fee evidence, sized depth, or trading capability is fail-closed and enters evidence reacquisition rather than becoming assumed capability.

Companion-venue credentials are independently required for the selected hedge/cross-venue lane:

- Positive Kalshi funding may select an authenticated direct-USD Coinbase, Kraken, or OKX spot hedge only when exact executable economics and system-owned inventory/capital are proven.
- Negative Kalshi funding is restricted to authenticated OKX cross-margin short/borrow authority unless another inverse venue is separately implemented and proven.
- Kalshi↔Polymarket execution requires authenticated Polymarket access, signing/submission authority, fee/depth evidence, compatible collateral, geographic/product eligibility, and system-owned collateral.

## Zero-personal-capital rules

These are hard invariants:

1. Account-wide balances prove physical capacity only; they never mint system ownership.
2. Kalshi event cash must come from `cryptocrawler_kalshi_event_system_owned_cash_lots` through the canonical reservation authority.
3. Kalshi perps margin must come from `cryptocrawler_kalshi_system_owned_margin_lots` through the canonical margin reservation authority.
4. Companion CEX hedge capital/inventory must be provenance-backed system-owned CEX lots.
5. Polymarket collateral must be provenance-backed Polymarket system-owned cash lots.
6. Polymarket redemption gas must use the system-owned native-gas spend authority; there is no personal-wallet gas fallback.
7. For negative funding, borrowed base and short-sale proceeds remain liabilities/encumbered capacity. They are not system-owned capital.
8. Negative-funding terminal profit cannot be recognized until authenticated repayment evidence and zero residual base liability are proven.
9. Reservations remain held while exposure, settlement, redemption, or liability state is ambiguous.

If any invariant cannot be proven, execution remains blocked while discovery/evidence collection may continue.

## Directional event execution

Canonical flow:

`Kalshi discovery → exact semantics/depth/fees → calibrated probability → measured candidate registry → DPA → Stage Manager/Profit Ladder → canonical scheduler → Kalshi event lifecycle`

The lifecycle uses deterministic client-order identity, FOK entry, authenticated fill/fee recovery, durable reservation state, settlement reconciliation, and `settlement_unknown` rather than fabricated completion. Terminal cash accounting is applied exactly once before the cash reservation is released.

## Event market making

The maker lane is subordinate to the same measured candidate, governance, Profit Ladder, resource-lease, system-owned cash, and operator-slot authorities. It uses post-only orders, bounded inventory, cancel/replace, quote ageing, queue evidence, partial-fill recovery, information-shock/event-time controls, EWMA deterioration controls, and recovery probes.

Unpaid incentives/rebates and projected spread are never realized profit. Open inventory remains durably owned/reserved until sold or terminally settled.

## Kalshi funding arbitrage

### Positive funding

Direction: `long_spot_short_perp`.

- Kalshi perp entry is short.
- Companion spot hedge is long.
- Exact entry/exit depth, fees, basis, margin reserve, funding timing, and system-owned hedge capital are required.
- Projected funding remains expected value until authenticated terminal funding-payment evidence is available.

### Negative funding

Direction: `long_perp_short_spot`.

- Kalshi perp entry is long.
- Hedge is an authenticated OKX cross-margin spot short using borrow authority.
- Entry requires exact OKX max-loan/max-available-size, authenticated interest, system-owned collateral exclusivity, zero conflicting base inventory/liability, and executable depth/fees.
- The lifecycle proves the attributed borrow after entry and continuously evaluates margin/liability health.
- Close buys back the borrowed base and closes the Kalshi perp.
- Recovery may never release capital or promote proceeds while liability remains unresolved.
- Terminal accounting requires authenticated repayment plus residual liability within the enforced zero-liability tolerance.

## Kalshi ↔ Polymarket cross-venue execution

A mapping is not execution evidence. Every execution revalidates exact semantic equivalence across question, rules, outcomes, resolution source/criteria, cutoff/deadline/timezone, payout, void/cancel behavior, and settlement identity.

Both venues require exact matched executable depth, authenticated fees, system-owned prefunding, and positive guaranteed residual after settlement/capital-lock costs. The first leg is FOK and the second leg is never submitted while the first leg is ambiguous. If the second leg cannot complete, the lifecycle enters durable one-leg recovery and uses a reduce-only Kalshi unwind. Inconsistent terminal resolutions are quarantined.

Polymarket winning positions are not cash-realized until the durable redemption authority proves the on-chain redemption and exact collateral balance delta.

## Data Collection Mode

Missing hard evidence is a reacquisition trigger, not permission to guess and not a permanent rejection. Reacquisition is read-only and has no execution authority. It may refresh:

- authenticated Kalshi fees/account readiness,
- executable depth and market status,
- Kalshi funding/next-funding evidence,
- companion CEX fees/depth/account/inventory evidence,
- OKX borrow/interest/liability evidence,
- Polymarket account/fee/depth/semantic/settlement evidence,
- system-owned capital availability.

Candidates are reevaluated only after fresh provenance-bearing evidence is available.

## Overflow schema

Overflow is the sole hot runtime authority. Required Kalshi/Polymarket schema is provisioned through ordered migrations and startup verification; runtime application code must not invent ad-hoc DDL or fall back to Primary.

Kalshi-related migrations currently include the system-owned margin ledger, event cash ledger, event lifecycle, probability calibration, event maker lifecycle, Polymarket order recovery/cash authority, cross-venue lifecycle, Polymarket redemption recovery, and companion CEX ownership additions.

Startup must fail closed if required tables/functions or the expected runtime schema marker are absent.

## Recovery and settlement

Never resubmit an ambiguous order under a new identity. Recover deterministic order state first.

Do not release reservations when any of the following is unresolved:

- response-lost order submission,
- partial/cancel race,
- open Kalshi event inventory,
- open funding leg,
- one-leg cross-venue exposure,
- Polymarket redemption,
- Kalshi settlement uncertainty,
- OKX inverse borrow liability,
- terminal accounting persistence.

`settlement_unknown`, recovery-required, and quarantined states are intentionally fail-closed states and must remain durable across restart/multi-replica takeover.

## Economics and BPS

Canonical economics count each cost exactly once. Depth-weighted VWAP already contains book slippage; do not subtract the same slippage twice. Funding, rebates, incentives, and refunds are separated into projected versus realized authorities. Borrow interest, settlement costs, capital-lock cost, basis, fees, and gas are included where applicable.

Cryptara, QuantiComp, Monte Carlo, Nix Gen, TradingView, and BPS optimization may rank, model, calibrate, or advise. They do not create execution evidence, deterministic profit, system ownership, or execution authority.

## Pre-merge verification

Do not use GitHub Actions as proof. At one frozen exact head, run the repository prebuild/build path plus the Kalshi guards, including:

- `scripts/cryptocrawl/verify-kalshi-premerge-completion.cjs`
- `scripts/cryptocrawl/verify-kalshi-negative-funding-inverse.cjs`
- `scripts/cryptocrawl/verify-kalshi-bps-integration.cjs`
- `scripts/cryptocrawl/verify-kalshi-coinbase-funding-integration.cjs`
- `scripts/cryptocrawl/verify-atomic-zero-capital-strategy-coverage.cjs`

The merge head must also remain strictly ahead of, and not behind, the intended `develop` base. Re-run the frozen-head build after any reconciliation commit.

## Evidence required before claiming realized profit

A projected candidate, successful submission, open position, funding-rate observation, market resolution, or winning prediction is not realized profit by itself. Realized profit requires terminal authenticated fills/fees, settlement or redemption as applicable, all liabilities repaid, exact system-owned capital accounting, and canonical terminal treasury recording. Post-deployment payout proof is a separate operational verification step.