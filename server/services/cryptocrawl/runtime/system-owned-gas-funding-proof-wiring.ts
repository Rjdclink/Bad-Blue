import type { Wallet, providers } from 'ethers';
import { chooseGasFundingMode, type GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import type { SupportedChain } from '../core/zero-capital-engine.js';
import type { DynamicChainConfig } from '../core/dynamic-chain-registry.js';
import { getSystemNativeGasAuthority } from '../execution/system-native-gas-spend-authority.js';

export interface StrictZeroCapitalGasContext {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  dynamicChainConfigs: Map<Exclude<SupportedChain, 'europa'>, DynamicChainConfig>;
  gasSponsor: { getReadiness: () => { ready: boolean } };
}

/**
 * Sole strict ZERO_CAPITAL_ATOMIC gas-selection boundary. It composes the live
 * wallet/provider reading with the durable system-native ownership ledger. It
 * never rewrites engine methods and it never promotes configured sponsorship to
 * zero-operator-cost proof without independent billing evidence.
 */
export async function getProvenZeroCapitalGasFundingDecision(
  runtime: StrictZeroCapitalGasContext,
  chain: SupportedChain,
): Promise<GasFundingDecision> {
  if (chain === 'europa') {
    return {
      chain,
      mode: 'unavailable',
      nativeBalance: 0n,
      reserveFloor: 0n,
      paymentSource: 'unavailable',
      strictZeroInitialCapitalEligible: false,
      operatorMonetaryInputRequired: true,
      reason: 'Europa execution is retired',
    };
  }

  const provider = runtime.providers.get(chain);
  const wallet = runtime.executionWallets.get(chain);
  const config = runtime.dynamicChainConfigs.get(chain);
  if (!provider || !wallet || !config) {
    return {
      chain,
      mode: 'unavailable',
      nativeBalance: 0n,
      reserveFloor: 0n,
      paymentSource: 'unavailable',
      strictZeroInitialCapitalEligible: false,
      operatorMonetaryInputRequired: true,
      reason: `No live strict zero-capital funding context is available for ${chain}`,
    };
  }

  try {
    const nativeBalance = (await provider.getBalance(wallet.address)).toBigInt();
    const sponsorReady = runtime.gasSponsor.getReadiness().ready === true;
    const unproven = chooseGasFundingMode(config, nativeBalance, sponsorReady, {
      sponsorOperatorMonetaryCostProvenZero: false,
      nativeSystemOwnedProven: false,
    });

    if (nativeBalance < unproven.reserveFloor || unproven.reserveFloor <= 0n) return unproven;
    const authority = await getSystemNativeGasAuthority({
      chain,
      wallet: wallet.address,
      minimumWei: unproven.reserveFloor.toString(),
    });
    return chooseGasFundingMode(config, nativeBalance, sponsorReady, {
      sponsorOperatorMonetaryCostProvenZero: false,
      nativeSystemOwnedProven: authority !== null && BigInt(authority.spendableWei) >= unproven.reserveFloor,
    });
  } catch (error) {
    return {
      chain,
      mode: 'unavailable',
      nativeBalance: 0n,
      reserveFloor: 0n,
      paymentSource: 'unavailable',
      strictZeroInitialCapitalEligible: false,
      operatorMonetaryInputRequired: true,
      reason: `Strict zero-capital gas proof failed closed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Compatibility export only; there is no runtime reassignment to install. */
export function ensureSystemOwnedGasFundingProofWiring(): void {
  // Intentionally empty. Canonical discovery/execution call
  // getProvenZeroCapitalGasFundingDecision directly.
}
