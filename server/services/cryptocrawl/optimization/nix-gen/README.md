# Nix-Gen

Nix-Gen is CryptoCrawler's additive global opportunity-allocation layer. It compares already-authoritative profitable opportunities under shared scarce resources and improves scheduling/resource decisions without becoming a second economics, governance, execution, settlement, resource, treasury, payout, or learning authority.

## Implementation state

The Nix-Gen architecture is implemented. `completion-manifest.ts` is the transparent capability map and deliberately separates Nix-Gen implementation completion from runtime proof, guaranteed profitability, or missing upstream execution systems.

Implemented capabilities include:

- standardized cross-strategy bids backed by canonical measured economics;
- bounded exact branch-and-bound allocation plus deterministic resource-aware fallback;
- shared cross-lane live priority across CEX arbitrage, maker-CEX/market-making, measured DEX/liquidation and the existing zero-capital engine;
- continuous fingerprinted replanning with expiry/temporal invalidation;
- default-on, fail-open scheduling optimization with `CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING=false` as the rollback switch;
- defer-not-reject semantics for valid profitable opportunities losing a temporary resource contest;
- strategy-finger/limb registry with availability derived only from upstream execution + terminal-settlement truth;
- read-only canonical resource projections;
- scarcity diagnostics, finite-difference marginal resource value and approximate Lagrangian dual resource prices with distinct semantics;
- robust uncertainty diagnostics with unknown-stays-unknown behavior;
- confirmed terminal-settlement calibration;
- capital/inventory routing recommendations with no treasury authority;
- optional QuantiComp heavy analysis with deterministic inline classical fallback;
- explicit integration boundaries for Cryptara/Monte Carlo, TradingView/MultiOracle, QuantiComp/Beam, DynamicScalePhysics, ProfitLadder/Stage/risk, private/atomic execution, terminal settlement and treasury/capital systems;
- semantic/no-regression verifier coverage through the existing `verify-nix-gen-*` Docker build gate.

## Live coordination

The runtime live priority surface is `live-priority-registry.ts`. It receives fresh, already-prepared bids from independently authoritative lanes and builds one advisory portfolio without acquiring resources or dispatching work.

Currently connected execution-capable lanes are:

1. **CEX arbitrage** — canonical CEX scheduler/executor and terminal settlement remain authoritative.
2. **Maker-CEX / market-making** — Nix-Gen identifies maker/RPI plans as the market-making finger while the existing post-only maker adapters and CEX settlement remain execution truth.
3. **DEX atomic + liquidation** — the measured topology adapter remains the only executor/terminal-settlement path for these topologies.
4. **Zero-capital atomic** — Nix-Gen orders the existing zero-capital queue only. The zero-capital engine, resource scheduler, receiver execution, realized all-in profit reconciliation, treasury split and retained-capital path remain authoritative. The prior resource-shadow queue scorer remains the fail-open fallback.

Each lane retains its own hard quota, lease, governance and executor. The shared Nix-Gen priority surface therefore coordinates scarce opportunity value globally without becoming a global execution authority.

`global-live-portfolio.ts` is the pure snapshot helper. It can combine prepared CEX/maker, measured atomic and independently prepared live-lane bids such as zero-capital. It remains read-only.

## Upstream capability boundaries

A Nix-Gen finger is not made executable merely because the strategy name exists. The following remain unavailable for live Nix-Gen allocation until their upstream canonical path becomes truthfully executable and terminal-settlement-capable:

- **Cross-chain arbitrage:** Across transport and terminal bridge settlement exist, but current discovery intentionally lacks a source/destination arbitrage revenue leg, destination price/revenue evidence and deterministic all-in profitable composition. Transport cost alone is not profit.
- **Funding-rate arbitrage:** a durable lifecycle skeleton exists, but current discovery intentionally lacks measured entry/exit depth, measured exit-basis reserve, registered venue lifecycle adapters, complete margin/collateral controls and terminal funding-payment/close evidence.
- **Solver/intents:** no canonical executable terminal-settlement-capable intent route currently exists.

These are upstream strategy/execution requirements, not missing Nix-Gen allocation machinery. Nix-Gen must not fabricate profitability or execution capability to make those fingers appear available.

## Authority boundary

- Canonical measured economics remain upstream; Nix-Gen never creates or repairs economics.
- Unknown canonical BPS remains `null`; Nix-Gen does not duplicate BPS calculation.
- Existing authoritative execution and settlement capability must already exist before a bid is live-capable.
- Governance, ProfitLadder, resource ownership, nonce/rate safety, kill switch, settlement, payout, retained-capital accounting and terminal learning remain authoritative upstream.
- Valid profitable bids that lose a temporary resource contest remain in the complete priority order and are advisory-deferred rather than rejected.
- Known but temporarily insufficient capacity is deferred; missing capacity evidence remains hard-invalid to Nix-Gen and is never converted to zero.
- Resource projections are read-only; distributed lease acquisition remains hard resource truth.
- Nix-Gen never reads signer private keys, submits transactions, or transfers treasury funds.

## Canonical evidence integration

### Cryptara and Monte Carlo

Cryptara's canonical assessment already incorporates authoritative Monte Carlo evidence into `probabilityOfProfitableExecution`. Nix-Gen consumes that evidence once; it does not run a second Monte Carlo model or recycle composite profitability scores that would double-count profit/confidence.

### TradingView and MultiOracle

TradingView and MultiOracle enrich upstream canonical/Cryptara state. Nix-Gen consumes the resulting canonical evidence rather than creating competing technical-analysis or oracle authorities.

### ProfitLadder, StageManager and risk

Hard notional, stage, drawdown, circuit-breaker and execution-safety constraints remain upstream. Nix-Gen optimizes only among opportunities that survive those truths.

### DynamicScalePhysics

DynamicScale/pressure wiring remains scaling authority. Nix-Gen consumes resulting capacity/pressure through resource projections rather than changing compute scale itself.

### QuantiComp and Computational Beam

QuantiComp remains canonical heavy-compute authority. `quanti-analysis.ts` may route side-effect-free Nix-Gen analysis through QuantiComp with deduplication, deadlines and deterministic validation; failure falls back to inline classical analysis. Computational Beam remains a compatibility/routing facade rather than a competing compute authority.

## Optimizer behavior

- Small feasible sets use bounded exact branch-and-bound optimization.
- Exact search has a hard candidate cap so combinatorial explosion cannot enter the hot path.
- Larger sets use deterministic resource-aware fallback.
- Shared capacities are merged conservatively rather than double-counted.
- Mutual-exclusion groups prevent incompatible variants of the same opportunity from being selected together while keeping valid alternatives deferred/alive.
- Canonical positive net profit is the base objective.
- Independent probability, terminal calibration, decay urgency and bounded rank evidence may change scheduling utility only.

## Resource intelligence

Nix-Gen keeps three resource signals distinct:

1. **Scarcity signal** — bounded heuristic utilization/congestion diagnostic; not a shadow price.
2. **Marginal resource value** — finite-difference estimate of additional canonical net profit unlocked by another resource unit; not a mathematical dual variable.
3. **Dual resource price** — projected-subgradient Lagrangian USD/unit price derived from the optimization model. Because allocation is discrete/integer, it is approximate and does not claim exact strong duality or an exact LP/MIP multiplier.

Capital-routing advisory uses these signals only to identify marginal value. It cannot move, sweep, withhold or size money.

## Robust uncertainty

- Independent, time-bounded downside evidence may produce an advisory reserve/value.
- Missing, expired, future-dated or invalid uncertainty evidence remains unknown.
- Fractional budgeted uncertainty allows graduated conservatism.
- A negative robust advisory value cannot independently invalidate a canonically profitable executable opportunity.

## Terminal calibration

Confirmed terminal settlement is the only source for realized-vs-expected calibration. The existing settlement-profit calibrator remains learning authority; Nix-Gen reads its output and uses a bounded scheduling factor only.

## Research-only limbs

- **CognitiveFabric:** general 4JI cognition remains outside canonical financial truth and the live execution hot path.
- **HHL/quantum:** HHL is relevant only to mathematically suitable linear-system subproblems. It is not a generic combinatorial allocation engine. Classical Nix-Gen remains the mandatory production baseline and fallback.

## Research basis

`scripts/cryptocrawl/nix-gen-research-map.txt` records the public/declassified engineering basis: Stanford/Boyd resource allocation and dual pricing, NASA/JPL continuous planning and iterative repair, DARPA scalable uncertainty-aware planning, MIT robust/congestion-aware optimization, Sandia time-critical scheduling, online resource-constrained learning, market-impact-aware execution, smart order routing, combinatorial batch allocation, private/atomic routing and deterministic classical solver fallbacks.

Public/declassified research informs architecture; it does not become runtime authority.

## No-regression laws

1. One authority per responsibility.
2. No synthetic economics, liquidity, fills, settlement, provider health or learning evidence.
3. Unknown critical evidence is never converted to zero.
4. Non-positive canonical economics are never promoted by Nix-Gen.
5. Expired opportunities cannot be selected.
6. An authoritative settlement-capable execution path must already exist for a live strategy finger.
7. Resource projections are advisory; canonical lease acquisition remains hard truth.
8. Valid profitable non-selected bids are deferred, not vetoed.
9. Profit/confidence evidence cannot be double-counted through recycled composite scores.
10. QuantiComp, dual pricing, uncertainty analysis and research limbs are never mandatory dependencies for core classical allocation.
11. Nix-Gen does not access signer secrets, submit transactions, or become treasury authority.
12. Every slice remains independently useful and removable without breaking existing production behavior.

Implementation completion does not claim live operational proof, future profitability, or completion of separate upstream strategy executors outside Nix-Gen's authority boundary.
