import logger from '../../../logger.js';

let logged = false;

/**
 * Compatibility boundary only. Fresh ZERO_CAPITAL_ATOMIC measurement, strict gas
 * resource proof, receiver preparation, exact route evidence, and candidate
 * creation now live in zero-capital-canonical-discovery.ts. Provider repricing is
 * the sole eligibility promotion stage. No engine method is rewritten here.
 */
export function ensureZeroCapitalResourceWiring(): void {
  if (logged) return;
  logged = true;
  logger.info('[ZeroCapitalResource] Legacy runtime rewiring retired', {
    component: 'ZeroCapitalResourceWiring',
    discoveryAuthority: 'CanonicalZeroCapitalDiscovery',
    resourceAuthority: 'getProvenZeroCapitalGasFundingDecision',
    eligibilityAuthority: 'canonical_provider_repricing_stage_only',
    configuredRoutesPreserved: true,
    discoveryContinues: true,
    personalFundingRequested: false,
    missingEvidence: 'zero_personal_cost_gas_resource',
    scanChainMutation: false,
    dispatchMutation: false,
    executionAuthority: false,
  });
}
