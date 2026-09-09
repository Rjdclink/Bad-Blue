import type { Wallet, providers } from 'ethers';
import { chooseGasFundingMode, type GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import type { SupportedChain } from '../core/zero-capital-engine.js';
import type { DynamicChainConfig } from '../core/dynamic-chain-registry.js';
import { getSystemNativeGasAuthority } from '../execution/system-native-gas-spend-authority.js';

export interface StrictZeroCapitalGasContext {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  dynamicChainConfigs: Map<Exclude<SupportedChain, 'europa'>, DynamicChainConfig>;
  gasSponsor: { getReadiness: (chainId?: number) => { ready: boolean; reason?: string } };
}

const EVM_CHAIN_IDS: Partial<Record<SupportedChain, number>> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  bsc: 56,
  avalanche: 43114,
};

const latestDecisions = new Map<SupportedChain, GasFundingDecision>();

function rememberDecision(chain: SupportedChain, decision: GasFundingDecision): GasFundingDecision {
  latestDecisions.set(chain, {
    ...decision,
    nativeBalance: BigInt(decision.nativeBalance),
    reserveFloor: BigInt(decision.reserveFloor),
  });
  return decision;
}

/**
 * Read-only snapshot of decisions already proven by the canonical gas boundary.
 * Observability consumes this cache instead of issuing its own wallet/RPC probes
 * or inferring zero-capital readiness from generic StageManager state.
 */
export function getLatestProvenZeroCapitalGasFundingDecisions(): GasFundingDecision[] {
  return [...latestDecisions.values()].map(decision => ({
    ...decision,
    nativeBalance: BigInt(decision.nativeBalance),
    reserveFloor: BigInt(decision.reserveFloor),
  }));
}

/**
 * Sole strict ZERO_CAPITAL_ATOMIC gas-selection boundary. It composes the live
 * wallet/provider reading with the durable system-native ownership ledger. It
 * never rewrites engine methods and it never promotes configured sponsorship to
 * zero-operator-cost proof without independent billing evidence.
 *
 * Sponsorship readiness is chain-local and incorporates live Wallet-API policy
 * failures learned by the sponsorship manager. If an exact policy/network path
 * proves invalid, subsequent decisions on that chain fall through to proven
 * system-owned native gas rather than repeatedly selecting a broken sponsor.
 */
export async function getProvenZeroCapitalGasFundingDecision(
  runtime: StrictZeroCapitalGasContext,
  chain: SupportedChain,
): Promise<GasFundingDecision> {
  if (chain === 'europa') {
    return rememberDecision(chain, {
      chain,
      mode: 'unavailable',
      nativeBalance: 0n,
      reserveFloor: 0n,
      paymentSource: 'unavailable',
      strictZeroInitialCapitalEligible: false,
      operatorMonetaryInputRequired: true,
      reason: 'Europa execution is retired',
    });
  }

  const provider = runtime.providers.get(chain);
  const wallet = runtime.executionWallets.get(chain);
  const config = runtime.dynamicChainConfigs.get(chain);
  if (!provider || !wallet || !config) {
    return rememberDecision(chain, {
      chain,
      mode: 'unavailable',
      nativeBalance: 0n,
      reserveFloor: 0n,
      paymentSource: 'unavailable',
      strictZeroInitialCapitalEligible: false,
      operatorMonetaryInputRequired: true,
      reason: `No live strict zero-capital funding context is available for ${chain}`,
    });
  }

  try {
    const nativeBalance = (await provider.getBalance(wallet.address)).toBigInt();
    const chainId = EVM_CHAIN_IDS[chain];
    const sponsorReadiness = runtime.gasSponsor.getReadiness(chainId);
    const sponsorReady = sponsorReadiness.ready === true;
    const unproven = chooseGasFundingMode(config, nativeBalance, sponsorReady, {
      sponsorOperatorMonetaryCostProvenZero: false,
      nativeSystemOwnedProven: false,
    });

    if (nativeBalance < unproven.reserveFloor || unproven.reserveFloor <= 0n) {
      if (!sponsorReady && config.sponsoredBootstrap && sponsorReadiness.reason) {
        unproven.reason = `${unproven.reason}; sponsorLiveValidation=${sponsorReadiness.reason}`;
      }
      return rememberDecision(chain, unproven);
    }
    const authority = await getSystemNativeGasAuthority({
      chain,
      wallet: wallet.address,
      minimumWei: unproven.reserveFloor.toString(),
    });
    const proven = chooseGasFundingMode(config, nativeBalance, sponsorReady, {
      sponsorOperatorMonetaryCostProvenZero: false,
      nativeSystemOwnedProven: authority !== null && BigInt(authority.spendableWei) >= unproven.reserveFloor,
    });
    if (!sponsorReady && config.sponsoredBootstrap && sponsorReadiness.reason) {
      proven.reason = `${proven.reason}; sponsorLiveValidation=${sponsorReadiness.reason}`;
    }
    return rememberDecision(chain, proven);
  } catch (error) {
    return rememberDecision(chain, {
      chain,
      mode: 'unavailable',
      nativeBalance: 0n,
      reserveFloor: 0n,
      paymentSource: 'unavailable',
      strictZeroInitialCapitalEligible: false,
      operatorMonetaryInputRequired: true,
      reason: `Strict zero-capital gas proof failed closed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/** Compatibility export only; there is no runtime reassignment to install. */
export function ensureSystemOwnedGasFundingProofWiring(): void {
  // Intentionally empty. Canonical discovery/execution call
  // getProvenZeroCapitalGasFundingDecision directly.
}
