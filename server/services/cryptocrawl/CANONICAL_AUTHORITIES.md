# CryptoCrawler Canonical Authorities

This file is the architectural source of truth for CryptoCrawler. If another module appears to perform one of these responsibilities, it is either a compatibility facade, research/legacy code, or a defect to be reconciled.

## Authority map

| Responsibility | Canonical authority | Notes |
| --- | --- | --- |
| Runtime lifecycle | `integration/canonical-runtime-wiring.ts` | Starts measured runtime services only; grants no execution authority. |
| Market intelligence | Cryptara via `integration/cryptara-assessment-wiring.ts` | Deterministic all-in economics precede stochastic analysis. |
| Opportunity state | `intelligence/canonical-opportunity-state.ts` | Single canonical opportunity snapshot/eligibility state. |
| Measured discovery | `discovery/opportunity-graph.ts`, `discovery/multi-topology-discovery-controller.ts`, `discovery/measured-candidate-registry.ts` | No synthetic candidate evidence. |
| Heavy compute | QuantiComp | Computational Beam names are compatibility/routing facades; QuantiComp owns heavy execution of compute workloads. |
| Monte Carlo | `integration/authoritative-monte-carlo-wiring.ts` + `execution/adapters/monte-carlo-profitability.ts` | Seeded, policy-bound, measured/calibrated uncertainty model. `validation/monte-carlo-engine.ts` is not live authority. |
| Economic verification | `arbitrage/arbitrage-verifier.ts` | Verified positive all-in economics required before risk/MC can authorize consideration. |
| Execution scheduling | `execution/canonical-execution-scheduler.ts` | Consumes only canonical eligible measured opportunities. |
| Execution | `execution/index.ts` verified plan path plus topology-specific canonical executors | Governance and resource gates remain mandatory. |
| Resource ownership | `execution/resource-scheduler.ts` and topology-specific nonce/rate authorities | Cross-replica ownership must fail closed. |
| Governance | `governance/` | Stage, risk, kill-switch and execution governance are non-negotiable. |
| Emergency halt | `governance/kill-switch.ts` | Canonical governance/risk only; no Eden/LuxSwarm dependency. |
| Settlement | normalized settlement observers/types under `execution/` | Broadcast/submission is never settlement. |
| Learning feedback | terminal settlement feedback path | Settlement precedes learning; feedback identity is exactly-once guarded. |
| Scaling | canonical measured DynamicScale/pressure wiring | Scaling consumes measured search/profitability state, not simulated swarm load. |
| Provider access | `api/blockchain-providers.ts` plus venue-specific authenticated authorities | Provider health/readiness is measured and topology-specific. |

## Explicitly non-authoritative

Historical systems are isolated behind `legacy/index.ts`. This includes Eden/Cain/LuxSwarm, Starburst/Snake, old MasterOrchestrator, Enhanced Micro Crawler, Six-Cane/parallel intelligence, old validation Monte Carlo presets, legacy swarm/evolution systems, Divine Optimization, and related historical demos.

They may be retained for compatibility, research, migration, or forensic comparison, but they must not:

- authorize or submit live trades;
- fabricate fills, profit, settlement, provider health, or learning evidence;
- publish into canonical opportunity eligibility;
- override Cryptara, QuantiComp, governance, canonical execution, settlement, or terminal feedback;
- be imported by canonical runtime startup.

## Non-regression invariants

1. Unknown critical economics/cost/liquidity/execution evidence is never treated as zero.
2. Deterministic all-in `netProfitUsd > 0` is required before Monte Carlo/risk consideration.
3. IOC orders are taker orders.
4. Ranking is advisory; it is not eligibility authority.
5. Governance, circuit breakers, resource ownership, nonce/rate protection, and kill switch cannot be bypassed.
6. Submission/broadcast is not settlement.
7. Settlement precedes learning and terminal feedback is deduplicated.
8. No synthetic execution, fill, profit, settlement, relay, provider, or AI evidence may enter the canonical path.
9. One authority per responsibility.
10. A deployment is not considered proven without the exact deployed SHA and fresh runtime evidence.
