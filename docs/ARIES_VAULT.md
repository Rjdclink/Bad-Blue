# Aries Vault

Aries Vault is CryptoCrawler's horizon-aware profitability and execution-intelligence layer. It combines the fee/execution architecture with the advanced discovery, attention, causal, evolutionary, capacity and capital-allocation architecture under one measurable objective:

> Maximize horizon-adjusted, risk-adjusted, terminal-confirmed realized profit per unit of capital-time and compute, subject to liquidity, execution, governance and settlement constraints.

## Governing invariants

1. **No regression.** Aries Vault is an additional decision/intelligence layer. It does not bypass existing stage governance, product constraints, inventory reconciliation, private API authority, circuit breakers, post-only constraints, terminal settlement or payout truth.
2. **Unknown critical costs fail closed.** Unknown gas, transfer, material slippage/impact, fee or settlement cost is not silently treated as zero when it is economically material.
3. **Observed fee authority beats static assumptions.** Venue fee/tier state is evidence, not a hard-coded promise.
4. **No unprofitable volume churn.** A deliberate near-term loss may only be surfaced for review when conservative expected future fee savings exceed the loss and uncertainty haircut. A tier label alone never authorizes a loss.
5. **No hidden taker fallback.** A post-only path remains post-only. Hybrid maker/taker routing is a separate calculated capability and must be explicitly allowed by the execution path.
6. **Terminal truth remains sovereign.** Predicted, simulated, pre-confirmed or counterfactual outcomes never become realized profit until settlement is terminal and confirmed.
7. **No hostile bandwidth behavior.** The provider "beam/strobe" intent is implemented as bounded simultaneous fan-out, persistent connections, prioritization and caching, never as deliberate congestion or interference with third parties.

## Research translation

The specification intentionally draws from several research domains. Aries Vault keeps ideas that produce measurable decision value and translates metaphors into falsifiable engineering primitives.

### Market microstructure and optimal execution

Limit-order queue position, fill probability, adverse selection and opportunity cost are first-class costs. This follows the established microstructure literature on queue-position valuation and optimal limit/market order placement. The current implementation exposes continuous hybrid maker/taker allocation, while existing post-only execution paths can force taker share to zero.

The book walker evaluates executable depth instead of relying only on top-of-book. Market impact/capacity is represented as a notional-to-net-BPS curve; the **Liquidity Event Horizon** is the largest tested size for which marginal expected economics remain positive.

### Dynamic fee-tier state

`projectAriesTierState()` accepts rolling 14/30-day venue notional and a venue's measured tier schedule. It projects the next tier, distance to its threshold and the conservative expected value of a tier transition. It explicitly prevents fee-tier chasing from becoming an independent reason to execute an expected-loss trade.

### Topological / graph discovery

True persistent homology requires a point-cloud/filtration history. The first implementation therefore exposes an explicitly named **topology proxy** using changes in spread, depth, imbalance and cross-provider dispersion rather than falsely claiming a full persistent-homology computation from two quotes. This is an integration point for a future persistent-homology worker when a sufficiently deep order-book history is available.

Graph tension similarly represents measurable changes in provider dispersion, cancellation intensity and optional mempool pressure. A future graph-signal worker can substitute spectral features without changing the decision interface.

### Event-driven / neuromorphic attention

Spiking-neural-network research supports sparse, event-driven computation and has been applied to multimodal financial time series. Aries Vault implements the software-side economic primitive now: temporal novelty creates an attention "spike" so compute can be moved toward informative market changes rather than polling every symbol uniformly. Literal neuromorphic power claims are not assumed on ordinary Railway hardware.

### Thermodynamic/exergy metaphor

Landauer energy is not used as a trading-cost authority. The useful economic translation is:

`economic exergy = latency-adjusted gross edge - irreversible execution costs`

and

`efficiency coefficient = economic exergy / latency-adjusted gross edge`.

Irreversible costs are fees, expected adverse selection, non-fill opportunity cost, impact and any supplied fixed material costs.

### Quantum-probability metaphor

No quantum-computing claim is made. `evaluateAriesStateLattice()` represents simultaneous possible market outcomes as a normalized probabilistic state lattice. New evidence can update state probabilities upstream; the Vault consumes expected payoff and tail loss. Strategy "interference" is represented through joint route/portfolio economics, covariance and capital conflict in higher-level callers rather than physical wave-function claims.

### Evolutionary Beam

`rankAriesBeam()` ranks candidate execution policies by expected profit plus future fee-tier/capital value minus tail risk, uncertainty, capital-time and compute costs. This is the deterministic selection surface for adaptive Monte Carlo and future genetic mutation/crossover workers. Compute is not spent merely to reach a fixed simulation count.

### Game-theoretic robust execution

`chooseAriesRobustRoute()` evaluates routes under multiple plausible scenarios using a regret-penalized robust score: average scenario BPS minus maximum scenario regret, with worst-case BPS as a secondary preference. This is intentionally more practical than claiming a fully-known Nash equilibrium against thousands of unknown bots. On-chain use must remain legitimate MEV-aware/protected routing, not evasion or interference.

### Counterfactual learning and value of information

Every settled outcome can eventually be compared to modeled alternatives. `computeAriesCounterfactualRegret()` measures the edge left on the table even when the actual trade was profitable. `computeAriesExpectedValueOfInformation()` estimates whether another quote/simulation/provider request can materially change the decision before consuming more compute.

## Current implementation surfaces

`server/services/cryptocrawl/intelligence/aries-vault.ts` provides:

- dynamic fee-tier projection and conservative transition economics;
- continuous Crossover Taker Share economics;
- latency-decayed spread survival;
- walking-the-book capacity and impact;
- topological/graph/temporal novelty scoring;
- probabilistic market-state lattice;
- evolutionary Beam ranking;
- marginal capital-efficiency ranking for Rainbow allocation;
- regret-penalized robust route selection;
- counterfactual execution regret;
- expected value of information;
- liquidity event-horizon sizing;
- fail-closed composite opportunity assessment;
- shared Kraken/OKX maker-recovery capability classification.

The economic-barrier diagnostic is wired to that shared maker-recovery classifier so volatile Kraken/OKX routes are no longer incorrectly described as stablecoin-only. This classifier reports that the architectural route exists; actual volatile admission still remains governed by the existing maker strategy's authenticated fees, configurable spread floor, product constraints, measured books, dynamic canary, Hyper Monte Carlo and governance gates.

`server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts` also wires Aries into every measured Cryptara plan as a **live horizon advisory**. It evaluates the measured plan against holding capital using expected profit, Monte Carlo probability and uncertainty, and emits the Beam preference, probability-adjusted expected realized BPS and expected value of additional information into Cryptara provenance. This integration is deliberately non-authoritative: it does not change the existing recommendation or bypass the current execution gates while Aries accumulates calibration evidence.

## Research basis reviewed for this implementation

The engineering design was checked against current/relevant work including:

- Moallemi & Yuan, *A Model for Queue Position Valuation in a Limit Order Book* — queue value and adverse-selection economics.
- Maglaras, Moallemi & Zheng, *Optimal Execution in a Limit Order Book and an Associated Microstructure Market Impact Model* — joint limit/market execution and microstructure impact.
- Garriott, van Kervel & Zoican, *Queuing and inventories in limit order markets* (Journal of Financial Markets, 2025) — queue position, adverse selection and inventory risk.
- Barzykin, Boyce, Neuman & Tuschmann, *Optimal Execution with Passive Market Impact* (2026) — fill probability, quote distance, adverse selection and passive execution.
- Zhou, Chen & Wei, *Order Splitting and Liquidity Replenishment Are Jointly Necessary for the Square-Root Law of Market Impact* (2026) — capacity/impact behavior and the danger of treating visible book shape alone as impact truth.
- AbouHassan et al., *Spiking neural networks for predictive and explainable modelling of multimodal streaming data with a case study on financial time series and online news* (Scientific Reports, 2023) — event-driven financial time-series modeling.
- Wei et al., *Event-Driven Learning for Spiking Neural Networks* (2024) — sparse event-driven learning and energy-efficiency evidence on neuromorphic hardware.

These references justify the measurable primitives; they do **not** justify guaranteed profitability, sub-millisecond performance on Railway, quantum advantage, or literal thermodynamic/black-hole claims.

## Review gates before live authority expands

Aries Vault's composite assessment has `executionAuthority: false`, and the live Cryptara integration is advisory-only. Expanding Aries into direct live hybrid routing or autonomous capital movement requires measured integration evidence for authenticated fees/tier state, real order-book depth, maker fill probability/queue behavior, slippage/adverse-selection calibration, inventory availability, stage governance and terminal settlement. Existing live gates remain authoritative until those measurements prove the new route does not regress execution safety or profitability.
