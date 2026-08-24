import { Contract, BigNumber, providers } from 'ethers';
import type { SupportedChain } from './zero-capital-engine.js';

const ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)'];

export type CapitalSource = 'wallet' | 'europa-zero-capital' | 'flashbots-zero-capital' | 'defer';

export interface ChainFundingRequirement {
  chain: SupportedChain;
  assetToken: string;
  assetRequired: bigint;
  nativeGasRequired: bigint;
  bridgeNativeRequired: bigint;
  destinationNativeRequired: bigint;
  nativeSafetyReserve: bigint;
  assetSafetyReserve: bigint;
}

export interface ChainCapitalSnapshot {
  chain: SupportedChain;
  nativeBalance: bigint;
  assetBalance: bigint;
  nativeRequired: bigint;
  assetRequired: bigint;
  nativeSufficient: boolean;
  assetSufficient: boolean;
  reason?: string;
}

export interface CapitalSourceAvailability {
  europaEligible: boolean;
  flashbotsEligible: boolean;
  europaReason?: string;
  flashbotsReason?: string;
}

export interface CapitalHierarchyPlan {
  source: CapitalSource;
  walletSufficient: boolean;
  chains: ChainCapitalSnapshot[];
  reasons: string[];
}

export interface CapitalAssessmentRequest {
  walletAddress?: string;
  providers: ReadonlyMap<SupportedChain, providers.Provider>;
  requirements: ChainFundingRequirement[];
  alternatives: CapitalSourceAvailability;
}

function requirementNativeTotal(requirement: ChainFundingRequirement): bigint {
  return requirement.nativeGasRequired +
    requirement.bridgeNativeRequired +
    requirement.destinationNativeRequired +
    requirement.nativeSafetyReserve;
}

function requirementAssetTotal(requirement: ChainFundingRequirement): bigint {
  return requirement.assetRequired + requirement.assetSafetyReserve;
}

export function selectCapitalSource(
  chains: ChainCapitalSnapshot[],
  alternatives: CapitalSourceAvailability,
): CapitalHierarchyPlan {
  const reasons = chains.flatMap(chain => chain.reason ? [chain.reason] : []);
  const walletSufficient = chains.length > 0 && chains.every(chain => chain.nativeSufficient && chain.assetSufficient);

  if (walletSufficient) {
    return { source: 'wallet', walletSufficient, chains, reasons };
  }
  if (alternatives.europaEligible) {
    reasons.push('Wallet cannot safely fund the full lifecycle; evaluating the implemented Europa zero-capital path');
    return { source: 'europa-zero-capital', walletSufficient, chains, reasons };
  }
  if (alternatives.flashbotsEligible) {
    reasons.push('Wallet cannot safely fund the full lifecycle; evaluating the configured Flashbots zero-capital path');
    return { source: 'flashbots-zero-capital', walletSufficient, chains, reasons };
  }

  reasons.push(alternatives.europaReason || 'Europa zero-capital path is unavailable');
  reasons.push(alternatives.flashbotsReason || 'Flashbots zero-capital path is unavailable');
  return { source: 'defer', walletSufficient, chains, reasons };
}

export class CapitalHierarchyPlanner {
  async assess(request: CapitalAssessmentRequest): Promise<CapitalHierarchyPlan> {
    const snapshots = await Promise.all(request.requirements.map(requirement => this.inspectChain(request.walletAddress, request.providers, requirement)));
    return selectCapitalSource(snapshots, request.alternatives);
  }

  private async inspectChain(
    walletAddress: string | undefined,
    providerByChain: ReadonlyMap<SupportedChain, providers.Provider>,
    requirement: ChainFundingRequirement,
  ): Promise<ChainCapitalSnapshot> {
    const nativeRequired = requirementNativeTotal(requirement);
    const assetRequired = requirementAssetTotal(requirement);
    if (!walletAddress) {
      return {
        chain: requirement.chain,
        nativeBalance: 0n,
        assetBalance: 0n,
        nativeRequired,
        assetRequired,
        nativeSufficient: false,
        assetSufficient: false,
        reason: `${requirement.chain}: no authoritative execution wallet is configured`,
      };
    }

    const provider = providerByChain.get(requirement.chain);
    if (!provider) {
      return {
        chain: requirement.chain,
        nativeBalance: 0n,
        assetBalance: 0n,
        nativeRequired,
        assetRequired,
        nativeSufficient: false,
        assetSufficient: false,
        reason: `${requirement.chain}: no provider is available for a complete wallet assessment`,
      };
    }

    try {
      const nativeBalance = BigInt((await provider.getBalance(walletAddress)).toString());
      const assetBalance = requirement.assetToken
        ? BigInt((await new Contract(requirement.assetToken, ERC20_BALANCE_ABI, provider).balanceOf(walletAddress) as BigNumber).toString())
        : 0n;
      const nativeSufficient = nativeBalance >= nativeRequired;
      const assetSufficient = assetBalance >= assetRequired;
      const deficits: string[] = [];
      if (!nativeSufficient) deficits.push(`native ${nativeBalance.toString()}/${nativeRequired.toString()}`);
      if (!assetSufficient) deficits.push(`asset ${assetBalance.toString()}/${assetRequired.toString()}`);
      return {
        chain: requirement.chain,
        nativeBalance,
        assetBalance,
        nativeRequired,
        assetRequired,
        nativeSufficient,
        assetSufficient,
        reason: deficits.length > 0 ? `${requirement.chain}: insufficient ${deficits.join(', ')}` : undefined,
      };
    } catch (error) {
      return {
        chain: requirement.chain,
        nativeBalance: 0n,
        assetBalance: 0n,
        nativeRequired,
        assetRequired,
        nativeSufficient: false,
        assetSufficient: false,
        reason: `${requirement.chain}: wallet assessment failed (${error instanceof Error ? error.message : String(error)})`,
      };
    }
  }
}
