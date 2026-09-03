# BPS Reduction Research and Implementation — 2026-09-03

## Objective

Reduce **real all-in execution BPS** rather than relabeling spread. The controlled quantity is terminal execution cost: exchange fees/rebates, slippage/impact, latency decay, adverse selection/non-fill cost, gas/relay/bridge/settlement friction, and avoidable capital-location cost. Profit magnitude never becomes a rejection ceiling, but every executable candidate must still be freshly positive after measured all-in costs.

## Research scope

The implementation review crossed market microstructure, stochastic control, optimal routing, high-frequency limit-order-book research, distributed optimization, rare-event simulation, execution algorithms, autonomous planning and real-time control. Representative sources reviewed include DARPA programs on AI-native tactics, market repair, controlled multi-agent emergence and real-time adaptive control; NASA/JPL Mars 2020 simulation-driven scheduling under uncertain execution; MIT/Oxford/Columbia/Stanford and European stochastic-control/market-microstructure work; BIS/ESMA best-execution and fragmented-market studies; Indian NSE algorithmic-trading research; Tsinghua/CUHK Chinese transaction-cost and liquidity work; HSE Russian limit-order-book/Hawkes research; and current Coinbase/Kraken/OKX execution API capabilities.

The research is translated only when it can be made measurable. No paper, simulation, fee schedule or heuristic is execution truth. Fresh exchange books, authenticated account fees, product constraints, executable depth, deterministic all-in economics, Cryptara/Monte Carlo, governance, inventory/resource authority and terminal settlement remain canonical.

## Twenty-five new tactic primitives

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

## Direct implementation

`research-bps-execution-tactics.ts` contains exactly 25 measured tactic primitives. Their output is scheduling/revalidation authority only. Quanti Comp executes a deadline-aware tactic Monte Carlo workload; `runProfitabilityMonteCarlo(... advisoryOnly: true)` can analyze a zero/negative baseline but cannot approve it. The resulting probability/tail metrics only allocate recovery work.

`economic-transformation-wiring.ts` is no longer a logging terminus:

- any **raw cross-venue positive observation** registered as discovery-only immediately enters bounded exact-symbol canonical reassessment;
- a large apparent anomaly receives multiple fresh attempts rather than one-and-done disposal;
- exact-symbol reassessment obtains fresh executable books, authenticated fees, product constraints, depth-aware sizing and deterministic all-in economics; if deterministic positivity survives, the existing Cryptara/Monte Carlo path runs before eligibility;
- measured transformation advice now triggers canonical revalidation instead of only being printed;
- nonlinear slippage/latency/fixed-cost cases can generate an exact smaller-notional `queueCexResidualReplan`, which independently fetches fresh quotes/depth/fees and returns to the eligible queue only after Cryptara/Monte Carlo approval;
- percentage-fee-dominated gaps are **not** cosmetically reduced by shrinking notional, because proportional fee BPS do not improve that way;
- the current CEX TT/MT/TM/MM near-miss portfolio is promoted from logging into bounded fresh canonical recovery work.

## Representative research basis

- DARPA IMR: automated market modeling, weakness identification and model repair.
- DARPA DISCORD: live-data + high-fidelity simulation producing a portfolio of diverse adaptive tactics.
- DARPA AIR/DICE/real-time control programs: uncertainty-aware models, distributed autonomous behavior and resilient adaptive execution concepts.
- NASA/JPL Mars 2020 scheduler: Monte Carlo simulation used to optimize priorities and rescheduling robustness; simulation-driven search outperformed static heuristics and motivated squeaky-wheel reprioritization.
- Cartea & Sanchez-Betancourt, *Optimal Execution with Stochastic Delay*: latency-aware marketable-limit price caps and timing.
- Moallemi & Yuan, *A Model for Queue Position Valuation in a Limit Order Book*: queue position has measurable economic option value and adverse-selection consequences.
- Bechler & Ludkovski, *Optimal Execution with Dynamic Order Flow Imbalance*: execution horizon should respond to order-flow state.
- Ackermann, Kruse & Urusov and later stochastic-liquidity work: depth/resilience are stochastic and should influence execution timing/size.
- Hawkes-process LOB research and recent HSE work: event intensity can model execution-time/fill dynamics.
- Angeris/Evans/Chitra/Boyd: multi-venue/CFMM optimal routing can be formulated as convex optimization; arbitrage is a special case.
- Devanathan/Bell/Rueter/Boyd (2026): distributed convex adjustment can materially reduce transaction costs through trade-list netting.
- BIS execution-algorithm and fragmented-market research: aggregating venues and splitting execution can reduce market impact, while fragmentation and fragile liquidity must be explicitly managed.
- ESMA best-execution framework: evaluate total consideration including price, costs, speed, likelihood of execution/settlement and size.
- NSE/IIM research: algorithmic participation can lower transaction costs/deepen liquidity; queue competition and order-flow composition materially alter liquidity supply.
- Tsinghua/UCLA China government-bond study: venue selection itself produced measurable transaction-cost differences.
- CUHK/IE 2026 Hyperliquid disruption study: displayed liquidity without order control increased fixed-notional execution cost materially, supporting control-state evidence rather than quote-only assumptions.
- Kraken API: Level-3 data exposes individual orders/queue information; atomic amend can preserve queue priority.
- Coinbase Advanced Trade: IOC/FOK/limit fulfillment policies support price-capped immediate execution surfaces where available.
- OKX: FOK/IOC/post-only/RPI capabilities, slippage controls and amend semantics provide multiple measurable execution surfaces subject to current account/product eligibility.

## No-regression boundary

The new layer never directly submits an order, never enables live execution posture, never overrides deterministic positive all-in economics, never treats Monte Carlo as a profit generator, and never fabricates a fee/rebate, depth value, fill, settlement or profit. Its purpose is to **make the system do the missing work**: reacquire, transform, replan and revalidate until a genuinely lower-cost executable candidate is either proven or disproven.
