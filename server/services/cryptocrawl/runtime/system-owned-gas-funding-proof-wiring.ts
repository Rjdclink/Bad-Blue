import type { Wallet, providers } from 'ethers';
import {
  chooseGasFundingMode,
  type GasFundingDecision,
} from '../capital-free/dynamic-gas-funding-engine.js';
import type { SupportedChain } from '../core/zero-capital-engine.js';
import type { DynamicChainConfig } from '../core/dynamic-chain-registry.js';
import {
  getSystemNativeGasAuthority,
  type SystemNativeGasAuthority,
} from '../execution/system-native-gas-spend-authority.js';

export interface StrictZeroCapitalGasContext {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  dynamicChainConfigs: Map<Exclude<SupportedChain, 'europa'>, DynamicChainConfig>;
  gasSponsor: {
    getReadiness: () => {
      ready: boolean;
      reason?: string;
      operatorMonetaryCostProvenZero?: boolean;
    };
  };
}

const latestDecisions = new Map<SupportedChain, GasFundingDecision>();
const selfFundedAuthorityCache = new Map<SupportedChain, {
  expiresAt: number;
  minimumWei: bigint;
  authority: SystemNativeGasAuthority | null;
}>();

function rememberDecision(chain: SupportedChain, decision: GasFundingDecision): GasFundingDecision {
  latestDecisions.set(chain, {
    ...decision,
    nativeBalance: BigInt(decision.nativeBalance),
    reserveFloor: BigInt(decision.reserveFloor),
  });
  return decision;
}

function boundedInteger(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function selfFundedRunwayMultiplier(): number {
  return boundedInteger(process.env.APE_SELF_FUNDED_GAS_RUNWAY_MULTIPLIER, 12, 2, 100);
}

function selfFundedProofCacheMs(): number {
  return boundedInteger(process.env.APE_SELF_FUNDED_GAS_PROOF_CACHE_MS, 15_000, 1_000, 120_000);
}

async function getCachedSelfFundedAuthority(input: {
  chain: SupportedChain;
  wallet: string;
  minimumWei: bigint;
}): Promise<SystemNativeGasAuthority | null> {
  const cached = selfFundedAuthorityCache.get(input.chain);
  if (cached && cached.expiresAt > Date.now() && cached.minimumWei === input.minimumWei) {
    return cached.authority ? { ...cached.authority } : null;
  }
  let authority: SystemNativeGasAuthority | null = null;
  try {
    authority = await getSystemNativeGasAuthority({
      chain: input.chain,
      wallet: input.wallet,
      minimumWei: input.minimumWei.toString(),
    });
  } catch {
    // Transition proof is advisory until it succeeds. A transient database failure
    // must not disable the initial Pimlico bootstrap lane.
    authority = null;
  }
  selfFundedAuthorityCache.set(input.chain, {
    expiresAt: Date.now() + selfFundedProofCacheMs(),
    minimumWei: input.minimumWei,
    authority,
  });
  return authority ? { ...authority } : null;
}

/**
 * Read-only snapshot of decisions already proven by the canonical gas boundary.
 * Observability consumes this cache instead of issuing its own wallet/RPC probes.
 */
export function getLatestProvenZeroCapitalGasFundingDecisions(): GasFundingDecision[] {
  return [...latestDecisions.values()].map(decision => ({
    ...decision,
    nativeBalance: BigInt(decision.nativeBalance),
    reserveFloor: BigInt(decision.reserveFloor),
  }));
}

/**
 * Sole ZERO_CAPITAL_ATOMIC gas-selection boundary.
 *
 * Bootstrap phase: Pimlico sponsorship is the only executable gas source on chains
 * that advertise hosted sponsorship. Existing native wallet balance is deliberately
 * ignored so operator/pre-existing capital cannot silently become the bootstrap.
 *
 * Self-funded phase: once durable SELF_FUNDED provenance proves a native-gas runway
 * of APE_SELF_FUNDED_GAS_RUNWAY_MULTIPLIER times the normal reserve floor, system-owned
 * native gas takes precedence and Pimlico is no longer selected for that decision.
 * The transition proof is cached briefly to keep the discovery hot path inexpensive.
 *
 * Provider-fronted gas is never automatically rewritten as free. If Pimlico billing
 * remains a liability, Stage One and execution economics must continue charging it.
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

  const unsponsoredBaseline = chooseGasFundingMode(config, 0n, false, {
    sponsorOperatorMonetaryCostProvenZero: false,
    nativeSystemOwnedProven: false,
  });
  const reserveFloor = unsponsoredBaseline.reserveFloor;
  const runwayRequired = reserveFloor * BigInt(selfFundedRunwayMultiplier());
  const selfFundedAuthority = runwayRequired > 0n
    ? await getCachedSelfFundedAuthority({ chain, wallet: wallet.address, minimumWei: runwayRequired })
    : null;

  if (selfFundedAuthority) {
    try {
      const nativeBalance = (await provider.getBalance(wallet.address)).toBigInt();
      if (nativeBalance >= reserveFloor && reserveFloor > 0n) {
        const native = chooseGasFundingMode(config, nativeBalance, false, {
          sponsorOperatorMonetaryCostProvenZero: false,
          nativeSystemOwnedProven: true,
        });
        if (native.mode === 'native') {
          return rememberDecision(chain, {
            ...native,
            reason: `APE self-funded gas runway proven (${selfFundedAuthority.spendableWei} wei spendable; ${runwayRequired.toString()} wei transition threshold); Pimlico bootstrap retired for this decision`,
          });
        }
      }
      return rememberDecision(chain, {
        chain,
        mode: 'unavailable',
        nativeBalance,
        reserveFloor,
        paymentSource: 'system_owned_native',
        strictZeroInitialCapitalEligible: false,
        operatorMonetaryInputRequired: false,
        providerBillingLiability: false,
        sponsorOperatorMonetaryCostProvenZero: false,
        reason: 'APE self-funded transition is proven but the physical native balance is below the executable reserve floor; fail closed rather than silently returning to Pimlico',
      });
    } catch (error) {
      return rememberDecision(chain, {
        chain,
        mode: 'unavailable',
        nativeBalance: 0n,
        reserveFloor,
        paymentSource: 'system_owned_native',
        strictZeroInitialCapitalEligible: false,
        operatorMonetaryInputRequired: false,
        providerBillingLiability: false,
        sponsorOperatorMonetaryCostProvenZero: false,
        reason: `APE self-funded transition is proven but native balance verification failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const readiness = runtime.gasSponsor.getReadiness();
  const sponsorReady = config.sponsoredBootstrap && readiness.ready === true;
  if (sponsorReady) {
    return rememberDecision(chain, chooseGasFundingMode(config, 0n, true, {
      sponsorOperatorMonetaryCostProvenZero: readiness.operatorMonetaryCostProvenZero === true,
      nativeSystemOwnedProven: false,
    }));
  }

  return rememberDecision(chain, {
    chain,
    mode: 'unavailable',
    nativeBalance: 0n,
    reserveFloor,
    paymentSource: 'unavailable',
    strictZeroInitialCapitalEligible: false,
    operatorMonetaryInputRequired: true,
    providerBillingLiability: false,
    sponsorOperatorMonetaryCostProvenZero: false,
    reason: config.sponsoredBootstrap
      ? `Pimlico is the sole APE bootstrap gas provider and is unavailable${readiness.reason ? `: ${readiness.reason}` : ''}; self-funded runway is not yet proven`
      : `Pimlico EIP-7702 bootstrap is not supported on ${chain}; self-funded runway is not yet proven`,
  });
}

/** Compatibility export only; there is no runtime reassignment to install. */
export function ensureSystemOwnedGasFundingProofWiring(): void {
  // Intentionally empty. Canonical discovery/execution call
  // getProvenZeroCapitalGasFundingDecision directly.
}
