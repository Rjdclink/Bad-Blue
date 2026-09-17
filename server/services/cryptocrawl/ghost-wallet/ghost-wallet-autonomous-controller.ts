import { ethers, providers } from 'ethers';
import logger from '../../../logger.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { evaluateGhostWalletControllerEconomics } from './ghost-wallet-controller-economics.js';
import {
  buildGhostWalletBorrowerTransactionWithSpread,
  quoteGhostWalletBorrowerRoute,
  type GhostWalletBorrowerQuoteResult,
  type GhostWalletBorrowerRouteQuote,
} from './ghost-wallet-borrower-surface.js';
import { ghostWalletEngine } from './ghost-wallet-engine.js';
import { getGhostWalletExternalBridgeDescriptor } from './ghost-wallet-external-bridge.js';
import { resolveGhostWalletGasPricing } from './ghost-wallet-gas-pricing.js';
import { getGhostWalletPimlicoSupportedChains } from './ghost-wallet-pimlico-sponsor.js';
import { recordGhostWalletPerformance } from './ghost-wallet-performance-intelligence.js';
import { ghostWalletProviderMesh, type GhostWalletChain } from './ghost-wallet-provider-mesh.js';
import { enqueueGhostWalletWork } from './ghost-wallet-work-ledger.js';
import { ghostWalletWorkSignal, type GhostWalletWakeReason } from './ghost-wallet-work-signal.js';

const KNOWN_CHAINS = new Set<GhostWalletChain>(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche']);
const PIMLICO_EXECUTION_CHAINS = new Set<GhostWalletChain>(getGhostWalletPimlicoSupportedChains());
const BPS = 10_000n;
const MAX_CALIBRATION_PASSES = 3;
const REGISTRY_WARN_INTERVAL_MS = 60_000;

interface StandingBorrowerMandate {
  id: string;
  executionScope: string;
  chain: GhostWalletChain;
  borrower: string;
  asset: string;
  amountMode: 'exact' | 'range';
  minAmountBaseUnits: string;
  preferredAmountBaseUnits: string;
  maxAmountBaseUnits: string;
  borrowerData: string;
  maxBorrowerFeeBaseUnits: string | null;
  expiresAt: number | null;
  maxExecutions: number;
  minIntervalMs: number;
  source: 'environment' | 'venue_registry';
}

interface MandateExecutionState {
  settled: number;
  active: number;
  total: number;
  lastCommittedAt: number | null;
}

interface PreflightCandidate {
  quote: GhostWalletBorrowerQuoteResult;
  route: GhostWalletBorrowerRouteQuote;
  amount: bigint;
  requestedSpread: bigint;
  borrowerFee: bigint;
  prepared: ReturnType<typeof buildGhostWalletBorrowerTransactionWithSpread>;
  economics: Awaited<ReturnType<typeof evaluateGhostWalletControllerEconomics>> | null;
  gasUnits: bigint;
  expectedFeePerGas: bigint;
  signingFeeCeilingPerGas: bigint;
  pricingMode: string;
  provider: providers.JsonRpcProvider;
  latencyMs: number;
  advisoryError: string | null;
}

let registryCache: { expiresAt: number; rows: StandingBorrowerMandate[] } | null = null;
let registryLastSuccessAt: number | null = null;
let registryLastFailureAt: number | null = null;
let registryLastError: string | null = null;
let registryConsecutiveFailures = 0;
let registryLastWarnAt = 0;

function address(value: unknown): string | null {
  const raw = String(value || '').trim();
  return ethers.utils.isAddress(raw) ? ethers.utils.getAddress(raw) : null;
}

function chain(value: unknown): GhostWalletChain | null {
  const normalized = String(value || '').trim().toLowerCase() as GhostWalletChain;
  return KNOWN_CHAINS.has(normalized) ? normalized : null;
}

function positiveInteger(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  return /^\d+$/.test(raw) && BigInt(raw) > 0n ? raw : null;
}

function hexData(value: unknown): string {
  const raw = String(value || '0x').trim();
  return ethers.utils.isHexString(raw) ? raw : '0x';
}

function safePositiveCount(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeIntervalMs(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function configuredSpreadFloorBps(): number {
  const configured = Number(
    process.env.GHOST_WALLET_AUTONOMOUS_SPREAD_BPS
    || process.env.GHOST_WALLET_AUTONOMOUS_MIN_SPREAD_BPS
    || 0,
  );
  return Number.isFinite(configured) ? Math.max(0, Math.min(1_000, Math.trunc(configured))) : 0;
}

function spreadBaseUnits(amount: bigint, spreadBps: number): bigint {
  if (amount <= 0n) return 0n;
  if (spreadBps <= 0) return 1n;
  const numerator = amount * BigInt(spreadBps);
  return (numerator + BPS - 1n) / BPS;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function activeScanMs(hasMandates: boolean): number {
  const fallback = hasMandates ? 2_000 : 15_000;
  const configured = Number(process.env[hasMandates ? 'GHOST_WALLET_ACTIVE_SCAN_MS' : 'GHOST_WALLET_IDLE_SCAN_MS'] || fallback);
  return Number.isFinite(configured) ? Math.max(hasMandates ? 500 : 2_000, Math.min(60_000, Math.trunc(configured))) : fallback;
}

function mandateCacheTtlMs(): number {
  const configured = Number(process.env.GHOST_WALLET_MANDATE_CACHE_TTL_MS || 10_000);
  return Number.isFinite(configured) ? Math.max(500, Math.min(60_000, Math.trunc(configured))) : 10_000;
}

function matchConcurrency(): number {
  const configured = Number(process.env.GHOST_WALLET_MATCH_CONCURRENCY || 8);
  return Number.isFinite(configured) ? Math.max(1, Math.min(32, Math.trunc(configured))) : 8;
}

function sizeCandidateLimit(): number {
  const configured = Number(process.env.GHOST_WALLET_SIZE_CANDIDATE_LIMIT || 4);
  return Number.isFinite(configured) ? Math.max(1, Math.min(5, Math.trunc(configured))) : 4;
}

function routePlanLimit(): number {
  const configured = Number(process.env.GHOST_WALLET_ROUTE_PLAN_LIMIT || 6);
  return Number.isFinite(configured) ? Math.max(1, Math.min(12, Math.trunc(configured))) : 6;
}

function preflightConcurrency(): number {
  const configured = Number(process.env.GHOST_WALLET_PREFLIGHT_CONCURRENCY || 2);
  return Number.isFinite(configured) ? Math.max(1, Math.min(4, Math.trunc(configured))) : 2;
}

function amountRange(input: any): { mode: 'exact' | 'range'; min: string; preferred: string; max: string } | null {
  const exact = positiveInteger(input?.amountBaseUnits);
  const min = positiveInteger(input?.minAmountBaseUnits);
  const preferred = positiveInteger(input?.preferredAmountBaseUnits);
  const max = positiveInteger(input?.maxAmountBaseUnits);
  if (min && preferred && max && BigInt(min) <= BigInt(preferred) && BigInt(preferred) <= BigInt(max)) {
    return { mode: min === max ? 'exact' : 'range', min, preferred, max };
  }
  if (!exact) return null;
  return { mode: 'exact', min: exact, preferred: exact, max: exact };
}

function amountCandidates(mandate: StandingBorrowerMandate): bigint[] {
  const min = BigInt(mandate.minAmountBaseUnits);
  const preferred = BigInt(mandate.preferredAmountBaseUnits);
  const max = BigInt(mandate.maxAmountBaseUnits);
  if (mandate.amountMode === 'exact' || min === max) return [preferred];
  const candidates = [
    preferred,
    max,
    (preferred + max) / 2n,
    (min + preferred) / 2n,
    min,
  ].filter(value => value >= min && value <= max && value > 0n);
  const unique: bigint[] = [];
  const seen = new Set<string>();
  for (const value of candidates) {
    const key = value.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
    if (unique.length >= sizeCandidateLimit()) break;
  }
  return unique;
}

async function mapBounded<T, R>(items: readonly T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await mapper(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, () => worker()));
  return results;
}

function configuredMandates(): StandingBorrowerMandate[] {
  const raw = process.env.GHOST_WALLET_AUTONOMOUS_BORROWERS_JSON?.trim();
  if (!raw) return [];
  let rows: unknown;
  try { rows = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: any, index) => {
    if (row?.enabled === false) return [];
    const parsedChain = chain(row?.chain);
    const borrower = address(row?.borrower);
    const asset = address(row?.asset);
    const authorizedAmount = amountRange(row);
    if (!parsedChain || !borrower || !asset || !authorizedAmount) return [];
    const maxBorrowerFeeBaseUnits = row?.maxBorrowerFeeBaseUnits === undefined
      ? null
      : positiveInteger(row.maxBorrowerFeeBaseUnits);
    const expiresAt = Number(row?.expiresAt);
    const minIntervalMs = row?.minIntervalMs !== undefined
      ? safeIntervalMs(row.minIntervalMs)
      : safeIntervalMs(Number(row?.minIntervalSeconds || 0) * 1000);
    const id = String(row?.id || `env-${index}`).slice(0, 160);
    return [{
      id,
      executionScope: `environment:${id}`,
      chain: parsedChain,
      borrower,
      asset,
      amountMode: authorizedAmount.mode,
      minAmountBaseUnits: authorizedAmount.min,
      preferredAmountBaseUnits: authorizedAmount.preferred,
      maxAmountBaseUnits: authorizedAmount.max,
      borrowerData: hexData(row?.borrowerData),
      maxBorrowerFeeBaseUnits,
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
      maxExecutions: safePositiveCount(row?.maxExecutions, 1),
      minIntervalMs,
      source: 'environment' as const,
    }];
  });
}

async function registryMandates(): Promise<StandingBorrowerMandate[]> {
  if (registryCache && registryCache.expiresAt > Date.now()) return registryCache.rows.map(row => ({ ...row }));
  try {
    const result = await pool.query(
      `SELECT venue_id,chain,address,asset,metadata
       FROM private.cryptocrawler_ghost_wallet_venues
       WHERE enabled=true AND role IN ('borrower','both')
         AND lower(COALESCE(metadata->>'autonomous','false'))='true'
       ORDER BY verified DESC, last_verified_at DESC NULLS LAST, last_observed_at DESC`,
    );
    const rows = result.rows.flatMap((row: any) => {
      const parsedChain = chain(row.chain);
      const borrower = address(row.address);
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      const asset = address(row.asset || metadata.asset);
      const authorizedAmount = amountRange(metadata);
      if (!parsedChain || !borrower || !asset || !authorizedAmount) return [];
      const maxBorrowerFeeBaseUnits = metadata.maxBorrowerFeeBaseUnits === undefined
        ? null
        : positiveInteger(metadata.maxBorrowerFeeBaseUnits);
      const expiresAt = Number(metadata.expiresAt);
      const minIntervalMs = metadata.minIntervalMs !== undefined
        ? safeIntervalMs(metadata.minIntervalMs)
        : safeIntervalMs(Number(metadata.minIntervalSeconds || 0) * 1000);
      const id = String(row.venue_id).slice(0, 240);
      const mandateDigest = String(metadata.mandateDigest || '').trim().toLowerCase();
      const executionScope = /^0x[a-f0-9]{64}$/.test(mandateDigest) ? mandateDigest : `venue:${id}`;
      return [{
        id,
        executionScope,
        chain: parsedChain,
        borrower,
        asset,
        amountMode: authorizedAmount.mode,
        minAmountBaseUnits: authorizedAmount.min,
        preferredAmountBaseUnits: authorizedAmount.preferred,
        maxAmountBaseUnits: authorizedAmount.max,
        borrowerData: hexData(metadata.borrowerData),
        maxBorrowerFeeBaseUnits,
        expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
        maxExecutions: safePositiveCount(metadata.maxExecutions, 1),
        minIntervalMs,
        source: 'venue_registry' as const,
      }];
    });
    registryCache = { expiresAt: Date.now() + mandateCacheTtlMs(), rows };
    registryLastSuccessAt = Date.now();
    registryLastFailureAt = null;
    registryLastError = null;
    registryConsecutiveFailures = 0;
    return rows.map(row => ({ ...row }));
  } catch (error) {
    registryLastFailureAt = Date.now();
    registryLastError = error instanceof Error ? error.message : String(error);
    registryConsecutiveFailures += 1;
    if (registryLastFailureAt - registryLastWarnAt >= REGISTRY_WARN_INTERVAL_MS) {
      registryLastWarnAt = registryLastFailureAt;
      logger.warn('[GhostWalletController] Borrower mandate registry degraded; preserving last-known-good cache', {
        component: 'GhostWalletAutonomousController',
        error: registryLastError,
        consecutiveFailures: registryConsecutiveFailures,
        cachedMandates: registryCache?.rows.length || 0,
        staleCachePreserved: Boolean(registryCache),
        routeLocalFailure: true,
      });
    }
    return registryCache?.rows.map(row => ({ ...row })) || [];
  }
}

function invalidateRegistryMandates(): void {
  if (registryCache) registryCache.expiresAt = 0;
}

async function standingMandates(): Promise<StandingBorrowerMandate[]> {
  const combined = [...configuredMandates(), ...await registryMandates()];
  const unique = new Map<string, StandingBorrowerMandate>();
  for (const mandate of combined) {
    const key = `${mandate.chain}:${mandate.borrower.toLowerCase()}:${mandate.asset.toLowerCase()}:${mandate.executionScope}`;
    if (!unique.has(key)) unique.set(key, mandate);
  }
  return [...unique.values()];
}

async function mandateExecutionState(mandate: StandingBorrowerMandate): Promise<MandateExecutionState> {
  const result = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status='SETTLED')::integer AS settled,
       count(*) FILTER (WHERE status IN ('QUEUED','CLAIMED','PROCESSING','SUBMITTED','RETRYABLE'))::integer AS active,
       count(*)::integer AS total,
       max(CASE WHEN status IN ('SUBMITTED','SETTLED')
                THEN COALESCE(submitted_at,settled_at,created_at)
                ELSE NULL END) AS last_committed_at
     FROM private.cryptocrawler_ghost_wallet_work
     WHERE kind='prepared_atomic_execution'
       AND chain=$2
       AND payload->>'mode'='broker_execution'
       AND payload->>'mandateId'=$1
       AND payload->>'mandateScope'=$3`,
    [mandate.id, mandate.chain, mandate.executionScope],
  );
  const row = result.rows[0] || {};
  const lastCommittedAt = row.last_committed_at ? new Date(String(row.last_committed_at)).getTime() : null;
  return {
    settled: Number(row.settled || 0),
    active: Number(row.active || 0),
    total: Number(row.total || 0),
    lastCommittedAt: Number.isFinite(lastCommittedAt) ? lastCommittedAt : null,
  };
}

function routeQuote(base: GhostWalletBorrowerQuoteResult, selected: GhostWalletBorrowerRouteQuote): GhostWalletBorrowerQuoteResult {
  return { ...base, selected, alternatives: [base.selected, ...base.alternatives].filter(route => route !== selected) };
}

class GhostWalletAutonomousController {
  private running = false;
  private evaluating = false;
  private pending = false;
  private timer: NodeJS.Timeout | null = null;
  private unsubscribeWake: (() => void) | null = null;
  private lastEvaluationAt: number | null = null;
  private lastOpportunityAt: number | null = null;
  private lastMandateCount = 0;
  private lastUnsupportedMandateCount = 0;
  private mandatesSeen = 0;
  private profitablePrepared = 0;
  private localFailures = 0;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.unsubscribeWake = ghostWalletWorkSignal.onWake(reason => this.requestEvaluation(reason));
    this.requestEvaluation('startup_backlog');
    logger.info('[GhostWalletController] Independent autonomous Ghost controller started', {
      component: 'GhostWalletAutonomousController',
      intermediaryRole: 'atomic_middleman_only',
      controllerOwnsOpportunityEvaluation: true,
      controllerOwnsTransactionInitiation: true,
      zeroCapitalSchedulerDependency: false,
      zeroCapitalExecutionAuthority: false,
      hardBpsProfitAdmissionFloor: false,
      configuredSpreadFloorBps: configuredSpreadFloorBps(),
      perTransactionSpreadCalibration: true,
      signedMandateExecutionLimits: true,
      signedMandateVersionIsolation: true,
      rangeAuthorizedDynamicSizing: true,
      nativeGasEconomicsAuthority: false,
      nativeGasEstimateRole: 'functional_preflight_and_spread_hint_only',
      pimlicoSponsoredUserOperationFinalEconomicsAuthority: true,
      boundedMatchingConcurrency: matchConcurrency(),
      eventInvalidatedMandateCache: true,
      strictPositiveAllInNetRequiredBeforeSubmission: true,
      observedChains: [...KNOWN_CHAINS],
      executableChains: [...PIMLICO_EXECUTION_CHAINS],
      continuousOperation: true,
    });
  }

  stop(): void {
    this.running = false;
    this.unsubscribeWake?.();
    this.unsubscribeWake = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  requestEvaluation(reason: GhostWalletWakeReason | 'work_completed'): void {
    if (!this.running) return;
    if (reason === 'explicit_refresh') invalidateRegistryMandates();
    this.pending = true;
    if (this.evaluating) return;
    queueMicrotask(() => { void this.evaluate(); });
  }

  getStatus() {
    return {
      running: this.running,
      liveExecutionEnabled: ghostWalletEngine.isLiveExecutionEnabled(),
      intermediarySubmitsTransactions: false as const,
      controllerInitiatesTransactions: true as const,
      zeroCapitalExecutionAuthority: false as const,
      lastEvaluationAt: this.lastEvaluationAt,
      lastOpportunityAt: this.lastOpportunityAt,
      lastMandateCount: this.lastMandateCount,
      lastUnsupportedMandateCount: this.lastUnsupportedMandateCount,
      mandatesSeen: this.mandatesSeen,
      profitablePrepared: this.profitablePrepared,
      localFailures: this.localFailures,
      matchConcurrency: matchConcurrency(),
      preflightConcurrency: preflightConcurrency(),
      sizeCandidateLimit: sizeCandidateLimit(),
      routePlanLimit: routePlanLimit(),
      mandateCacheTtlMs: mandateCacheTtlMs(),
      observedChains: [...KNOWN_CHAINS],
      supportedChains: [...PIMLICO_EXECUTION_CHAINS],
      registryHealthy: registryConsecutiveFailures === 0,
      registryLastSuccessAt,
      registryLastFailureAt,
      registryLastError,
      registryConsecutiveFailures,
      registryCachedMandates: registryCache?.rows.length || 0,
    };
  }

  private schedule(hasMandates: boolean): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.requestEvaluation('explicit_refresh');
    }, activeScanMs(hasMandates));
    this.timer.unref?.();
  }

  private async evaluate(): Promise<void> {
    if (!this.running || this.evaluating) return;
    this.evaluating = true;
    let hasMandates = false;
    try {
      do {
        this.pending = false;
        this.lastEvaluationAt = Date.now();
        const mandates = await standingMandates();
        const executableMandates = mandates.filter(mandate => PIMLICO_EXECUTION_CHAINS.has(mandate.chain));
        this.lastUnsupportedMandateCount = mandates.length - executableMandates.length;
        hasMandates = executableMandates.length > 0;
        this.lastMandateCount = mandates.length;
        this.mandatesSeen += mandates.length;
        if (executableMandates.length === 0) break;
        await mapBounded(executableMandates, matchConcurrency(), mandate => this.evaluateMandate(mandate));
      } while (this.running && this.pending);
    } finally {
      this.evaluating = false;
      this.schedule(hasMandates);
      if (this.pending) this.requestEvaluation('work_completed');
    }
  }

  private async preflightPlan(input: {
    mandate: StandingBorrowerMandate;
    quote: GhostWalletBorrowerQuoteResult;
    route: GhostWalletBorrowerRouteQuote;
    descriptorMinimumSpreadBps: number;
  }): Promise<PreflightCandidate> {
    const startedAt = Date.now();
    const amount = BigInt(input.quote.amountBaseUnits);
    const upstreamFee = BigInt(input.route.upstreamFeeBaseUnits);
    const bridgeFloor = spreadBaseUnits(amount, input.descriptorMinimumSpreadBps);
    const configuredFloor = spreadBaseUnits(amount, configuredSpreadFloorBps());
    let requestedSpread = maxBigInt(bridgeFloor, configuredFloor);
    const mandateMaxFee = input.mandate.maxBorrowerFeeBaseUnits === null
      ? null
      : BigInt(input.mandate.maxBorrowerFeeBaseUnits);
    if (mandateMaxFee !== null) {
      if (mandateMaxFee <= upstreamFee) throw new Error('GHOST_WALLET_ROUTE_BORROWER_FEE_CEILING_TOO_LOW');
      const authorizedSpreadCeiling = mandateMaxFee - upstreamFee;
      if (authorizedSpreadCeiling < requestedSpread) throw new Error('GHOST_WALLET_ROUTE_SPREAD_FLOOR_EXCEEDS_BORROWER_CEILING');
      requestedSpread = authorizedSpreadCeiling;
    }

    const routedQuote = routeQuote(input.quote, input.route);
    let lastError: unknown = null;
    let lastCandidate: PreflightCandidate | null = null;
    for (let pass = 0; pass < MAX_CALIBRATION_PASSES; pass += 1) {
      try {
        const prepared = buildGhostWalletBorrowerTransactionWithSpread({
          quote: routedQuote,
          requestedSpreadBaseUnits: requestedSpread,
          maxBorrowerFeeBaseUnits: mandateMaxFee,
        });
        const preflight = await ghostWalletProviderMesh.runHedged({
          chain: input.mandate.chain,
          operation: `route_preflight:${input.route.sourceKind}:${input.route.lender.toLowerCase()}`,
          execute: async provider => {
            const request = {
              from: ghostWalletEngine.getExecutionWallet(input.mandate.chain)?.address,
              to: prepared.to,
              data: prepared.data,
              value: prepared.value,
            };
            if (!request.from) throw new Error('GHOST_WALLET_CONTROLLER_WALLET_UNAVAILABLE');
            const [gasRaw, feeData] = await Promise.all([provider.estimateGas(request), provider.getFeeData()]);
            return { provider, gasRaw, pricing: resolveGhostWalletGasPricing(feeData) };
          },
        });
        const gasUnits = BigInt(preflight.gasRaw.toString());
        const expectedFeePerGas = BigInt(preflight.pricing.expectedFeePerGas.toString());
        let economics: Awaited<ReturnType<typeof evaluateGhostWalletControllerEconomics>> | null = null;
        let advisoryError: string | null = null;
        if (mandateMaxFee === null) {
          try {
            economics = await evaluateGhostWalletControllerEconomics({
              chain: input.mandate.chain,
              provider: preflight.provider,
              asset: input.mandate.asset,
              gasUnits,
              feePerGasWei: expectedFeePerGas,
              expectedSpreadBaseUnits: requestedSpread,
            });
          } catch (error) {
            advisoryError = error instanceof Error ? error.message : String(error);
          }
        }
        const candidate: PreflightCandidate = {
          quote: routedQuote,
          route: input.route,
          amount,
          requestedSpread,
          borrowerFee: prepared.borrowerFeeBaseUnits,
          prepared,
          economics,
          gasUnits,
          expectedFeePerGas,
          signingFeeCeilingPerGas: BigInt(preflight.pricing.signingFeeCeilingPerGas.toString()),
          pricingMode: preflight.pricing.mode,
          provider: preflight.provider,
          latencyMs: Date.now() - startedAt,
          advisoryError,
        };
        lastCandidate = candidate;
        recordGhostWalletPerformance({
          stage: 'route_preflight', chain: input.mandate.chain,
          routeKey: `${input.route.sourceKind}:${input.route.lender.toLowerCase()}:${amount}`,
          sourceKind: input.route.sourceKind, latencyMs: candidate.latencyMs, success: true,
          expectedNetProfitBaseUnits: economics?.expectedNetProfitBaseUnits ?? null,
        });
        if (mandateMaxFee !== null || !economics || economics.approved) return candidate;
        const nextSpread = maxBigInt(requestedSpread + 1n, economics.gasCostAssetBaseUnits + 1n);
        if (nextSpread <= requestedSpread) return candidate;
        requestedSpread = nextSpread;
      } catch (error) {
        lastError = error;
        break;
      }
    }
    if (lastCandidate) return lastCandidate;
    recordGhostWalletPerformance({
      stage: 'route_preflight', chain: input.mandate.chain,
      routeKey: `${input.route.sourceKind}:${input.route.lender.toLowerCase()}:${amount}`,
      sourceKind: input.route.sourceKind, latencyMs: Date.now() - startedAt, success: false,
      errorType: lastError instanceof Error ? lastError.message : String(lastError || 'preflight_failed'),
    });
    throw lastError || new Error('GHOST_WALLET_ROUTE_PREFLIGHT_FAILED');
  }

  private async evaluateMandate(mandate: StandingBorrowerMandate): Promise<void> {
    const startedAt = Date.now();
    try {
      if (!PIMLICO_EXECUTION_CHAINS.has(mandate.chain)) return;
      const now = Date.now();
      if (mandate.expiresAt !== null && mandate.expiresAt <= now) return;
      const executionState = await mandateExecutionState(mandate);
      if (executionState.settled >= mandate.maxExecutions) return;
      if (executionState.active > 0) return;
      if (executionState.lastCommittedAt !== null
        && mandate.minIntervalMs > 0
        && executionState.lastCommittedAt + mandate.minIntervalMs > now) return;

      const wallet = ghostWalletEngine.getExecutionWallet(mandate.chain);
      if (!wallet) return;
      const descriptor = await getGhostWalletExternalBridgeDescriptor(mandate.chain);
      if (!descriptor.deployed) {
        if (!ghostWalletEngine.isLiveExecutionEnabled() || !descriptor.deployment) return;
        await enqueueGhostWalletWork({
          dedupeKey: `ghost-controller:bridge-bootstrap:${mandate.chain}:${descriptor.address.toLowerCase()}`,
          kind: 'prepared_atomic_execution', chain: mandate.chain, priority: 1_000, maxAttempts: 20,
          payload: {
            mode: 'bridge_bootstrap', chain: mandate.chain,
            to: descriptor.deployment.to, data: descriptor.deployment.data, value: descriptor.deployment.value,
            verifyCodeAt: descriptor.address,
          },
        });
        ghostWalletWorkSignal.emitWake('local_work_enqueued');
        return;
      }

      const sizes = amountCandidates(mandate);
      const quotedSizes = await mapBounded(sizes, Math.min(2, sizes.length), async amount => ({
        amount,
        quote: await quoteGhostWalletBorrowerRoute({
          chain: mandate.chain,
          borrower: mandate.borrower,
          asset: mandate.asset,
          amountBaseUnits: amount.toString(),
          borrowerData: mandate.borrowerData,
        }),
      }));

      const plans: Array<{ quote: GhostWalletBorrowerQuoteResult; route: GhostWalletBorrowerRouteQuote; theoreticalSpread: bigint }> = [];
      for (const result of quotedSizes) {
        if (result.status !== 'fulfilled' || !result.value.quote.bridgeDeployed) continue;
        const { quote } = result.value;
        const routes = [quote.selected, ...quote.alternatives];
        for (const route of routes) {
          const upstreamFee = BigInt(route.upstreamFeeBaseUnits);
          const amount = BigInt(quote.amountBaseUnits);
          const floor = maxBigInt(
            spreadBaseUnits(amount, descriptor.minimumBrokerSpreadBps),
            spreadBaseUnits(amount, configuredSpreadFloorBps()),
          );
          const theoreticalSpread = mandate.maxBorrowerFeeBaseUnits === null
            ? floor
            : BigInt(mandate.maxBorrowerFeeBaseUnits) > upstreamFee
              ? BigInt(mandate.maxBorrowerFeeBaseUnits) - upstreamFee
              : 0n;
          if (theoreticalSpread < floor || theoreticalSpread <= 0n) continue;
          plans.push({ quote, route, theoreticalSpread });
        }
      }
      plans.sort((left, right) => {
        if (left.theoreticalSpread !== right.theoreticalSpread) return left.theoreticalSpread > right.theoreticalSpread ? -1 : 1;
        const leftPreferred = left.quote.amountBaseUnits === mandate.preferredAmountBaseUnits ? 1 : 0;
        const rightPreferred = right.quote.amountBaseUnits === mandate.preferredAmountBaseUnits ? 1 : 0;
        if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
        const leftFee = BigInt(left.route.upstreamFeeBaseUnits);
        const rightFee = BigInt(right.route.upstreamFeeBaseUnits);
        return leftFee === rightFee ? 0 : leftFee < rightFee ? -1 : 1;
      });

      const preflightPlans = plans.slice(0, routePlanLimit());
      const preflight = await mapBounded(preflightPlans, preflightConcurrency(), plan => this.preflightPlan({
        mandate,
        quote: plan.quote,
        route: plan.route,
        descriptorMinimumSpreadBps: descriptor.minimumBrokerSpreadBps,
      }));
      const candidates = preflight.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      candidates.sort((left, right) => {
        const leftNet = left.economics?.expectedNetProfitBaseUnits ?? left.requestedSpread;
        const rightNet = right.economics?.expectedNetProfitBaseUnits ?? right.requestedSpread;
        if (leftNet !== rightNet) return leftNet > rightNet ? -1 : 1;
        if (left.gasUnits !== right.gasUnits) return left.gasUnits < right.gasUnits ? -1 : 1;
        return left.latencyMs - right.latencyMs;
      });
      const best = candidates[0];
      if (!best) {
        recordGhostWalletPerformance({
          stage: 'mandate_match', chain: mandate.chain, routeKey: mandate.executionScope,
          latencyMs: Date.now() - startedAt, success: false, errorType: 'no_functionally_valid_route_size_plan',
        });
        return;
      }

      this.lastOpportunityAt = Date.now();
      if (!ghostWalletEngine.isLiveExecutionEnabled()) return;
      const executionSequence = executionState.total + 1;
      await enqueueGhostWalletWork({
        dedupeKey: `ghost-controller:broker:${mandate.id}:${mandate.executionScope}:${mandate.chain}:execution:${executionSequence}`,
        kind: 'prepared_atomic_execution', chain: mandate.chain, priority: 900, maxAttempts: 20,
        payload: {
          mode: 'broker_execution',
          chain: mandate.chain,
          mandateId: mandate.id,
          mandateScope: mandate.executionScope,
          mandateSource: mandate.source,
          mandateExecutionSequence: executionSequence,
          mandateMaxExecutions: mandate.maxExecutions,
          mandateMinIntervalMs: mandate.minIntervalMs,
          mandateAmountMode: mandate.amountMode,
          authorizedMinAmountBaseUnits: mandate.minAmountBaseUnits,
          authorizedPreferredAmountBaseUnits: mandate.preferredAmountBaseUnits,
          authorizedMaxAmountBaseUnits: mandate.maxAmountBaseUnits,
          to: best.prepared.to,
          data: best.prepared.data,
          value: best.prepared.value,
          borrower: mandate.borrower,
          asset: mandate.asset,
          amountBaseUnits: best.amount.toString(),
          sourceKind: best.route.sourceKind,
          lender: best.route.lender,
          expectedSpreadBaseUnits: best.requestedSpread.toString(),
          quotedBorrowerFeeBaseUnits: best.borrowerFee.toString(),
          quoteObservedAt: best.route.observedAt,
          preflightGasUnits: best.gasUnits.toString(),
          preflightExpectedFeePerGasWei: best.expectedFeePerGas.toString(),
          preflightSigningFeeCeilingPerGasWei: best.signingFeeCeilingPerGas.toString(),
          preflightGasPricingMode: best.pricingMode,
          preflightGasCostAssetBaseUnits: best.economics?.gasCostAssetBaseUnits.toString() || null,
          preflightExpectedNetProfitBaseUnits: best.economics?.expectedNetProfitBaseUnits.toString() || null,
          preflightAdvisoryError: best.advisoryError,
          preflightEconomicsAuthority: 'advisory_native_hint_only',
          finalEconomicsAuthority: 'pimlico_sponsored_user_operation',
          sizeCandidatesEvaluated: sizes.map(value => value.toString()),
          routePlansConsidered: plans.length,
          routePlansPreflighted: preflightPlans.length,
          calibrationPassLimit: MAX_CALIBRATION_PASSES,
        },
      });
      this.profitablePrepared += 1;
      recordGhostWalletPerformance({
        stage: 'prepared_enqueue', chain: mandate.chain,
        routeKey: `${best.route.sourceKind}:${best.route.lender.toLowerCase()}:${best.amount}`,
        sourceKind: best.route.sourceKind, latencyMs: Date.now() - startedAt, success: true,
        expectedNetProfitBaseUnits: best.economics?.expectedNetProfitBaseUnits ?? null,
      });
      recordGhostWalletPerformance({
        stage: 'mandate_match', chain: mandate.chain, routeKey: mandate.executionScope,
        latencyMs: Date.now() - startedAt, success: true,
        expectedNetProfitBaseUnits: best.economics?.expectedNetProfitBaseUnits ?? null,
      });
      ghostWalletWorkSignal.emitWake('local_work_enqueued');
    } catch (error) {
      this.localFailures += 1;
      recordGhostWalletPerformance({
        stage: 'mandate_match', chain: mandate.chain, routeKey: mandate.executionScope,
        latencyMs: Date.now() - startedAt, success: false,
        errorType: error instanceof Error ? error.message : String(error),
      });
      logger.debug('[GhostWalletController] Opportunity path failed locally', {
        component: 'GhostWalletAutonomousController',
        mandateId: mandate.id,
        mandateScope: mandate.executionScope,
        chain: mandate.chain,
        error: error instanceof Error ? error.message : String(error),
        routeLocalFailure: true,
      });
    }
  }
}

export const ghostWalletAutonomousController = new GhostWalletAutonomousController();

export const GHOST_WALLET_AUTONOMOUS_CONTROLLER_POLICY = {
  intermediaryRole: 'middleman_only',
  controllerOwnsInitiation: true,
  continuousEventPlusAdaptiveScan: true,
  eventInvalidatedMandateCache: true,
  boundedMatchingConcurrency: true,
  nativeEstimateBeforeQueue: 'functional_preflight_and_spread_hint_only',
  nativeGasEconomicsVetoAuthority: false,
  pimlicoSponsoredUserOperationFinalEconomicsAuthority: true,
  rangeAuthorizedDynamicSizing: true,
  strictPositiveAllInNetBeforeQueue: false,
  strictPositiveAllInNetBeforeSubmission: true,
  hardBpsProfitAdmissionFloor: false,
  configuredSpreadFloorDefaultBps: 0,
  perTransactionSpreadCalibrationFromNativeHint: true,
  signedFeeCeilingProfitSeekingWithinAuthorization: true,
  signedFeeCeilingAdvisoryPriceIoRequired: false,
  globalSpreadConfigurationTransactionRequired: false,
  signedMandateExecutionCountEnforced: true,
  signedMandateCadenceEnforced: true,
  signedMandateVersionIsolation: true,
  oneActiveExecutionPerMandate: true,
  durableSubmissionLedgerRequired: true,
  borrowerRegistryLastKnownGoodCache: true,
  borrowerRegistryFailureObservable: true,
  chainFailureLocal: true,
  zeroCapitalIntegration: false,
  observedChains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche'] as const,
  supportedExecutionChains: getGhostWalletPimlicoSupportedChains(),
} as const;
