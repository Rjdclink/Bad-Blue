export type NixGenCapabilityState = 'implemented' | 'upstream_capability_required' | 'research_only';

export interface NixGenCapabilityManifestEntry {
  capability: string;
  state: NixGenCapabilityState;
  implementation: string;
  authorityBoundary: string;
}

export interface NixGenCompletionManifest {
  architecture: 'nix_gen';
  implementationState: 'complete';
  operationalProofClaimed: false;
  productionProfitabilityClaimed: false;
  executionAuthority: false;
  canonicalEconomicsAuthority: false;
  settlementAuthority: false;
  treasuryAuthority: false;
  capabilities: NixGenCapabilityManifestEntry[];
}

const CAPABILITIES: readonly NixGenCapabilityManifestEntry[] = Object.freeze([
  { capability: 'standardized_strategy_bids', state: 'implemented', implementation: 'canonical-bid-adapters.ts + types.ts', authorityBoundary: 'Consumes canonical economics/execution evidence only' },
  { capability: 'bounded_global_allocation', state: 'implemented', implementation: 'global-optimizer.ts + coordinator.ts', authorityBoundary: 'Advisory subset/order only; valid non-selected bids remain deferred/alive' },
  { capability: 'continuous_replanning', state: 'implemented', implementation: 'replanner.ts', authorityBoundary: 'Pure/fingerprinted; no timer, lease, order or settlement side effects' },
  { capability: 'mixed_live_portfolio', state: 'implemented', implementation: 'global-live-portfolio.ts + live-priority-registry.ts + portfolio-view.ts', authorityBoundary: 'CEX, maker-CEX, DEX/liquidation and zero-capital publish into one fresh advisory priority surface while canonical lane quotas remain hard truth' },
  { capability: 'shared_cross_lane_priority', state: 'implemented', implementation: 'live-priority-registry.ts + cex-ordering.ts + measured-portfolio-preparation.ts + zero-capital-ordering.ts', authorityBoundary: 'Global ranking only; never acquires a lease, suppresses a canonical candidate or dispatches an order' },
  { capability: 'cex_runtime_ordering', state: 'implemented', implementation: 'cex-ordering.ts + canonical-execution-scheduler.ts', authorityBoundary: 'Default-on fail-open; canonical filters, leases, governance and executor unchanged' },
  { capability: 'measured_runtime_ordering', state: 'implemented', implementation: 'measured-portfolio-preparation.ts + measured-topology-execution-adapter.ts', authorityBoundary: 'Default-on fail-open; topology quotas and canonical executors unchanged' },
  { capability: 'zero_capital_runtime_ordering', state: 'implemented', implementation: 'zero-capital-ordering.ts + zero-capital-shadow-priority-wiring.ts', authorityBoundary: 'Orders the existing zero-capital queue only; previous resource-shadow ordering remains the fail-open fallback and zero-capital engine retains execution/settlement authority' },
  { capability: 'strategy_fingers', state: 'implemented', implementation: 'strategy-limb-registry.ts + portfolio-view.ts', authorityBoundary: 'Finger is available only when upstream authoritative execution and settlement already exist' },
  { capability: 'resource_projection', state: 'implemented', implementation: 'resource-scheduler.ts + zero-capital-resource-scheduler.ts adapters', authorityBoundary: 'Read-only projections; distributed lease acquisition remains hard truth' },
  { capability: 'scarcity_signal', state: 'implemented', implementation: 'scarcity-pricing.ts', authorityBoundary: 'Bounded heuristic diagnostic; never mislabeled as a dual price' },
  { capability: 'marginal_resource_value', state: 'implemented', implementation: 'marginal-resource-value.ts + resource-opportunity-pricing.ts', authorityBoundary: 'Finite-difference canonical-profit sensitivity; no resource or treasury authority' },
  { capability: 'dual_resource_prices', state: 'implemented', implementation: 'dual-resource-pricing.ts', authorityBoundary: 'Projected-subgradient Lagrangian prices; approximate for discrete allocation and never claim exact strong duality' },
  { capability: 'robust_uncertainty', state: 'implemented', implementation: 'robust-uncertainty.ts', authorityBoundary: 'Advisory downside envelopes only; unknown stays unknown and cannot veto canonical profit' },
  { capability: 'terminal_calibration', state: 'implemented', implementation: 'terminal-calibration.ts', authorityBoundary: 'Read-only confirmed settlement calibration; no second learning authority' },
  { capability: 'capital_routing_advisory', state: 'implemented', implementation: 'capital-routing-advisory.ts', authorityBoundary: 'Identifies marginal capital/inventory value; cannot move, size, sweep or withhold funds' },
  { capability: 'quanti_comp_heavy_analysis', state: 'implemented', implementation: 'quanti-analysis.ts', authorityBoundary: 'Optional side-effect-free QuantiComp workload with deterministic inline fallback' },
  { capability: 'cryptara_monte_carlo_evidence', state: 'implemented', implementation: 'integration-contract.ts + upstream canonical assessment', authorityBoundary: 'Consumes probability/rank once; does not rerun/double-count Monte Carlo' },
  { capability: 'tradingview_multi_oracle_evidence', state: 'implemented', implementation: 'integration-contract.ts + upstream canonical evidence wiring', authorityBoundary: 'Consumed upstream through canonical/Cryptara evidence rather than recreated by Nix-Gen' },
  { capability: 'profit_ladder_stage_risk', state: 'implemented', implementation: 'integration-contract.ts', authorityBoundary: 'Existing hard notional/stage/drawdown/circuit-breaker authorities remain binding' },
  { capability: 'dynamic_scale_integration', state: 'implemented', implementation: 'integration-contract.ts', authorityBoundary: 'Consumes resulting resource pressure/capacity; does not become scaling authority' },
  { capability: 'private_execution_routing', state: 'implemented', implementation: 'strategy-limb-registry.ts + integration-contract.ts', authorityBoundary: 'Uses existing canonical private/atomic capability; no duplicate transaction submitter' },
  { capability: 'zero_capital_live_finger', state: 'implemented', implementation: 'canonical-bid-adapters.ts + zero-capital-ordering.ts + zero-capital-shadow-priority-wiring.ts', authorityBoundary: 'Uses the existing zero-capital engine queue, resource scheduler and terminal realized-profit/treasury settlement path; Nix-Gen never becomes executor or treasury authority' },
  { capability: 'market_making_live_finger', state: 'implemented', implementation: 'canonical-bid-adapters.ts + cex-ordering.ts + post-only maker execution authority', authorityBoundary: 'Maker/RPI plans are classified separately for Nix-Gen but continue through canonical post-only maker adapters and CEX terminal settlement' },
  { capability: 'cross_chain_live_finger', state: 'upstream_capability_required', implementation: 'strategy-limb-registry.ts', authorityBoundary: 'Across transport/terminal settlement exists, but discovery intentionally has no source/destination arbitrage revenue leg or deterministic all-in profitable composition; Nix-Gen must not manufacture profit' },
  { capability: 'funding_rate_live_finger', state: 'upstream_capability_required', implementation: 'strategy-limb-registry.ts', authorityBoundary: 'Durable lifecycle skeleton exists, but discovery intentionally lacks measured entry/exit depth, basis reserve, registered venue lifecycle adapters and terminal funding-close evidence' },
  { capability: 'solver_intent_live_finger', state: 'upstream_capability_required', implementation: 'strategy-limb-registry.ts', authorityBoundary: 'No upstream executable terminal-settlement-capable intent/solver route currently exists; Nix-Gen cannot fabricate one' },
  { capability: 'cognitive_fabric_hot_path', state: 'research_only', implementation: 'integration-contract.ts', authorityBoundary: '4JI CognitiveFabric remains outside canonical financial truth and live execution' },
  { capability: 'hhl_quantum_limb', state: 'research_only', implementation: 'integration-contract.ts', authorityBoundary: 'Specialized future linear-system research only; classical Nix-Gen is mandatory baseline' },
]);

export function getNixGenCompletionManifest(): NixGenCompletionManifest {
  return {
    architecture: 'nix_gen',
    implementationState: 'complete',
    operationalProofClaimed: false,
    productionProfitabilityClaimed: false,
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    settlementAuthority: false,
    treasuryAuthority: false,
    capabilities: CAPABILITIES.map(capability => ({ ...capability })),
  };
}
