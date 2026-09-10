# CryptoCrawler Canonical Authorities

This file is the architectural source of truth for CryptoCrawler. If another module appears to perform one of these responsibilities, it is either a compatibility facade, research/legacy code, or a defect to be reconciled.

## Authority map

| Responsibility | Canonical authority | Notes |
| --- | --- | --- |
| Runtime lifecycle | `integration/canonical-runtime-wiring.ts` | Starts measured runtime services only; grants no execution authority. |
| Market intelligence | Cryptara via `integration/cryptara-assessment-wiring.ts` | Deterministic all-in economics precede stochastic analysis. |
| Opportunity state | `intelligence/canonical-opportunity-state.ts` | Single canonical opportunity snapshot/eligibility state. |
| Measured discovery | `discovery/opportunity-graph.ts`, `discovery/multi-topology-discovery-controller.ts`, `discovery/measured-candidate-registry.ts` | No synthetic candidate evidence. |
| Zero-capital discovery/economics | `core/zero-capital-engine.ts` plus the measured zero-capital quote/provider evidence helpers | Produces fresh measured `ZERO_CAPITAL_ATOMIC` evidence only. It must not own an independent trade scheduler or bypass canonical candidate admission. |
| External capital classification/composition | `optimization/external-capital-capability-registry.ts` plus `optimization/zero-capital-capital-fabric.ts` | Advisory only. Debt assumption, delegated credit, signed-intent principal, netting, compatible vault credit and protocol-native transient settlement become usable only after fresh measured capacity/cost and an exact canonical adapter are proven. No synthetic liquidity or second execution authority. |
| Ghost Wallet credit intermediation | deployed `contracts/cryptocrawl/CryptocrawlGhostWalletIntermediary.sol` plus `ghost-wallet/ghost-wallet-engine.ts` observer | Separate borrower-initiated on-chain lane. Principal + fee and delegated debt neutrality are enforced in one transaction; failure reverts. Realized surplus routes directly to the canonical primary wallet. No arbitrage Profit Ladder, exchange schedule, or off-chain transaction-submission authority. |
| Heavy compute | QuantiComp | Computational Beam names are compatibility/routing facades; QuantiComp owns heavy execution of compute workloads. |
| Monte Carlo | `integration/authoritative-monte-carlo-wiring.ts` + `execution/adapters/monte-carlo-profitability.ts` | Seeded, policy-bound, measured/calibrated uncertainty model. `validation/monte-carlo-engine.ts` is not live authority. |
| Economic verification | `arbitrage/arbitrage-verifier.ts` and topology-specific measured all-in verification feeding the canonical candidate state | Verified positive all-in economics required before risk/MC can authorize consideration. |
| Execution scheduling | `execution/canonical-execution-scheduler.ts` | Sole live parent-trade scheduling authority for every CryptoCrawler trading topology, including `ZERO_CAPITAL_ATOMIC`. No topology owns a parallel scheduler. Borrower-triggered Ghost Wallet lending is a separate contract service, not an arbitrage/trading topology or scheduler. |
| Execution | `execution/index.ts` verified plan path plus topology-specific canonical executors called only beneath `execution/canonical-execution-scheduler.ts` | Governance and resource gates remain mandatory. Topology executors may execute an already-admitted exact candidate; they may not self-schedule. |
| Resource ownership | `execution/resource-scheduler.ts` and topology-specific nonce/rate authorities | Cross-replica ownership must fail closed. |
| Governance | `governance/` | Stage, risk, kill-switch and execution governance are non-negotiable for CryptoCrawler trading. Ghost Wallet contract safety is enforced by its own owner/pause/reentrancy/atomic-repayment boundary and does not borrow Profit Ladder authority. |
| Emergency halt | `governance/kill-switch.ts` | Canonical governance/risk only; no Eden/LuxSwarm dependency. |
| Settlement | normalized settlement observers/types under `execution/` | Broadcast/submission is never settlement. |
| Learning feedback | terminal settlement feedback path | Settlement precedes learning; feedback identity is exactly-once guarded. |
| Scaling | canonical measured DynamicScale/pressure wiring | Scaling consumes measured search/profitability state, not simulated swarm load. |
| Provider access | `api/blockchain-providers.ts` plus venue-specific authenticated authorities | Provider health/readiness is measured and topology-specific. |

## Zero-capital single-route invariant

`ZERO_CAPITAL_ATOMIC` follows one explicit live route:

`fresh measured quote -> canonical measured candidate -> deterministic positive all-in economics -> executable resource/provider evidence -> canonical eligibility -> canonical execution scheduler -> one topology executor -> exact pre-broadcast simulation/gas validation -> one signed/broadcast submission path -> terminal receipt/settlement -> treasury/learning feedback`.

BPS research, Nix-Gen ordering, Cryptara, Monte Carlo, provider comparison, atomic stacking, size search, gas sponsorship, route transformation, and external-capital composition may improve measurement, ranking, resource selection, or exact revalidation. None of them may create a second CryptoCrawler trade execution route, mutate the live executor/scheduler at runtime, manufacture economic reductions or liquidity, or independently submit a trade.

Runtime reassignment of canonical zero-capital methods such as `scanChain`, `dispatchExecutableOpportunities`, `executeAndRecord`, or `executeFunded` is not a production architecture. Those capabilities must be composed explicitly under their named canonical owner. Compatibility wrappers may remain in source only while they are unreachable from canonical startup and carry no execution authority.

Slippage tolerance/minimum-output settings are execution guards, not measured economic loss. Canonical BPS cost attribution may count only measured costs or realized/firmly quoted economic effects; a tolerance must not be booked as a realized or expected BPS reduction target.

## Ghost Wallet atomic-settlement invariant

Ghost Wallet is not another arbitrage engine. A borrower calls the deployed intermediary contract and receives principal only inside a transaction whose success requires the ERC-3156-compatible callback to return correctly and principal plus the quoted fee to be restored before completion. For delegated-credit draws, the variable-debt balance is measured before and after repayment; any residual debt increase reverts the entire transaction. Only the realized surplus above the starting principal balance is transferred to the canonical primary payout wallet, inside that same successful transaction.

The off-chain Ghost Wallet observer may verify deployed bytecode, pause state, payout recipient, configured assets and quoted fees. It may not submit borrower transactions, join the arbitrage Profit Ladder, inherit an exchange schedule, treat an account balance as external-capital provenance, or claim a source is live from configuration alone.

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
8. No synthetic execution, fill, profit, settlement, relay, provider, AI, or external-capital evidence may enter the canonical path.
9. One authority per responsibility.
10. One live parent-trade scheduler owns every CryptoCrawler trading topology; topology-specific code never self-schedules.
11. Canonical runtime startup must not depend on runtime monkeypatch order to determine trade semantics.
12. A deployment is not considered proven without the exact deployed SHA and fresh runtime evidence.
13. Ghost Wallet success requires same-transaction repayment/debt-neutrality proof where applicable; its realized surplus is paid directly to the canonical primary wallet and is never routed through the arbitrage Profit Ladder or retained-profit schedule.
