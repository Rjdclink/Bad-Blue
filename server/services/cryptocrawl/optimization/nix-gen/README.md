# Nix-Gen

Nix-Gen is CryptoCrawler's additive global opportunity-allocation layer. It compares already-authoritative profitable opportunities under shared scarce resources and improves scheduling/resource decisions without becoming a second economics, governance, execution, settlement, resource, treasury, payout, or learning authority.

## Implementation state

The Nix-Gen architecture in this workstream is **implemented**. `completion-manifest.ts` records the implemented capability surface and deliberately distinguishes implementation completion from runtime proof or guaranteed profitability.

Completed components include:

- standardized cross-strategy bids backed by canonical measured economics;
- bounded exact branch-and-bound allocation for small feasible sets;
- deterministic scarcity-aware fallback for larger sets;
- shared dispatch-resource coordination and mixed CEX/measured live portfolio views;
- continuous fingerprinted replanning with expiry/temporal invalidation;
- default-on, fail-open CEX scheduling optimization;
- default-on, fail-open measured DEX/liquidation scheduling optimization;
- strategy-finger/limb registry with capability-aware availability;
- read-only resource projections from canonical schedulers;
- bounded heuristic scarcity diagnostics;
- finite-difference marginal canonical-profit resource valuation;
- optimization-derived Lagrangian dual resource-price discovery with explicit discrete-allocation caveats;
- robust uncertainty diagnostics with unknown-stays-unknown semantics;
- confirmed terminal-settlement calibration;
- capital/inventory routing recommendations based on marginal canonical profit;
- optional QuantiComp heavy advisory analysis with deterministic inline fallback;
- an explicit integration contract for Cryptara/Monte Carlo, TradingView/MultiOracle, QuantiComp/Beam, DynamicScalePhysics, ProfitLadder/Stage/risk, private/atomic execution, settlement feedback, and treasury/capital boundaries;
- Docker build-time semantic/no-regression guards for Nix-Gen files.

## Default runtime posture

`CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING=false` is the explicit rollback switch. If it is not set to `false`, completed Nix-Gen advisory ordering is active.

This changes **scheduling order only**. Any Nix-Gen exception fails open to the prior canonical order. Canonical eligibility, deterministic economics, ProfitLadder sizing, governance, circuit breakers, nonce/rate protection, distributed resource leases, execution, settlement, payout, and learning remain unchanged authorities.

The live runtime currently consumes Nix-Gen ordering in:

- canonical CEX scheduling; and
- settlement-capable measured DEX atomic/liquidation scheduling.

`global-live-portfolio.ts` provides a single comparative portfolio across those currently settlement-capable surfaces using the coordinator's shared dispatch-capacity resource. It is read-only and cannot submit an order or reserve a resource.

## Authority boundary

- Canonical measured economics remain upstream; Nix-Gen never creates or repairs economics.
- Unknown canonical BPS remains `null`; Nix-Gen does not duplicate BPS calculation.
- Existing authoritative execution and settlement capability must already exist before a bid can become an available strategy limb.
- CEX capability comes from the existing canonical execution-capability authority, not from a caller-supplied `true` flag.
- Governance, ProfitLadder, resource ownership, nonce/rate safety, kill switch, settlement, payout, retained-capital accounting, and terminal learning remain authoritative upstream.
- Valid profitable bids that lose a temporary resource contest remain in the complete priority order and are advisory-deferred rather than rejected.
- Known but temporarily insufficient capacity is deferred; missing resource-capacity evidence remains hard-invalid to Nix-Gen and is never converted to zero.
- Resource projections are read-only; distributed lease acquisition remains hard resource truth.
- Nix-Gen never reads signer private keys, submits transactions, or transfers treasury funds.

## Canonical evidence integration

### Cryptara and Monte Carlo

Cryptara's canonical assessment already incorporates authoritative Monte Carlo evidence into `probabilityOfProfitableExecution`. Nix-Gen consumes that probability once. It does not run a second Monte Carlo model or recycle composite profitability scores that would double-count profit/confidence.

### TradingView and MultiOracle

TradingView and MultiOracle evidence enrich upstream canonical/Cryptara state. Nix-Gen consumes the resulting canonical assessment rather than creating competing technical-analysis or oracle authorities.

### ProfitLadder, StageManager and risk

Hard notional, stage, drawdown, circuit-breaker and execution-safety constraints remain upstream. Nix-Gen can optimize among opportunities that survive those truths; it cannot bypass them.

### DynamicScalePhysics

DynamicScale/pressure wiring remains scaling authority. Nix-Gen consumes resulting resource capacity/pressure through resource projections rather than independently changing compute scale.

### QuantiComp and Computational Beam

QuantiComp remains canonical heavy-compute authority. `quanti-analysis.ts` may route heavy side-effect-free Nix-Gen analysis through QuantiComp with deduplication, deadline/timeout bounds and deterministic validation. Failure falls back to the same inline classical analysis. Computational Beam remains a compatibility/routing facade rather than a competing compute authority.

## Optimizer behavior

- Small feasible sets use bounded exact branch-and-bound optimization.
- Exact search has a hard candidate cap so combinatorial explosion cannot enter the hot path.
- Larger sets use a deterministic resource-aware fallback.
- Shared capacities are merged conservatively rather than double-counted.
- Mutual-exclusion groups prevent incompatible variants of the same opportunity from being selected together while keeping valid alternatives deferred/alive.
- Canonical positive net profit is the base objective.
- Independent probability, terminal calibration, decay urgency and bounded rank evidence may change scheduling utility only.

## Resource intelligence

Nix-Gen exposes three distinct resource signals and keeps their semantics separate:

1. **Scarcity signal** — bounded heuristic utilization/congestion diagnostic. It is not a shadow price.
2. **Marginal resource value** — finite-difference estimate of how much additional canonical net profit an extra resource unit could unlock. It is not a mathematical dual variable.
3. **Dual resource price** — projected-subgradient Lagrangian price in USD/unit derived from the optimization model. Because the allocation is discrete/integer, it is explicitly approximate and does not claim exact strong duality or an exact LP/MIP multiplier.

Capital-routing advisory uses these resource economics only to identify where another canonical capital/inventory unit could have the highest marginal value. It cannot move, sweep, withhold or size money.

## Robust uncertainty

- Independent, time-bounded downside evidence may produce an advisory reserve/value.
- Missing, expired, future-dated or invalid uncertainty evidence remains unknown.
- Fractional budgeted uncertainty allows graduated conservatism.
- A negative robust advisory value cannot independently invalidate a canonically profitable executable opportunity.

## Terminal calibration

Confirmed terminal settlement is the only source used for realized-vs-expected calibration. The existing settlement-profit calibrator remains learning authority; Nix-Gen reads its output and uses a bounded scheduling factor only.

## Strategy fingers

The registry contains fingers for CEX arbitrage, DEX atomic, cross-chain, zero-capital, flash-loan, funding-rate, liquidation, market-making, solver/intents and extensible future strategies.

A registered finger is **not** automatically executable. `resolveNixGenStrategyLimb()` marks it available only when the bid already has upstream canonical eligibility, executability, settlement capability and an authoritative execution path.

Therefore currently unsupported live paths remain explicit upstream capability boundaries. For example, a zero-capital strategy may be discovered/planned and have a registered Nix-Gen finger, but Nix-Gen will not invent a terminal executor merely to mark the finger available. The same rule applies to cross-chain, funding, maker and solver paths as their upstream capabilities evolve.

## Research-only limbs

- **CognitiveFabric:** general 4JI cognition remains outside canonical financial truth and the live execution hot path. It may support offline research but cannot create economics/execution evidence.
- **HHL/quantum:** HHL is relevant only to mathematically suitable linear-system subproblems. It is not a generic combinatorial allocation engine. Classical Nix-Gen remains the mandatory production baseline and fallback.

## Research basis

The implementation map in `scripts/cryptocrawl/nix-gen-research-map.txt` records the public/declassified engineering basis used here: Stanford/Boyd resource allocation and dual pricing, NASA/JPL continuous planning and iterative repair, DARPA scalable uncertainty-aware planning, MIT robust/congestion-aware optimization, Sandia time-critical scheduling, online resource-constrained learning, market-impact-aware execution, smart order routing, combinatorial batch allocation, private/atomic routing and deterministic classical solver fallbacks.

Public/declassified research informs architecture; it does not become runtime authority.

## No-regression laws

1. One authority per responsibility.
2. No synthetic economics, liquidity, fills, settlement, provider health or learning evidence.
3. Unknown critical evidence is never converted to zero.
4. Non-positive canonical economics are never promoted by Nix-Gen.
5. Expired opportunities cannot be selected.
6. An authoritative settlement-capable execution path must already exist for a live strategy limb.
7. Resource projections are advisory; canonical lease acquisition remains hard truth.
8. Valid profitable non-selected bids are deferred, not vetoed.
9. Profit/confidence evidence cannot be double-counted through recycled composite scores.
10. QuantiComp, dual pricing, uncertainty analysis and research limbs are never mandatory dependencies for core classical allocation.
11. Nix-Gen does not access signer secrets, submit transactions, or become treasury authority.
12. Every slice remains independently useful and removable without breaking existing production behavior.

Implementation completion does not claim live operational proof, future profitability, or completion of upstream strategy executors outside Nix-Gen's authority boundary.
