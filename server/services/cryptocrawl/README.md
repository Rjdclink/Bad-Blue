# CryptoCrawler

CryptoCrawler is a measured, governed multi-topology opportunity discovery and execution system. The production architecture is defined by [`CANONICAL_AUTHORITIES.md`](./CANONICAL_AUTHORITIES.md).

## Canonical lifecycle

```text
discover measured evidence
  -> verify all-in economics
  -> enrich / rank
  -> authoritative Monte Carlo uncertainty analysis
  -> governance + resource admission
  -> execute through topology-specific canonical executor
  -> observe normalized terminal settlement
  -> measure realized economics
  -> terminal feedback / learning
  -> governed adaptation and scaling
  -> repeat
```

The ordering is intentional. Deterministic all-in economics must be known and strictly positive before stochastic risk analysis can make an opportunity eligible for consideration. Submission or broadcast is not settlement, and learning does not occur before terminal settlement evidence.

## Current authorities

- **Runtime lifecycle:** `integration/canonical-runtime-wiring.ts`
- **Intelligence:** Cryptara through `integration/cryptara-assessment-wiring.ts`
- **Heavy compute:** QuantiComp. Computational Beam naming is compatibility/routing only.
- **Opportunity state:** `intelligence/canonical-opportunity-state.ts`
- **Measured discovery:** opportunity graph + multi-topology discovery + measured candidate registry
- **Monte Carlo:** `integration/authoritative-monte-carlo-wiring.ts` + `execution/adapters/monte-carlo-profitability.ts`
- **Economic verification:** `arbitrage/arbitrage-verifier.ts`
- **Scheduling:** `execution/canonical-execution-scheduler.ts`
- **Execution:** governed verified-plan/topology-specific executors under `execution/`
- **Governance and emergency halt:** `governance/`
- **Settlement:** normalized settlement observers/types under `execution/`
- **Learning:** terminal settlement feedback and measured learning/evolution wiring
- **Scaling:** measured DynamicScale/pressure wiring

## Public entry point

`server/services/cryptocrawl/index.ts` exports canonical authorities only.

Historical Eden/Cain/LuxSwarm/Starburst/Six-Cane/Divine systems are intentionally not exported by the canonical barrel. They are isolated under:

```text
server/services/cryptocrawl/legacy/index.ts
```

That entry point exists only for compatibility, migration, research, or forensic comparison. Legacy components have no live trading authority.

## Non-regression rules

1. **Unknown is not zero.** Missing critical fee, cost, liquidity, execution, provider, or settlement evidence fails closed.
2. **Economics before risk.** Verified all-in `netProfitUsd > 0` precedes Monte Carlo/risk consideration.
3. **IOC is taker.**
4. **One authority per responsibility.**
5. **Ranking is advisory.** It cannot make an ineligible opportunity executable.
6. **Governance is mandatory.** Stage gates, circuit breakers, resource ownership, nonce/rate protection, and kill switch cannot be bypassed.
7. **Submission is not settlement.**
8. **Settlement precedes learning.** Terminal feedback is deduplicated/exactly-once guarded.
9. **No synthetic truth.** Placeholder fills, profits, settlement, provider health, relay success, or AI evidence cannot enter the canonical path.
10. **Deployment truth requires evidence.** A release is not considered deployed until the exact deployed SHA and fresh runtime evidence are verified.

## Verification

Run the CryptoCrawler invariant gates, including:

```bash
node scripts/cryptocrawl/verify-clean-house.cjs
node scripts/cryptocrawl/verify-deployment-preflight.cjs
```

Other topology/economics/governance/settlement verification scripts remain part of the broader no-regression suite.

## Legacy documentation

Older documents that describe Eden swarms, Cain crawlers, Starburst replication, Six-Cane systems, Divine Optimization, simulated micro-crawlers, or old Monte Carlo presets describe historical/research architectures unless they explicitly reference the canonical authority map above. They must not be used as production operating instructions.
