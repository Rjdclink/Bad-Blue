import type { Wallet, providers } from 'ethers';
import {
  chooseGasFundingMode,
  strictZeroOperatorCostRequired,
  type GasFundingDecision,
} from '../capital-free/dynamic-gas-funding-engine.js';
import type { SupportedChain } from '../core/zero-capital-engine.js';
import type { DynamicChainConfig } from '../core/dynamic-chain-registry.js';
import { getSystemNativeGasAuthority } from '../execution/system-native-gas-spend-authority.js';

export interface StrictZeroCapitalGasContext {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  dynamicChainConfigs: Map<Exclude<SupportedChain, 'europa'>, DynamicChainConfig>;
  gasSponsor: { getReadiness: () => { ready: boolean } };
}

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
 * Sole ZERO_CAPITAL_ATOMIC gas-selection boundary. Ready provider sponsorship is
 * the primary zero-initial-capital lane and therefore does not wait on a native
 * balance RPC probe. Native balance plus durable system-ownership proof is queried
 * only as the route-local fallback when sponsorship is unavailable/incompatible or
 * the explicitly stronger lifetime-zero-operator-cost mode is enabled.
 *
 * Provider-fronted gas is never rewritten as free: the funding decision marks its
 * billing liability and canonical execution economics continue charging the actual
 * gas cost unless independent zero-cost billing evidence exists.
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

  const sponsorReady = runtime.gasSponsor.getReadiness().ready === true;
  if (config.sponsoredBootstrap && sponsorReady && !strictZeroOperatorCostRequired()) {
    return rememberDecision(chain, chooseGasFundingMode(config, 0n, true, {
      sponsorOperatorMonetaryCostProvenZero: false,
      nativeSystemOwnedProven: false,
    }));
  }

  try {
    const nativeBalance = (await provider.getBalance(wallet.address)).toBigInt();
    const unproven = chooseGasFundingMode(config, nativeBalance, sponsorReady, {
      sponsorOperatorMonetaryCostProvenZero: false,
      nativeSystemOwnedProven: false,
    });

    if (unproven.mode === 'sponsored') return rememberDecision(chain, unproven);
    if (nativeBalance < unproven.reserveFloor || unproven.reserveFloor <= 0n) {
      return rememberDecision(chain, unproven);
    }
    const authority = await getSystemNativeGasAuthority({
      chain,
      wallet: wallet.address,
      minimumWei: unproven.reserveFloor.toString(),
    });
    return rememberDecision(chain, chooseGasFundingMode(config, nativeBalance, sponsorReady, {
      sponsorOperatorMonetaryCostProvenZero: false,
      nativeSystemOwnedProven: authority !== null && BigInt(authority.spendableWei) >= unproven.reserveFloor,
    }));
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
