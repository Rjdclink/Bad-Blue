/**
 * LEGACY COMPATIBILITY SHELL — MandatoryRiskShield
 *
 * The previous implementation returned hard-coded/mock oracle, liquidity,
 * throttle and contract-simulation results. It is retired from trading authority.
 * Canonical risk authority lives under `governance/` and consumes measured
 * execution/economics evidence. This shell fails closed for historical callers.
 */

interface LegacyOpportunity {
  asset?: string;
  pair?: string;
  chain?: string;
  timestamp?: number;
  [key: string]: unknown;
}

interface OpportunityScore {
  opportunity: LegacyOpportunity;
  score: number;
  factors: Record<string, number>;
  discoveredAt?: number;
}

interface ValidationCheck {
  name: string;
  passed: boolean;
  value: number;
  threshold: number;
}

interface ValidationResult {
  safe: boolean;
  confidence: number;
  checks: ValidationCheck[];
  failedChecks: ValidationCheck[];
  reason: string;
}

class MandatoryRiskShield {
  async validate(_opportunity: OpportunityScore): Promise<ValidationResult> {
    const retired: ValidationCheck = {
      name: 'Legacy risk shield retired',
      passed: false,
      value: 0,
      threshold: 1,
    };
    return {
      safe: false,
      confidence: 0,
      checks: [retired],
      failedChecks: [retired],
      reason: 'Legacy MandatoryRiskShield used mock evidence and has no canonical execution authority',
    };
  }
}

export { MandatoryRiskShield };
export type { ValidationResult, ValidationCheck, OpportunityScore };
