import type { providers } from 'ethers';
import { multiProviderRpcManager, type SupportedChain as RpcSupportedChain } from '../api/blockchain-providers.js';
import type { SupportedExecutionChain } from '../execution/adapters/onchain-payload-builder.js';
import { resolveSponsoredReceiverVault } from '../execution/adapters/sponsored-receiver-manager.js';
import {
  measureAaveV3FlashLoanEconomics,
  measureBalancerFlashLoanEconomics,
  measureMorphoBlueFlashLoanEconomics,
  resolveAaveV3Pool,
  resolveMorphoBlue,
  type FlashLoanProviderEconomics,
  type FlashLoanProviderKind,
} from '../execution/adapters/flash-loan-provider-economics.js';

export interface AtomicProfitabilityProviderFailure {
  provider: FlashLoanProviderKind;
  error: string;
  observedAt: number;
}

export interface AtomicProfitabilityProviderRace {
  /** Resolves as soon as at least one executable measurement is available. */
  ready: Promise<FlashLoanProviderEconomics[]>;
  /** Completes in the background and is never awaited by the APE hot path. */
  settled: Promise<FlashLoanProviderEconomics[]>;
  snapshot: () => FlashLoanProviderEconomics[];
  failures: () => AtomicProfitabilityProviderFailure[];
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
      () => reject(new Error(`${provider} APE evidence deadline exceeded ${ms}ms`)),
      Math.max(1, ms),
    );
    timer.unref?.();
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
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
    if (input.chain === 'europa') throw primaryError;
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
      throw new Error(`${kind} APE route-local evidence failed: primary=${primary}; failover=${failover}`);
    }
  }
}

function betterProvider(
  left: FlashLoanProviderEconomics,
  right: FlashLoanProviderEconomics,
): FlashLoanProviderEconomics {
  const leftComplete = left.executableEvidenceComplete === true;
  const rightComplete = right.executableEvidenceComplete === true;
  if (leftComplete !== rightComplete) return rightComplete ? right : left;
  const leftFee = left.feeBps ?? Number.POSITIVE_INFINITY;
  const rightFee = right.feeBps ?? Number.POSITIVE_INFINITY;
  if (rightFee !== leftFee) return rightFee < leftFee ? right : left;
  const leftLiquidity = left.availableLiquidity ?? 0n;
  const rightLiquidity = right.availableLiquidity ?? 0n;
  if (rightLiquidity !== leftLiquidity) return rightLiquidity > leftLiquidity ? right : left;
  return right.observedAt > left.observedAt ? right : left;
}

/**
 * APE-specific provider evidence race.
 *
 * All compatible providers start together. The first executable measurement is
 * exposed immediately; slower siblings continue only as background enrichment.
 * No sibling is a prerequisite, and a provider/RPC failure is recorded locally.
 * The hot path never awaits `settled`.
 */
export function startAtomicProfitabilityProviderRace(input: {
  chain: SupportedExecutionChain;
  provider: providers.Provider;
  asset: string;
}): AtomicProfitabilityProviderRace {
  const attempts: Attempt[] = [];

  if (resolveSponsoredReceiverVault(input.chain)) {
    attempts.push({
      kind: 'balancer_v2',
      promise: routeLocalMeasure(
        input,
        'balancer_v2',
        provider => measureBalancerFlashLoanEconomics({ ...input, provider }),
      ),
    });
  }
  if (resolveAaveV3Pool(input.chain)) {
    attempts.push({
      kind: 'aave_v3',
      promise: routeLocalMeasure(
        input,
        'aave_v3',
        provider => measureAaveV3FlashLoanEconomics({ ...input, provider }),
      ),
    });
  }
  if (resolveMorphoBlue(input.chain)) {
    attempts.push({
      kind: 'morpho_blue',
      promise: routeLocalMeasure(
        input,
        'morpho_blue',
        provider => measureMorphoBlueFlashLoanEconomics({ ...input, provider }),
      ),
    });
  }

  const evidence = new Map<FlashLoanProviderKind, FlashLoanProviderEconomics>();
  const localFailures: AtomicProfitabilityProviderFailure[] = [];
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

  const finishAll = () => {
    if (settledDone || remaining > 0) return;
    settledDone = true;
    const current = snapshot();
    if (current.length === 0 && localFailures.length === attempts.length && attempts.length > 0) {
      const error = new Error(`All applicable APE flash-provider measurements failed for ${input.chain}: ${localFailures.map(item => `${item.provider}:${item.error}`).join(' | ')}`);
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

  if (attempts.length === 0) {
    readyDone = true;
    settledDone = true;
    resolveReady([]);
    resolveSettled([]);
  } else {
    for (const attempt of attempts) {
      void attempt.promise.then(value => {
        if (value) evidence.set(attempt.kind, value);
        remaining -= 1;
        if (!readyDone && value?.executableEvidenceComplete === true) {
          // Same-turn siblings may publish before this microtask resolves, but no
          // timer or slow-provider barrier is introduced.
          queueMicrotask(() => {
            if (readyDone) return;
            const executable = snapshot().filter(item => item.executableEvidenceComplete);
            if (executable.length === 0) return;
            readyDone = true;
            const best = executable.reduce((winner, candidate) => betterProvider(winner, candidate));
            const ordered = [best, ...executable.filter(item => item.provider !== best.provider)];
            resolveReady(ordered);
          });
        }
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

  // Consumers may intentionally ignore full settlement. Attach a rejection handler
  // now so an all-provider failure never becomes an unhandled background rejection.
  void settled.catch(() => undefined);

  return {
    ready,
    settled,
    snapshot,
    failures,
    applicableProviders: attempts.map(attempt => attempt.kind),
  };
}
