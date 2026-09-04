# Nix-Gen

Nix-Gen is an additive global opportunity-allocation layer for CryptoCrawler. Its job is to compare already-authoritative profitable opportunities under shared scarce resources and improve scheduling order without becoming another execution, economics, governance, settlement, resource, or learning authority.

## Current authority boundary

- Canonical measured economics remain upstream; Nix-Gen never creates or repairs economics.
- Unknown canonical BPS remains `null`; Nix-Gen does not duplicate BPS calculation.
- Existing authoritative execution and settlement capability must already exist before a bid is accepted.
- CEX execution/settlement capability is derived from `getCanonicalExecutionCapabilities()` rather than asserted by the Nix-Gen caller.
- Governance, Profit Ladder, resource ownership, nonce/rate safety, kill switch, settlement, payout, and terminal learning remain authoritative in their existing systems.
- Nix-Gen output is advisory. A valid bid that is not in the resource-feasible selected subset remains in the complete priority order, is marked only as deferred for that allocation snapshot, and is never silently vetoed or labeled rejected.
- Known but temporarily insufficient resource capacity is advisory-deferred as `resource_unavailable`; missing resource-capacity evidence is hard-invalid to Nix-Gen as `resource_budget_missing` and is never converted to zero.
- Resource projections are read-only views of the existing resource schedulers. They do not reserve distributed resources or grant execution rights.
- Current scarcity signals are bounded utilization diagnostics only. They are explicitly **not** dual-derived shadow prices and never replace canonical capacity or lease truth.
- Robustness output is advisory only. It may expose a downside reserve/value when independent uncertainty evidence is complete, but it never rewrites canonical economics or candidate eligibility.

## Optimizer behavior

- Small feasible sets use bounded exact branch-and-bound optimization.
- Exact search has a hard candidate cap so a combinatorial explosion cannot enter the hot path.
- Larger sets use a deterministic scarcity-aware fallback.
- Shared resource capacities are merged conservatively rather than double-counted.
- Mutual-exclusion groups prevent incompatible variants of the same opportunity from being simultaneously selected while keeping non-selected valid variants advisory-deferred rather than rejected.
- Canonical positive net profit is the base objective; independent advisory probability, terminal calibration, decay urgency, and normalized rank evidence may adjust scheduling order within bounded ranges.
- Measured-topology `profitabilityScore` is deliberately not recycled as a Nix-Gen rank input because that score already contains profit/confidence and would double-count them.

## Continuous replanning

The pure replanner fingerprints every allocation-relevant truth input: canonical economics/timestamps, execution evidence, advisory evidence, resource demand/budgets, mutual exclusion, dispatch capacity and exact-search configuration.

- An unchanged advisory plan may be reused only before both its bounded maximum plan age and its next temporal truth boundary.
- Opportunity expiry safety margins and future-dated evidence boundaries force recomputation rather than allowing a long-lived stale plan.
- It creates no timer, interval, queue, lease, reservation, order or settlement side effect.
- Opt-in CEX Nix-Gen ordering now calls the pure replanner from the existing canonical scheduler wake/dispatch cycle.
- Disabling Nix-Gen clears cached advisory plan state; any replanner exception fails open to the exact canonical ordering.
- No competing polling daemon is introduced.

## Scarcity diagnostics

- Each resource receives a bounded `0..1` advisory scarcity signal derived from current optimizer utilization.
- The signal is deliberately zero at low/moderate utilization and rises convexly as headroom disappears.
- Saturated/zero-capacity resources receive the maximum diagnostic signal, but canonical resource schedulers still make the hard availability decision.
- Per-bid scarcity burden is diagnostic/ranking support only; it cannot make an otherwise canonical opportunity ineligible or rejected.
- True resource/shadow prices, if added later, must come from an appropriate optimization/dual model rather than relabeling this heuristic signal.

## Marginal resource-value diagnostics

- A bounded finite-difference analyzer asks how much additional **canonical net profit** an incremental unit of each known resource would unlock.
- Advisory probability/rank/calibration modifiers are stripped from this sensitivity pass so the reported value is not double-counted or confused with ranking utility.
- The analysis reuses optimizer-normalized capacities, is bounded to at most 64 resources, and never reserves or mutates resources.
- `isDualShadowPrice` is always false: finite-difference marginal value is optimization-derived evidence, but it is not a LP/MIP dual variable.

## Robust uncertainty diagnostics

- Robustness uses independent, time-bounded downside envelopes supplied with explicit measurement authority.
- Missing, expired, future-dated, or otherwise invalid uncertainty evidence remains unknown; it is never silently converted to zero risk.
- A Bertsimas-Sim-style uncertainty budget may be fractional, allowing graduated conservatism rather than an all-or-nothing penalty.
- The resulting reserve and robust advisory value are diagnostics only. Even a negative robust advisory value does not invalidate or reject a canonically profitable/executable opportunity.

## Rollout

1. **Foundation:** standardized bids, bounded global optimizer, authority invariants, functional verifier.
2. **Read-only resource projections:** reuse CEX and atomic scheduler resource models without reserving anything.
3. **Opt-in CEX ordering:** `CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING=true` may reorder only candidates that have already passed every canonical CEX hard gate. Default is off. Any Nix-Gen failure returns the exact canonical order.
4. **Continuous CEX replanning:** implemented through the existing scheduler wake/dispatch cycle using the pure fingerprinted replanner; no new daemon.
5. **Pure scarcity, marginal-resource-value, and robust-uncertainty diagnostics:** implemented without resource/execution authority.
6. **Cross-topology advisory ordering:** extend the same non-filtering/defer-not-reject model to settlement-capable measured atomic paths after exact-head validation.
7. **True dual/resource-price optimization and optional classical solver limbs:** add only when benchmarked against real Nix-Gen problem sizes and shown to improve objective quality/latency without becoming mandatory.
8. **Terminal-settlement calibration:** use confirmed terminal outcomes to tune advisory allocation without creating a second learning/economics authority.

## Current limitations by design

- Read-only resource projections reflect the local scheduler view; distributed lease acquisition remains the authoritative hard resource check.
- Nix-Gen does not yet interleave or authorize execution across CEX and measured-atomic topologies.
- Scarcity, marginal resource value, and robust uncertainty are diagnostic and are not hard execution gates.
- Optional external solvers are not dependencies. The dependency-free bounded optimizer remains functional even if no solver limb is installed.
- HHL/quantum linear-system methods are not a generic replacement for combinatorial allocation and remain optional only for mathematically suitable subproblems.
- Standalone Nix-Gen verifier scripts are not yet included in the repository `prebuild` command; Railway semantic-verifier execution must not be claimed until that validation gap is explicitly closed.

## Research principles

The implementation uses public research as engineering guidance: Stanford dual/resource-price allocation, NASA/JPL continuous planning and iterative repair, DARPA scalable uncertainty-aware planning, MIT robust optimization and congestion-aware scheduling, Sandia time-critical scheduling, online resource-constrained learning, market-impact-aware optimal execution, smart order routing, combinatorial batch allocation, and deterministic classical solver fallbacks.

Every implementation slice must remain independently useful and removable without breaking existing production behavior.
