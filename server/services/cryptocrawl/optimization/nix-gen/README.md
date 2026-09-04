# Nix-Gen

Nix-Gen is an additive global opportunity-allocation layer for CryptoCrawler. Its job is to compare already-authoritative profitable opportunities under shared scarce resources and improve scheduling order without becoming another execution, economics, governance, settlement, or learning authority.

## Current authority boundary

- Canonical measured economics remain upstream; Nix-Gen never creates or repairs economics.
- Unknown canonical BPS remains `null`; Nix-Gen does not duplicate BPS calculation.
- Existing authoritative execution and settlement capability must already exist before a bid is accepted.
- Governance, Profit Ladder, resource ownership, nonce/rate safety, kill switch, settlement, payout, and terminal learning remain authoritative in their existing systems.
- Nix-Gen output is advisory. A valid bid that is not in the resource-feasible selected subset remains in the complete priority order, is marked only as deferred for that allocation snapshot, and is never silently vetoed or labeled rejected.
- Resource projections are read-only views of the existing resource schedulers. They do not reserve distributed resources or grant execution rights.

## Optimizer behavior

- Small feasible sets use bounded exact branch-and-bound optimization.
- Exact search has a hard candidate cap so a combinatorial explosion cannot enter the hot path.
- Larger sets use a deterministic scarcity-aware fallback.
- Shared resource capacities are merged conservatively rather than double-counted.
- Mutual-exclusion groups prevent incompatible variants of the same opportunity from being simultaneously selected while keeping non-selected valid variants advisory-deferred rather than rejected.
- Canonical positive net profit is the base objective; independent advisory probability, terminal calibration, decay urgency, and normalized rank evidence may adjust ordering within bounded ranges.
- Measured-topology `profitabilityScore` is deliberately not recycled as a Nix-Gen rank input because that score already contains profit/confidence and would double-count them.

## Rollout

1. **Foundation:** standardized bids, bounded global optimizer, authority invariants, functional verifier.
2. **Read-only resource projections:** reuse CEX and atomic scheduler resource models without reserving anything.
3. **Opt-in CEX ordering:** `CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING=true` may reorder only candidates that have already passed every canonical CEX hard gate. Default is off. Any Nix-Gen failure returns the exact canonical order.
4. **Cross-topology advisory ordering:** only after the CEX slice is proven, extend the same non-filtering ordering model to settlement-capable measured atomic paths.
5. **Continuous replanning:** reuse the existing scheduler wake/dispatch cycle; do not add a competing polling daemon.
6. **Scarcity/shadow-price diagnostics, robust uncertainty, solver limbs, and terminal calibration:** add only after each preceding slice proves independent benefit and no regression.

## Current limitations by design

- Read-only resource projections reflect the local scheduler view; distributed lease acquisition remains the authoritative hard resource check.
- Nix-Gen does not currently interleave or authorize execution across topologies.
- Optional external solvers are not dependencies. The dependency-free bounded optimizer remains functional even if no solver limb is installed.
- HHL/quantum linear-system methods are not a generic replacement for combinatorial allocation and remain optional only for mathematically suitable subproblems.

## Research principles

The implementation uses public research as engineering guidance: Stanford dual/resource-price allocation, NASA/JPL continuous planning and iterative repair, DARPA scalable uncertainty-aware planning, MIT robust optimization and congestion-aware scheduling, Sandia time-critical scheduling, online resource-constrained learning, market-impact-aware optimal execution, smart order routing, combinatorial batch allocation, and deterministic classical solver fallbacks.

Every implementation slice must remain independently useful and removable without breaking existing production behavior.
