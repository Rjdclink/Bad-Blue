import type { BigNumber, Wallet } from 'ethers';

/**
 * Legacy gas-sponsorship compatibility boundary.
 *
 * Hosted provider sponsorship that can create an operator/application billing
 * liability is not admissible ZERO_CAPITAL_ATOMIC funding. The former Alchemy
 * Wallet/Paymaster implementation is therefore retired rather than treated as
 * zero-cost gas. Existing callers retain the same method surface and fail closed;
 * legitimate execution continues through proven system-owned native gas or other
 * canonical externally funded/caller-funded routes whose cost provenance is
 * independently proven at their own execution boundary.
 */

export interface SponsoredCall {
  to: string;
  data: string;
  value?: BigNumber | bigint | string | number;
}

export interface GasSponsorshipReadiness {
  ready: boolean;
  reason?: string;
  provider: 'retired-hosted-sponsorship';
  operatorBillingLiability: false;
  zeroOperatorCostProven: false;
}

export interface SponsoredExecutionResult {
  callId: string;
  transactionHash: string;
  blockNumber?: number;
  gasUsed?: bigint;
  receiptStatus: 0 | 1;
}

/**
 * @deprecated Name retained for import compatibility only. No provider API key,
 * policy identifier, EIP-7702 delegation, paymaster request, or network call is
 * performed by this class.
 */
export class AlchemyGasSponsorshipManager {
  constructor(_environment: NodeJS.ProcessEnv = process.env) {}

  isEnabled(): boolean {
    return false;
  }

  getReadiness(): GasSponsorshipReadiness {
    return {
      ready: false,
      provider: 'retired-hosted-sponsorship',
      operatorBillingLiability: false,
      zeroOperatorCostProven: false,
      reason: 'Hosted provider sponsorship is retired: no provider-billed gas path is admitted as zero-operator-cost funding',
    };
  }

  async execute(_input: {
    wallet: Wallet;
    chainId: number;
    calls: SponsoredCall[];
    timeoutMs?: number;
    pollMs?: number;
  }): Promise<SponsoredExecutionResult> {
    throw new Error('HOSTED_GAS_SPONSORSHIP_RETIRED_USE_PROVEN_CANONICAL_FUNDING_ROUTE');
  }
}

let singleton: AlchemyGasSponsorshipManager | null = null;

/** @deprecated Compatibility accessor; always returns a fail-closed retired lane. */
export function getGasSponsorManager(): AlchemyGasSponsorshipManager {
  if (!singleton) singleton = new AlchemyGasSponsorshipManager();
  return singleton;
}

export default AlchemyGasSponsorshipManager;
