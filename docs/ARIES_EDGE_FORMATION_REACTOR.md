# Aries Edge Formation Reactor

## Objective

The Edge Formation Reactor changes the optimization target from merely reducing execution drag to increasing the rate at which CryptoCrawler discovers genuinely executable high-dislocation opportunities while preserving terminal-confirmed profit truth.

The reactor does **not** create market edge by assumption. Its job is to search more expressive route topologies, direct scarce quote/compute resources toward likely edge formation, optimize measured size curves, and attribute lost edge after the fact. Profitability remains a measured property of live quotes and settlement.

## Governing invariants

1. **No regression.** Existing configured CEX and zero-capital routes remain available. New attention scores only allocate scan/quote work; they cannot authorize execution.
2. **No new DEX API keys.** Graphless discovery remains direct-RPC first with optional public no-key scouts.
3. **No synthetic profitability.** Historical survival, value-of-information, fragmentation, negative-cycle math, or model predictions never become deterministic profit evidence.
4. **Atomic zero-capital truth.** DEX flash-loan execution must still return to the borrowed asset, clear all-in costs, pass receiver permissions, receive a fresh quote after permission mutation, pass exact receiver simulation, Cryptara/Monte Carlo/governance, and terminal settlement verification.
5. **No market manipulation.** The design can model observable competitor/market behavior but does not spoof, induce, congest, sandwich, or exploit private exchange infrastructure.
6. **Stage authority remains sovereign.** Stage 1 remains non-executable; prediction and simulation cannot satisfy realized-profit gates.

## Implemented surfaces

### 1. Triangular graphless DEX expansion

`dynamic-zero-capital-routes.ts` now adds bounded three-leg cycles of the form:

`USDC/USDT -> token A -> token B -> USDC/USDT`

The intermediate token set comes from the same no-key graphless scout already used for two-leg routes. Candidate pairs are bounded and liquidity-ranked when public liquidity information exists. Every generated path is still passed through direct Uniswap V3/SushiSwap quoting. Unsupported A/B edges or insufficient liquidity fail closed.

The existing two-leg USDC/USDT seed routes, volatile two-leg routes, and same-Uniswap-V3 fee-tier routes are retained unchanged as fallback/search coverage.

### 2. Edge survival and information-value quote allocation

`aries-edge-formation-reactor.ts` records only measured route attempts and deterministic-positive outcomes. It estimates:

- smoothed positive probability;
- empirical positive-run half-life;
- probability an edge survives the configured decision horizon;
- value of another quote using uncertainty × economic consequence / quote cost;
- a bounded advisory priority multiplier.

`zero-capital-route-preselection.ts` multiplies its existing measured exploitation score by this bounded formation multiplier. Deterministic oldest-first exploration is still reserved so high-scoring routes cannot permanently starve the rest of the structural universe.

### 3. CEX formation attention

`cex-edge-attention.ts` replaces arbitrary first-N symbol selection with a deterministic exploration/exploitation scheduler. It always preserves bounded exploration and the configured symbol, while directing remaining scan slots toward symbols with recent positive evidence, freshness, and high information value.

The scheduler chooses **what to measure**, not what to trade. `arbitrageVerifier`, authenticated fees, product constraints, inventory, governance, and settlement remain downstream authorities.

### 4. Negative-cycle primitive

The reactor includes Bellman-Ford negative-cycle detection over **dimensionless, decimal-normalized, already measured effective rates**. It is deliberately not granted live execution authority. A detected mathematical cycle is only a search hint until the exact route receives fresh direct quotes and all normal zero-capital gates.

### 5. Liquidity-curve and regret primitives

The reactor exposes:

- measured notional-curve optimization by maximum positive net dollars;
- local marginal-profit slope;
- maximum positive measured notional;
- fragmentation scoring;
- edge decomposition into fee, impact, latency, adverse selection, gas, relay, sizing, routing, and competition losses;
- observable edge capture ratio and counterfactual regret when a best contemporaneously executable alternative is available.

These primitives are designed for later settlement/replay wiring without fabricating missing counterfactual evidence.

## Research basis

The implementation uses classical methods where they are stronger than metaphor:

- Angeris, Evans, Chitra & Boyd, *Optimal Routing for Constant Function Market Makers* (EC 2022): multi-CFMM routing can be formulated as convex optimization when fixed costs are ignored; arbitrage identification is a special case. This supports future exact/convex routing underneath the discrete route selector.
- Bacry, Mastromatteo & Muzy, *Hawkes processes in finance* and related market-microstructure work: self- and cross-exciting event processes are appropriate for order-flow timing, full-book dynamics, and optimal execution research.
- 2026 Bitcoin LOB work using multivariate Hawkes processes reports that event timing plus book imbalance can improve short-horizon return-sign forecasting relative to a pure Hawkes baseline. This supports treating event timing/imbalance as predictive evidence, not certainty.
- Barzykin et al., *Optimal Execution with Passive Market Impact* (2026): passive execution requires balancing fill probability, adverse selection, and opportunity cost rather than assuming maker is always better.

The "quantum", "time-crystal", entropy, and thermodynamic language from the enhancement specification is translated into measurable classical primitives: combinatorial route search, recurrent temporal structure, information value, and irreversible execution-cost accounting. No quantum-computing or exotic-physics profitability claim is made.

## Performance objective

The target is **not** a guaranteed +100 BPS per trade. The reactor is intended to increase:

- `Edge Formation Rate`: executable opportunities above a selected BPS threshold per unit time;
- `Observable Edge Capture Ratio`: terminal realized net BPS divided by the best contemporaneously executable measured net BPS.

An improvement is only credited after live measured evidence shows more/larger deterministic-positive candidates or better terminal-confirmed capture. Estimated potential must remain labeled as estimated until then.
