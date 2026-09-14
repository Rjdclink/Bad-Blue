import type { providers } from 'ethers';
import { multiProviderRpcManager, type SupportedChain as RpcSupportedChain } from '../api/blockchain-providers.js';
import {
  measureAaveV3FlashLoanEconomics,
  measureBalancerFlashLoanEconomics,
  measureMorphoBlueFlashLoanEconomics,
  resolveAaveV3Pool,
  resolveMorphoBlue,
  selectMeasuredFlashLoanProvider,
  type FlashLoanProviderEconomics,
  type FlashLoanProviderKind,
} from '../execution/adapters/flash-loan-provider-economics.js';
import { selectMeasuredDualFlashLoanAllocation } from '../execution/adapters/dual-flash-loan-provider-mesh.js';
import type { SupportedExecutionChain } from '../execution/adapters/onchain-payload-builder.js';
import { resolveSponsoredReceiverVault } from '../execution/adapters/sponsored-receiver-manager.js';

export interface CanonicalFlashProviderEvidenceFailure {
  provider: FlashLoanProviderKind;
  error: string;
  observedAt: number;
}

export interface CanonicalFlashProviderEvidenceRace {
  /** Resolves as soon as the accumulated evidence can fund this exact amount. */
  ready: Promise<FlashLoanProviderEconomics[]>;
  /** All slower siblings settle only as background enrichment for later candidates. */
  settled: Promise<FlashLoanProviderEconomics[]>;
  snapshot: () => FlashLoanProviderEconomics[];
  failures: () => CanonicalFlashProviderEvidenceFailure[];
  applicableProviders: readonly FlashLoanProviderKind[];
}

type Attempt = {
  kind: FlashLoanProviderKind;
  promise: Promise<FlashLoanProviderEconomics | null>;
};

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function timeoutMs(): number {
  return bounded(process.env.ZERO_CAPITAL_FLASH_PROVIDER_MEASUREMENT_TIMEOUT_MS, 5_000, 250, 15_000);
}

function withDeadline<T>(promise: Promise<T>, ms: number, provider: FlashLoanProviderKind): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${provider} flash-loan measurement exceeded ${ms}ms evidence deadline`)),
      Math.max(1, ms),
    );
    timer.unref?.();
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function providerUrl(provider: providers.Provider): string | null {
  const url = (provider as providers.JsonRpcProvider & { connection?: { url?: string } }).connection?.url;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

function isCanonicalManagedProvider(chain: SupportedExecutionChain, provider: providers.Provider): boolean {
  if (chain === 'europa') return false;
  const url = providerUrl(provider);
  if (!url) return false;
  return multiProviderRpcManager.getHealth(chain as RpcSupportedChain).some(row => row.httpUrl === url);
}

async function routeLocalMeasure(
  input: { chain: SupportedExecutionChain; provider: providers.Provider; asset: string },
  kind: FlashLoanProviderKind,
  measure: (provider: providers.Provider) => Promise<FlashLoanProviderEconomics | null>,
): Promise<FlashLoanProviderEconomics | null> {
  const ms = timeoutMs();
  try {
    return await withDeadline(measure(input.provider), ms, kind);
  } catch (primaryError) {
    if (!isCanonicalManagedProvider(input.chain, input.provider)) throw primaryError;
    try {
      const { result } = await multiProviderRpcManager.execute(
        input.chain as RpcSupportedChain,
        'contract_calls',
        rpc => withDeadline(measure(rpc), ms, kind),
      );
      return result;
    } catch (failoverError) {
      const primary = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const failover = failoverError instanceof Error ? failoverError.message : String(failoverError);
      throw new Error(`${kind} flash-loan evidence failed on current RPC and route-local failover: primary=${primary}; failover=${failover}`);
    }
  }
}

function mergeEvidence(
  seed: readonly FlashLoanProviderEconomics[],
  updates: readonly FlashLoanProviderEconomics[],
): FlashLoanProviderEconomics[] {
  const merged = new Map<FlashLoanProviderKind, FlashLoanProviderEconomics>();
  for (const item of [...seed, ...updates]) {
    const current = merged.get(item.provider);
    if (!current || item.observedAt >= current.observedAt) merged.set(item.provider, item);
  }
  return [...merged.values()];
}

function amountFundable(evidence: readonly FlashLoanProviderEconomics[], requestedAmount: bigint): boolean {
  return selectMeasuredFlashLoanProvider(evidence, requestedAmount) !== null
    || selectMeasuredDualFlashLoanAllocation(evidence, requestedAmount) !== null;
}

/**
 * Canonical provider-evidence race for one exact opportunity amount.
 *
 * All missing compatible providers start together. The first accumulated evidence
 * set that can fund the exact requested amount is returned immediately; slower
 * siblings never delay that usable proof and only enrich the resident cache for
 * later opportunities. If no provider can fund the amount, all applicable paths
 * are exhausted before returning the measured failure evidence. Provider/RPC
 * failures stay local and never cancel siblings.
 */
export function startCanonicalFlashProviderEvidenceRace(input: {
  chain: SupportedExecutionChain;
  provider: providers.Provider;
  asset: string;
  requestedAmount: bigint;
  seedEvidence?: readonly FlashLoanProviderEconomics[];
}): CanonicalFlashProviderEvidenceRace {
  const seed = [...(input.seedEvidence || [])];
  const seededProviders = new Set(seed.map(item => item.provider));
  const attempts: Attempt[] = [];

  if (resolveSponsoredReceiverVault(input.chain) && !seededProviders.has('balancer_v2')) {
    attempts.push({
      kind: 'balancer_v2',
      promise: routeLocalMeasure(
        input,
        'balancer_v2',
        provider => measureBalancerFlashLoanEconomics({ ...input, provider }),
      ),
    });
  }
  if (resolveAaveV3Pool(input.chain) && !seededProviders.has('aave_v3')) {
    attempts.push({
      kind: 'aave_v3',
      promise: routeLocalMeasure(
        input,
        'aave_v3',
        provider => measureAaveV3FlashLoanEconomics({ ...input, provider }),
      ),
    });
  }
  if (resolveMorphoBlue(input.chain) && !seededProviders.has('morpho_blue')) {
    attempts.push({
      kind: 'morpho_blue',
      promise: routeLocalMeasure(
        input,
        'morpho_blue',
        provider => measureMorphoBlueFlashLoanEconomics({ ...input, provider }),
      ),
    });
  }

  const evidence = new Map<FlashLoanProviderKind, FlashLoanProviderEconomics>(
    seed.map(item => [item.provider, item]),
  );
  const localFailures: CanonicalFlashProviderEvidenceFailure[] = [];
  let remaining = attempts.length;
  let readyDone = false;
  let settledDone = false;
  let resolveReady!: (value: FlashLoanProviderEconomics[]) => void;
  let rejectReady!: (error: Error) => void;
  let resolveSettled!: (value: FlashLoanProviderEconomics[]) => void;
  let rejectSettled!: (error: Error) => void;

  const snapshot = () => [...evidence.values()].map(item => ({ ...item }));
  const failures = () => localFailures.map(item => ({ ...item }));
  const ready = new Promise<FlashLoanProviderEconomics[]>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const settled = new Promise<FlashLoanProviderEconomics[]>((resolve, reject) => {
    resolveSettled = resolve;
    rejectSettled = reject;
  });

  const maybeResolveReady = () => {
    if (readyDone) return;
    const current = snapshot();
    if (!amountFundable(current, input.requestedAmount)) return;
    readyDone = true;
    resolveReady(current);
  };

  const finishAll = () => {
    if (settledDone || remaining > 0) return;
    settledDone = true;
    const current = snapshot();
    if (current.length === 0 && localFailures.length === attempts.length && attempts.length > 0) {
      const error = new Error(`All applicable flash-loan provider measurements failed for ${input.chain}: ${localFailures.map(item => `${item.provider}:${item.error}`).join(' | ')}`);
      if (!readyDone) {
        readyDone = true;
        rejectReady(error);
      }
      rejectSettled(error);
      return;
    }
    if (!readyDone) {
      readyDone = true;
      resolveReady(current);
    }
    resolveSettled(current);
  };

  if (amountFundable(seed, input.requestedAmount)) {
    readyDone = true;
    resolveReady(mergeEvidence([], seed));
  }

  if (attempts.length === 0) {
    if (!readyDone) {
      readyDone = true;
      resolveReady(snapshot());
    }
    settledDone = true;
    resolveSettled(snapshot());
  } else {
    for (const attempt of attempts) {
      void attempt.promise.then(value => {
        if (value) evidence.set(attempt.kind, value);
        remaining -= 1;
        maybeResolveReady();
        finishAll();
      }).catch(error => {
        localFailures.push({
          provider: attempt.kind,
          error: error instanceof Error ? error.message : String(error),
          observedAt: Date.now(),
        });
        remaining -= 1;
        finishAll();
      });
    }
  }

  void settled.catch(() => undefined);

  return {
    ready,
    settled,
    snapshot,
    failures,
    applicableProviders: [...seededProviders, ...attempts.map(attempt => attempt.kind)],
  };
}
