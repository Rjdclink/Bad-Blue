# BPS Reduction Research and Implementation Blueprint — 2026-09-03

## Objective

Reduce **real all-in execution BPS** rather than relabeling spread. The controlled quantity is terminal execution cost: exchange fees/rebates/refunds, slippage and nonlinear market impact, quote/decision/control latency, adverse selection and non-fill/partial-fill cost, gas/relay/bridge/settlement friction, and avoidable capital-location cost.

Profit magnitude is never a rejection ceiling or target cap. A live candidate must be freshly and deterministically positive after measured all-in costs and retain the required hard execution facts. Historical scorecards and simulations may rank/reacquire/learn; they cannot veto a current hard-fact positive opportunity.

## Public-source research boundary

This blueprint is based on the broad **publicly accessible** research and engineering record. The search included public NASA/JPL, DARPA, NSA, FBI and CIA material; MIT, Stanford, Columbia, Oxford, Tsinghua, CUHK, HSE and other academic work; BIS/ESMA and other European/international material; Chinese, Russian, Indian and other foreign-market research; public deep-tech laboratories; current venue documentation; and public GitHub/open-source projects.

No classified, private laboratory or non-public government information is claimed. In this review, public NSA/FBI/CIA searches did not surface a directly applicable transaction-cost/BPS execution mechanism beyond the broader reliability, distributed-systems and assurance ideas already represented elsewhere. Absence of a useful public result is not converted into fictional evidence.

## Governing translation rule

External research is adopted only when it can be connected to a **measured project signal** and cannot introduce a second execution/economic authority. No paper, simulation, fee schedule, heuristic, model or optimizer is execution truth. Canonical truth remains:

1. fresh executable venue/chain state;
2. authenticated/current fee, rebate and product evidence;
3. executable depth and exact permitted size;
4. deterministic all-in economics;
5. hard inventory/resource/nonce/provider/governance/risk state;
6. canonical order/transaction submission;
7. terminal authenticated settlement and realized economics.

## Blueprint: highest-value mechanisms

### A. Fee/rebate/refund compression

- authenticated account/pair fee tiers rather than configured assumptions;
- exact preservation of genuine zero fees;
- signed maker rebates/refunds normalized once into economic cost convention;
- maker/taker/RPI selection from current realized or authenticated economics, never order-type labels alone;
- account/product fee-group discovery and bounded refresh without private-API request storms;
- realized fee/rebate attribution after settlement to prevent double counting.

### B. Queue, fill and order-control economics

- queue position is economic option value and must not be discarded casually;
- maker fill probability/time-to-fill should be conditioned on current market state;
- adverse selection, cancellation pressure, churn and order-flow imbalance matter to maker-vs-taker choice;
- atomic amend/queue-preserving changes are preferable where a venue proves the capability;
- submit/query/cancel control latency is a distinct execution-quality dimension, not just displayed-book latency;
- slow measured order control should trigger faster exact-state reacquisition, **not** a fabricated BPS charge.

### C. Fresh-state/receding-horizon execution

- repeatedly re-solve from fresh state instead of committing to stale parameters;
- positive raw anomalies get bounded independent reacquisition instead of immediate disposal;
- edge lifetime/half-life controls how aggressively scarce evidence work is scheduled;
- quote-age and control-latency pressure collapse sense-compute-act deadlines;
- regime/change-point detection invalidates stale assumptions after liquidity state changes.

### D. Size, depth and route optimization

- walk executable depth, not top-of-book alone;
- split only where exact smaller slices improve nonlinear impact while retaining positive economics;
- never pretend percentage fee BPS improves merely because notional was reduced;
- enforce current venue base/quote minima, increments and maxima on every parent/child;
- prefer FOK/price-capped immediate semantics when supported and economically appropriate to reduce partial-fill leakage;
- preserve maker/post-only semantics where passive execution is the proven lower-cost path;
- treat multi-venue/CFMM routing as an optimization problem over actual executable state.

### E. Inventory and settlement-location optimization

- pre-positioned inventory may remove transfer/rebalance cost but never erases actual trade fees;
- each surplus/deficit unit may be netted/consumed once;
- distributed/cooperative demand netting should reduce avoidable movement before paying withdrawal/bridge costs;
- retained capital must remain exact system-owned spendable inventory;
- deferred rebalance is allowed only where network, address, fee, latency and terminal settlement are proven.

### F. Robust optimization and learning

- CVaR/tail-cost, conformal/robust bounds and Monte Carlo are search/ranking/calibration tools;
- cold-start simulation may prioritize evidence acquisition but cannot manufacture permission to trade;
- deterministic positive hard-fact execution cannot be vetoed by Monte Carlo probability, Sharpe, win rate, trade count or uptime history;
- terminal realized residuals train future scheduling/allocation;
- failed or inaccurate tactics lose bounded compute allocation; successful predictive tactics earn bounded allocation;
- exploration remains alive so one optimizer path cannot create a blind spot.

### G. Compute/data-path efficiency

- single canonical live book per venue/symbol;
- ordered deltas never silently dropped; overload invalidates/resnapshots affected state;
- no stale long-TTL cache for mutable market state;
- single-flight/private API pacing and resource scarcity aware scheduling;
- CPU-heavy simulation/features may use parallel workers/Quanti/Beam; tiny ordered book updates stay on the lowest-latency proven path;
- duplicate work is collapsed before consuming scarce API/database/compute capacity.

## Twenty-five implemented research tactic primitives

1. **Sequential probability recheck** — retry large incomplete edges with bounded fresh evidence rather than discarding a single observation.
2. **Cross-venue consensus reacquisition** — reacquire independent books to distinguish a real dislocation from one-venue quote corruption.
3. **Quote survival hazard budget** — spend revalidation effort before an observed edge is likely to decay.
4. **Stochastic-delay marketable-limit cap** — incorporate latency-aware price-capped immediate execution as an execution-surface concept.
5. **Queue option-value preservation** — treat preserved maker queue priority as economic value.
6. **Self-exciting fill-intensity priority** — use order-arrival intensity as a maker-fill scheduling signal.
7. **Order-flow horizon switch** — change passive/aggressive urgency when current order flow makes waiting costly.
8. **Hidden-liquidity regime filter** — avoid applying calm-market execution assumptions after a liquidity regime shift.
9. **Liquidity replenishment resilience probe** — test exact smaller size when nonlinear impact/replenishment can reduce BPS.
10. **Distributionally robust cost envelope** — rank tactics under plausible model misspecification.
11. **Conformal execution-cost bound** — use calibration error to bound cost uncertainty without inventing deterministic costs.
12. **CVaR tail-cost tactic rank** — penalize execution tactics with poor cost tails even when the mean looks acceptable.
13. **Cross-entropy rare-positive search** — concentrate bounded search on tactic parameters that repeatedly approach positive execution.
14. **Knowledge-gradient tactic sampling** — spend scarce quote/API/compute work where the expected information gain is highest.
15. **Receding-horizon execution replan** — continually re-solve from fresh state instead of committing to stale parameters.
16. **Minimum-cost inventory flow** — prefer routes using already-located inventory when it removes transfer/settlement BPS.
17. **Distributed opportunity netting** — net compatible capital demands before paying avoidable movement costs.
18. **Convex multi-venue split** — probe smaller exact slices when one large route would walk expensive depth.
19. **Diverse tactic portfolio** — retain genuinely different recovery tactics rather than one correlated optimizer path.
20. **Execution digital-twin replay** — use measured residuals to replay candidate tactics before another expensive live evidence cycle.
21. **Squeaky-wheel near-miss reprioritization** — feed repeated near misses back into scheduling priority.
22. **Liquidity change-point reset** — force fresh evidence when the liquidity process changes structurally.
23. **Passive/aggressive optimal-stopping boundary** — treat maker waiting versus aggressive hedging as state-dependent.
24. **Sense-compute-act deadline collapse** — place time-critical evidence computation in the hot path to reduce stale-edge loss.
25. **Settlement-location friction optimizer** — include capital location and settlement path when comparing otherwise similar execution routes.

## Direct project implementation

`research-bps-execution-tactics.ts` contains exactly 25 measured tactic primitives. Their output is scheduling/revalidation authority only. Quanti Comp/Beam may execute deadline-aware Monte Carlo search, including advisory analysis of zero/negative baselines, but simulation cannot approve or reject the current deterministic trade.

`bps-reduction-super-engine.ts` owns bounded BPS attribution, edge-life learning, consensus weighting, tactic synergies, residual-size probes and realized prediction-error feedback. It has no order submission authority and cannot synthesize profitability.

`bps-compression-mesh.ts` combines current CEX four-mode economics, zero-capital recovery distance, authenticated fee surfaces and measured resource scarcity into search/compute allocation. It changes attention, breadth and cadence—not canonical economics.

`economic-transformation-wiring.ts` turns near-miss/advisory output into real work:

- raw positive cross-venue observations enter bounded exact-symbol canonical reassessment;
- large apparent anomalies receive multiple fresh attempts rather than one-and-done disposal;
- exact-symbol reassessment reacquires executable books, authenticated fees, product constraints and depth-aware sizing;
- nonlinear slippage/latency/fixed-cost cases can generate exact smaller-notional residual replans;
- percentage-fee-dominated gaps are not cosmetically improved by shrinking notional;
- current TT/MT/TM/MM near misses are promoted into bounded fresh recovery work.

`cex-order-control-health.ts` plus `post-only-maker-adapters.ts` now retain bounded real Coinbase/Kraken/OKX submit/query/cancel RTT evidence. Once enough measured samples exist, excessive p95 control latency can trigger a cooldown-bounded exact-symbol canonical revalidation. This is scheduling evidence only: it cannot add a synthetic latency BPS penalty, block a trade, or finalize settlement.

`centralized-exchange-executor.ts` now keeps Monte Carlo **off the critical execution path**. A hard-fact deterministic-positive plan proceeds through inventory, current notional authority, freshness, governance, product/depth and terminal settlement protections while Monte Carlo runs concurrently for future calibration/ranking. Simulation failure or a low simulated probability cannot consume edge lifetime or veto the current trade.

## Representative research basis repeatedly cross-checked

- **NASA/JPL Mars 2020 scheduling:** simulation-driven priority optimization and robust rescheduling under uncertain execution; motivates receding-horizon/squeaky-wheel scheduling, not simulation execution authority.
- **DARPA DICE/RSPACE/AIR/FunCC/Assured Autonomy/SCEP and related programs:** distributed local control, uncertainty-aware adaptive planning, continual runtime assurance and large state/action-space exploration with high-fidelity validation.
- **BIS fragmented-market/execution-algorithm research:** venue aggregation and execution splitting can reduce impact, while fragmentation also increases tail fragility and demands explicit liquidity-state management.
- **ESMA best execution:** total consideration includes price, costs, speed, likelihood of execution/settlement and size rather than quoted price alone.
- **Columbia/Moallemi-Yuan and fill-probability research:** queue position, time-to-fill and adverse selection have measurable economic value.
- **Oxford stochastic-delay execution:** latency-aware marketable-limit price caps and timing can improve execution relative to static actions.
- **Stanford/Boyd model-predictive trading:** plan ahead but execute/re-solve from current state; transaction and holding costs belong inside the control problem.
- **Angeris/Evans/Chitra/Boyd CFMM routing:** multi-venue routing and arbitrage can be represented as convex optimization subject to real venue constraints.
- **Devanathan/Bell/Rueter/Boyd (2026):** distributed convex trade-list adjustment/netting can reduce aggregate transaction costs after only limited coordination.
- **Tsinghua/UCLA China government-bond research:** venue selection itself can create measurable transaction-cost differences.
- **HSE/Russian LOB research:** state-aware point-process/queue-reactive models can outperform static event assumptions for book/fill dynamics.
- **CUHK/IE 2026 order-control disruption study:** displayed liquidity is insufficient when traders lose timely control over outstanding orders; fixed-notional execution cost worsened materially during impaired control.
- **Coinbase Advanced Trade:** current price-capped IOC/FOK/limit order surfaces.
- **Kraken:** Level-3/individual-order information and atomic amend/queue-preservation capabilities where entitled.
- **OKX:** IOC/FOK/post-only/RPI, current fee groups, RPI access and consolidated `books-rpi` surfaces where account/product capability proves availability.
- **ABIDES and other public market simulators:** useful for replay/latency experiments, never a source of live execution truth.
- **Hummingbot/public SOR projects:** useful implementation comparisons for order lifecycle/routing; arbitrary configured profitability floors are deliberately not imported into this system.

## Recheck checklist — no-regression BPS authority

A BPS change is incomplete unless all answers below are **yes**:

- Does every actual saving enter the same canonical measured economics exactly once?
- Are rebates/refunds signed and realized without being double counted?
- Are discovery-only/raw spreads prevented from masquerading as executable net BPS?
- Are missing fee/depth/product/settlement facts actively reacquired rather than silently assumed?
- Are TT/MT/TM/MM and zero-capital routes compared using the current relevant execution surface?
- Does notional reduction occur only when it can change nonlinear costs rather than percentage fees?
- Are inventory netting and capital-location savings kept separate from actual fill fees?
- Are advisory optimizers, Monte Carlo, provider quality and research tactics unable to submit/veto trades independently?
- Can slow measured order control accelerate exact revalidation without inventing economic cost?
- Is terminal settlement the only realized P/L truth?
- Is retained/payout capital derived only after terminal confirmed profit?
- Is the current build/preflight able to detect restoration of duplicate authorities?

## No-regression boundary

The BPS system never enables live execution posture by itself, never overrides deterministic positive all-in economics, never fabricates a fee/rebate, depth value, fill, settlement or profit, and never converts a historical model into current-market truth. Its purpose is to make the canonical system **reacquire, transform, replan, route and revalidate faster and more intelligently** until a genuinely lower-cost executable candidate is either proven or disproven.
