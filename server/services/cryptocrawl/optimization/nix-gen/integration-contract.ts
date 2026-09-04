export type NixGenIntegrationMode =
  | 'direct_read_only'
  | 'upstream_evidence'
  | 'hard_upstream_authority'
  | 'optional_compute'
  | 'compatibility_only'
  | 'research_only';

export interface NixGenSystemIntegration {
  id: string;
  mode: NixGenIntegrationMode;
  source: string;
  contribution: string;
  requiredForCoreNixGen: boolean;
  executionAuthority: boolean;
  canonicalEconomicsAuthority: boolean;
  mayVetoCanonicalProfit: boolean;
}

const INTEGRATIONS: readonly NixGenSystemIntegration[] = Object.freeze([
  {
    id: 'canonical_economics',
    mode: 'hard_upstream_authority',
    source: 'arbitrage/arbitrage-verifier.ts + discovery/measured-candidate-registry.ts',
    contribution: 'Deterministic all-in net USD/BPS, freshness, depth and executable evidence before Nix-Gen',
    requiredForCoreNixGen: true,
    executionAuthority: false,
    canonicalEconomicsAuthority: true,
    mayVetoCanonicalProfit: false,
  },
  {
    id: 'cryptara_monte_carlo',
    mode: 'upstream_evidence',
    source: 'integration/cryptara-assessment-wiring.ts + authoritative Monte Carlo wiring',
    contribution: 'Probability/rank/risk evidence already folded into canonical assessment; Nix-Gen consumes it once and never reruns or double-counts it',
    requiredForCoreNixGen: false,
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    mayVetoCanonicalProfit: false,
  },
  {
    id: 'tradingview_multi_oracle',
    mode: 'upstream_evidence',
    source: 'babel/tradingview-integration.ts + integration/oracle-evidence-wiring.ts',
    contribution: 'Technical/oracle evidence enriches upstream canonical/Cryptara assessment rather than becoming a second Nix-Gen gate',
    requiredForCoreNixGen: false,
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    mayVetoCanonicalProfit: false,
  },
  {
    id: 'quanti_comp',
    mode: 'optional_compute',
    source: 'services/quantiComp + nix-gen/quanti-analysis.ts',
    contribution: 'Schedules heavy side-effect-free advisory analysis with deterministic inline fallback',
    requiredForCoreNixGen: false,
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    mayVetoCanonicalProfit: false,
  },
  {
    id: 'computational_beam',
    mode: 'compatibility_only',
    source: 'services/computationalBeam',
    contribution: 'Compatibility/routing facade over canonical heavy-compute ownership; Nix-Gen does not create a competing Beam compute authority',
    requiredForCoreNixGen: false,
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    mayVetoCanonicalProfit: false,
  },
  {
    id: 'dynamic_scale_physics',
    mode: 'upstream_evidence',
    source: 'cryptocrawl/scaling/dynamic-scale-physics.ts + dynamic-scale-pressure-wiring.ts',
    contribution: 'Measured compute/market pressure controls upstream scale; Nix-Gen consumes resulting resource capacity rather than changing scale authority',
    requiredForCoreNixGen: false,
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    mayVetoCanonicalProfit: false,
  },
  {
    id: 'profit_ladder_stage_risk',
    mode: 'hard_upstream_authority',
    source: 'governance/profit-ladder-notional-authority.ts + stage-management.ts + risk-governor.ts',
    contribution: 'Hard notional, stage, drawdown, circuit-breaker and execution-safety truth remains upstream and cannot be bypassed by Nix-Gen',
    requiredForCoreNixGen: true,
    executionAuthority: true,
    canonicalEconomicsAuthority: false,
    mayVetoCanonicalProfit: true,
  },
  {
    id: 'canonical_resource_leases',
    mode: 'hard_upstream_authority',
    source: 'execution/resource-scheduler.ts + zero-capital-resource-scheduler.ts + topology-specific nonce/rate authorities',
    contribution: 'Read-only projections inform Nix-Gen; actual distributed lease acquisition remains the only resource-ownership authority',
    requiredForCoreNixGen: true,
    executionAuthority: true,
    canonicalEconomicsAuthority: false,
    mayVetoCanonicalProfit: true,
  },
  {
    id: 'private_atomic_execution',
    mode: 'hard_upstream_authority',
    source: 'canonical CEX/DEX/flash-loan executors + multi-relay/private execution authorities',
    contribution: 'Strategy fingers may prefer/describe private or atomic capability only when an upstream executable settlement-capable path already exists',
    requiredForCoreNixGen: false,
    executionAuthority: true,
    canonicalEconomicsAuthority: false,
    mayVetoCanonicalProfit: true,
  },
  {
    id: 'terminal_settlement_learning',
    mode: 'direct_read_only',
    source: 'learning/settlement-profit-calibrator.ts',
    contribution: 'Confirmed terminal realized-vs-expected outcomes calibrate scheduling utility read-only; settlement and learning remain upstream authorities',
    requiredForCoreNixGen: false,
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    mayVetoCanonicalProfit: false,
  },
  {
    id: 'treasury_payout_retained_capital',
    mode: 'direct_read_only',
    source: 'canonical treasury/payout/retained-capital authorities + nix-gen/capital-routing-advisory.ts',
    contribution: 'Nix-Gen may identify marginal value of another capital/inventory unit but cannot transfer, sweep, withhold or size funds',
    requiredForCoreNixGen: false,
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    mayVetoCanonicalProfit: false,
  },
  {
    id: 'cognitive_fabric',
    mode: 'research_only',
    source: 'services/4ji-core/cognitive-fabric.ts',
    contribution: 'General 4JI cognition remains outside the live financial hot path; it may support offline research but never creates trading truth',
    requiredForCoreNixGen: false,
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    mayVetoCanonicalProfit: false,
  },
  {
    id: 'hhl_quantum',
    mode: 'research_only',
    source: 'HHL-compatible future specialized linear-system limb only',
    contribution: 'Not a generic combinatorial allocator; classical Nix-Gen remains the mandatory baseline',
    requiredForCoreNixGen: false,
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    mayVetoCanonicalProfit: false,
  },
]);

export function getNixGenIntegrationContract(): NixGenSystemIntegration[] {
  return INTEGRATIONS.map(integration => ({ ...integration }));
}

export function getNixGenRequiredCoreIntegrations(): NixGenSystemIntegration[] {
  return getNixGenIntegrationContract().filter(integration => integration.requiredForCoreNixGen);
}
