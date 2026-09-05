# CryptoCrawler Progress Consolidation — 2026-09-05

This ledger is the current anti-duplication map for CryptoCrawler work. It records which problems are already solved on `develop`, which historical PRs are superseded, which work is currently active, and which residual capabilities still require selective extraction. It is not an execution authority.

## Current consolidated baseline

Current baseline: `develop` at `a5ecb927b70894e2fb4050e4d8374515d30c9474` (includes PR #550/#551 plus the concurrent zero-capital route-retention/CEX-standby truth repair).

The governing invariants remain:

- one canonical measured-economics/execution authority;
- no personal principal, gas, collateral, rescue balance, or hidden fallback;
- scanning/learning continues when a topology cannot yet execute;
- only complete all-in positive economics may execute;
- stale evidence may trigger refresh but may not become synthetic BPS cost;
- realized rebates/refunds are signed economic credits only after authoritative evidence;
- 90% realized profit -> ETH -> configured payout path; 10% -> CryptoCrawler-owned retained capital;
- asynchronous CEX/cross-chain/funding lanes are never mislabeled same-transaction atomic;
- Primary remains cold archive; Overflow remains hot runtime authority.

## Completed work — do not re-identify or rebuild

| PR | Consolidated result |
|---|---|
| #511 | Adaptive BPS Super Engine and canonical economic-transformation foundation. |
| #512 | BPS wave 2: maker/queue/latency/RPI/order-control/liquidity/sizing improvements. |
| #515 / #513 | Nix-Gen optimization foundation and subsequent integration. |
| #516 | Randomized operator strategy plus provenance-backed treasury execution. |
| #517 | Funding-rate and cross-chain profit-path completion. |
| #518 | Controlled-loss learning. |
| #521 | Payout-proof schema verification. |
| #522 | Stale Nix verifier repair. |
| #523 | Baseline truth gates / payout and CEX inventory telemetry. |
| #525 | Additive verifier/schema repair later inherited by current baseline. |
| #528 | Strict zero-operator gas provenance plus inherited controlled-loss/runtime safety corrections. |
| #530 | CEX four-mode stale-opportunity expiry/currentness and recurring scan repair. |
| #531 | Runtime authority repair: scanner scheduling, process-signal ownership, Overflow hot DB authority, startup verifier correction. |
| #532 | Zero-capital discovery remains online while funding/paymaster is unavailable; submission stays fail-closed. |
| #533 | Route-local zero-capital readiness truth; global wallet/provider readiness cannot imply strict route readiness. |
| #534 | Arbitrum no-key RPC log authority repair. |
| #535 | Uniswap V3 0.01% / 1-BPS route support end-to-end. |
| #536 | Provenance-backed native-gas authority and exactly-once spend ledger. |
| #537 | Optional officer harvester deferred until after readiness; startup readiness no longer waits on it. |
| #538 | Authenticated CEX fee prewarm and Coinbase/Kraken/OKX coverage expansion. |
| #539 | Stale accepted fee evidence no longer creates synthetic BPS penalty; age remains refresh/telemetry evidence. |
| #540 | OKX fee evidence freshness aligned to consumer contract. |
| #541 | Bounded DEX quote liveness; zero-capital scanning cannot hang indefinitely on RPC. |
| #542 | Morpho zero-fee flash-liquidity provider integration. |
| #543 | Remaining safe stale-advisory protections extracted from historical work. |
| #544 | Near-miss zero-capital candidates can be repriced across providers before the positive-only canonical queue. |
| #545 | Expired/stale BPS observations cannot drive current search pressure/authority. |
| #546 | Gas BPS uses expected effective gas economics instead of max-fee ceiling while receipt truth remains terminal authority. |
| #547 | Universal eight-topology zero-personal-principal/gas/collateral policy integrated with the existing authority. |
| #548 | Keyless Titan/Quasar builder-sponsored cold-start transport extracted safely from stale #520; operator-billed hosted sponsorship remains excluded. |
| #549 | Measured like-notional total-cost BPS frontier plus keyless Lighter discovery/benchmarking; no synthetic savings or independent execution authority. |
| #551 | Exact-notional #549 verifier repair only; no economics, execution, or authority change. |
| #550 | Received-only Flashbots private-refund BPS evidence plus this anti-duplication ledger; pending/forecast refunds cannot receive pre-execution credit. |
| concurrent develop repair | Preserves zero-capital routes during resource standby and distinguishes CEX standby warmup from true failover. |

## Current active work — do not duplicate

- **#552** — BPS provider-feedback wave 5. It feeds fresh, exact, receiver-bound Morpho/Aave/Balancer provider repricing back into the *next zero-capital quote-budget ranking only*. Raw deterministic-positive counts, Aries market-formation evidence, canonical candidate economics, execution authority, and strict net-positive admission remain unchanged. Do not create another provider-pricing engine or another zero-capital route scorer while this PR is active.

## Historical PR disposition

- **#524** — closed historical draft; relevant safe work migrated forward.
- **#526** — closed historical schema-verifier branch; root correction inherited by later merged work.
- **#527** — closed historical freshness branch; useful remnants extracted into #530/#543.
- **#529** — closed and superseded by #530.
- #520 — intentionally remains unmerged. It is heavily diverged from current `develop`; never merge/rebase it wholesale.

## PR #520 extraction ledger

Already superseded/extracted from #520:

- builder-sponsored Titan/Quasar transport -> #548;
- strict gas provenance / no raw-wallet authority -> #528/#536;
- scanning remains live during funding standby -> #532 plus the current route-retention repair;
- strict route-local zero-capital readiness -> #533;
- universal zero-personal-cost topology coverage -> #547;
- modern RPC/readiness/runtime-authority repairs -> #531/#534;
- current BPS/freshness economics -> #539/#540/#545/#546/#549/#550 and active #552.

Residual #520 areas that may contain unique value and therefore must be reviewed before #520 can be closed:

1. `optimization/external-capital-capability-registry.ts` — advisory capital-source catalog; revalidate every protocol/current fact before extraction. Never inherit stale estimated economics or collateral assumptions.
2. `runtime/zero-capital-network-capability-registry.ts` and `zero-capital-network-learning-wiring.ts` — potentially useful advisory network capability/learning; current chain/provider facts must be reverified first.
3. `runtime/expanded-network-observability.ts` — candidate observability only; must not create execution authority.
4. Cryptara network/venue/zero-capital learning files — extract only if they rank already-valid measured opportunities and cannot change hard economic/resource truth.
5. Coinbase system-capital placement/transfer authority — compare carefully against current lot, provenance, treasury, payout and transfer workers before any replay.
6. Rainbow capital destination advisory — retain only if it is advisory and does not redirect the mandatory 90/10 settlement path.
7. Old dynamic zero-capital orchestrator/execution wiring — presumed superseded until a line-by-line comparison proves a unique non-regressive capability. Do not import competing execution authority.

## Current BPS improvement frontier

Current research/implementation frontier after #550 and active #552:

- feed exact provider-repriced flash-liquidity economics back into quote prioritization without converting advisory feedback into execution authority (#552);
- measured total-cost route competition rather than displayed-price routing;
- direct low-fee AMM route versus 0x/aggregator complete-cost comparison, including 0x protocol fees when returned and embedded DEX price/impact rather than comparing incomplete cost fields;
- Lighter as a measured external benchmark until signing/account/margin provenance is genuinely executable;
- private-transport and terminal MEV/gas refund evidence, with no forecast/pending refund credited to deterministic admission (#550);
- MEV Blocker / Flashbots Protect / builder transport comparison using measured latency, inclusion, cost and terminal realized refunds;
- Uniswap v4 hooks/dynamic fees/flash-accounting benefits only after exact executable pool/quote evidence;
- intent/solver/filler lanes only after exact zero-personal-resource and settlement proof.

## Rules for future agents

Before opening a CryptoCrawler fix or feature PR:

1. Read this ledger and current open CryptoCrawler PRs.
2. Compare the proposed change against current `develop`, not against #520 or another historical branch.
3. Search merged PRs above for the same root cause/capability.
4. Reuse the current canonical authority; do not add a parallel veto, economics engine, scanner, settlement path, or execution authority.
5. If historical work has unique value, extract the smallest safe capability onto a fresh current-base branch and add a regression verifier.
6. Do not refetch large production logs when existing evidence answers the question; fetch only the smallest delta needed to prove a new runtime fact.
7. Do not close #520 until every residual item above is either safely extracted, proven superseded, or explicitly rejected with evidence.
