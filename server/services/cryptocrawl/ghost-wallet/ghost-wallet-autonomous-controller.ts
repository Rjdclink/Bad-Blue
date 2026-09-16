import { ethers } from 'ethers';
import logger from '../../../logger.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { evaluateGhostWalletControllerEconomics } from './ghost-wallet-controller-economics.js';
import {
  buildGhostWalletBorrowerTransactionWithSpread,
  quoteGhostWalletBorrowerRoute,
} from './ghost-wallet-borrower-surface.js';
import { ghostWalletEngine } from './ghost-wallet-engine.js';
import { getGhostWalletExternalBridgeDescriptor } from './ghost-wallet-external-bridge.js';
import type { GhostWalletChain } from './ghost-wallet-provider-mesh.js';
import { enqueueGhostWalletWork } from './ghost-wallet-work-ledger.js';
import { ghostWalletWorkSignal, type GhostWalletWakeReason } from './ghost-wallet-work-signal.js';

const CHAINS = new Set<GhostWalletChain>(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche']);
const BPS = 10_000n;
const MAX_CALIBRATION_PASSES = 3;

interface StandingBorrowerMandate {
  id: string;
  executionScope: string;
  chain: GhostWalletChain;
  borrower: string;
  asset: string;
  amountBaseUnits: string;
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

function address(value: unknown): string | null {
  const raw = String(value || '').trim();
  return ethers.utils.isAddress(raw) ? ethers.utils.getAddress(raw) : null;
}

function chain(value: unknown): GhostWalletChain | null {
  const normalized = String(value || '').trim().toLowerCase() as GhostWalletChain;
  return CHAINS.has(normalized) ? normalized : null;
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
    const amountBaseUnits = positiveInteger(row?.amountBaseUnits);
    if (!parsedChain || !borrower || !asset || !amountBaseUnits) return [];
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
      amountBaseUnits,
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
  try {
    const result = await pool.query(
      `SELECT venue_id,chain,address,asset,metadata
       FROM private.cryptocrawler_ghost_wallet_venues
       WHERE enabled=true AND role IN ('borrower','both')
         AND lower(COALESCE(metadata->>'autonomous','false'))='true'
       ORDER BY verified DESC, last_verified_at DESC NULLS LAST, last_observed_at DESC`,
    );
    return result.rows.flatMap((row: any) => {
      const parsedChain = chain(row.chain);
      const borrower = address(row.address);
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      const asset = address(row.asset || metadata.asset);
      const amountBaseUnits = positiveInteger(metadata.amountBaseUnits);
      if (!parsedChain || !borrower || !asset || !amountBaseUnits) return [];
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
        amountBaseUnits,
        borrowerData: hexData(metadata.borrowerData),
        maxBorrowerFeeBaseUnits,
        expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
        maxExecutions: safePositiveCount(metadata.maxExecutions, 1),
        minIntervalMs,
        source: 'venue_registry' as const,
      }];
    });
  } catch {
    return [];
  }
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

class GhostWalletAutonomousController {
  private running = false;
  private evaluating = false;
  private pending = false;
  private timer: NodeJS.Timeout | null = null;
  private unsubscribeWake: (() => void) | null = null;
  private lastEvaluationAt: number | null = null;
  private lastOpportunityAt: number | null = null;
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
      strictPositiveAllInNetRequired: true,
      chains: [...CHAINS],
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

  requestEvaluation(_reason: GhostWalletWakeReason | 'work_completed'): void {
    if (!this.running) return;
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
      mandatesSeen: this.mandatesSeen,
      profitablePrepared: this.profitablePrepared,
      localFailures: this.localFailures,
      supportedChains: [...CHAINS],
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
        hasMandates = mandates.length > 0;
        this.mandatesSeen += mandates.length;
        if (mandates.length === 0) break;
        await Promise.allSettled(mandates.map(mandate => this.evaluateMandate(mandate)));
      } while (this.running && this.pending);
    } finally {
      this.evaluating = false;
      this.schedule(hasMandates);
      if (this.pending) this.requestEvaluation('explicit_refresh');
    }
  }

  private async evaluateMandate(mandate: StandingBorrowerMandate): Promise<void> {
    try {
      const now = Date.now();
      if (mandate.expiresAt !== null && mandate.expiresAt <= now) return;
      const executionState = await mandateExecutionState(mandate);
      if (executionState.settled >= mandate.maxExecutions) return;
      if (executionState.active > 0) return;
      if (executionState.lastCommittedAt !== null
        && mandate.minIntervalMs > 0
        && executionState.lastCommittedAt + mandate.minIntervalMs > now) return;

      const provider = ghostWalletEngine.getProvider(mandate.chain);
      const wallet = ghostWalletEngine.getExecutionWallet(mandate.chain);
      if (!provider || !wallet) return;
      const descriptor = await getGhostWalletExternalBridgeDescriptor(mandate.chain);

      if (!descriptor.deployed) {
        if (!ghostWalletEngine.isLiveExecutionEnabled() || !descriptor.deployment) return;
        await enqueueGhostWalletWork({
          dedupeKey: `ghost-controller:bridge-bootstrap:${mandate.chain}:${descriptor.address.toLowerCase()}`,
          kind: 'prepared_atomic_execution',
          chain: mandate.chain,
          priority: 1_000,
          maxAttempts: 20,
          payload: {
            mode: 'bridge_bootstrap', chain: mandate.chain,
            to: descriptor.deployment.to, data: descriptor.deployment.data, value: descriptor.deployment.value,
            verifyCodeAt: descriptor.address,
          },
        });
        ghostWalletWorkSignal.emitWake('local_work_enqueued');
        return;
      }

      const quote = await quoteGhostWalletBorrowerRoute({
        chain: mandate.chain,
        borrower: mandate.borrower,
        asset: mandate.asset,
        amountBaseUnits: mandate.amountBaseUnits,
        borrowerData: mandate.borrowerData,
      });
      if (!quote.bridgeDeployed) return;

      const amount = BigInt(mandate.amountBaseUnits);
      const bridgeFloorSpread = spreadBaseUnits(amount, descriptor.minimumBrokerSpreadBps);
      const configuredFloorSpread = spreadBaseUnits(amount, configuredSpreadFloorBps());
      let requestedSpread = maxBigInt(bridgeFloorSpread, configuredFloorSpread);
      const mandateMaxFee = mandate.maxBorrowerFeeBaseUnits === null
        ? null
        : BigInt(mandate.maxBorrowerFeeBaseUnits);
      let finalPrepared: ReturnType<typeof buildGhostWalletBorrowerTransactionWithSpread> | null = null;
      let finalEconomics: Awaited<ReturnType<typeof evaluateGhostWalletControllerEconomics>> | null = null;
      let finalGasUnits = 0n;
      let finalFeePerGas = 0n;

      for (let pass = 0; pass < MAX_CALIBRATION_PASSES; pass += 1) {
        const prepared = buildGhostWalletBorrowerTransactionWithSpread({
          quote,
          requestedSpreadBaseUnits: requestedSpread,
          maxBorrowerFeeBaseUnits: mandateMaxFee,
        });
        const request = { from: wallet.address, to: prepared.to, data: prepared.data, value: prepared.value };
        await provider.call(request);
        const [gasRaw, feeData] = await Promise.all([provider.estimateGas(request), provider.getFeeData()]);
        const gasUnits = BigInt(gasRaw.toString());
        const feePerGas = feeData.maxFeePerGas || feeData.gasPrice;
        if (!feePerGas || feePerGas.lte(0)) return;
        const economics = await evaluateGhostWalletControllerEconomics({
          chain: mandate.chain,
          provider,
          asset: mandate.asset,
          gasUnits,
          feePerGasWei: BigInt(feePerGas.toString()),
          expectedSpreadBaseUnits: requestedSpread,
        });
        if (economics.approved) {
          finalPrepared = prepared;
          finalEconomics = economics;
          finalGasUnits = gasUnits;
          finalFeePerGas = BigInt(feePerGas.toString());
          break;
        }
        const nextSpread = maxBigInt(requestedSpread + 1n, economics.gasCostAssetBaseUnits + 1n);
        if (nextSpread <= requestedSpread) return;
        requestedSpread = nextSpread;
      }

      if (!finalPrepared || !finalEconomics) return;
      const blockNumber = await provider.getBlockNumber();
      this.lastOpportunityAt = Date.now();
      if (!ghostWalletEngine.isLiveExecutionEnabled()) return;

      const executionSequence = executionState.total + 1;
      await enqueueGhostWalletWork({
        dedupeKey: `ghost-controller:broker:${mandate.id}:${mandate.executionScope}:${mandate.chain}:execution:${executionSequence}`,
        kind: 'prepared_atomic_execution',
        chain: mandate.chain,
        priority: 900,
        maxAttempts: 20,
        payload: {
          mode: 'broker_execution',
          chain: mandate.chain,
          mandateId: mandate.id,
          mandateScope: mandate.executionScope,
          mandateSource: mandate.source,
          mandateExecutionSequence: executionSequence,
          mandateMaxExecutions: mandate.maxExecutions,
          mandateMinIntervalMs: mandate.minIntervalMs,
          to: finalPrepared.to,
          data: finalPrepared.data,
          value: finalPrepared.value,
          borrower: mandate.borrower,
          asset: mandate.asset,
          amountBaseUnits: mandate.amountBaseUnits,
          sourceKind: quote.selected.sourceKind,
          lender: quote.selected.lender,
          expectedSpreadBaseUnits: requestedSpread.toString(),
          quotedBorrowerFeeBaseUnits: finalPrepared.borrowerFeeBaseUnits.toString(),
          quoteObservedAt: quote.selected.observedAt,
          preflightGasUnits: finalGasUnits.toString(),
          preflightFeePerGasWei: finalFeePerGas.toString(),
          preflightGasCostAssetBaseUnits: finalEconomics.gasCostAssetBaseUnits.toString(),
          preflightExpectedNetProfitBaseUnits: finalEconomics.expectedNetProfitBaseUnits.toString(),
          preflightBlockNumber: blockNumber,
          calibrationPassLimit: MAX_CALIBRATION_PASSES,
        },
      });
      this.profitablePrepared += 1;
      ghostWalletWorkSignal.emitWake('local_work_enqueued');
    } catch (error) {
      this.localFailures += 1;
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
  exactCallBeforeQueue: true,
  exactGasBeforeQueue: true,
  strictPositiveAllInNetBeforeQueue: true,
  hardBpsProfitAdmissionFloor: false,
  configuredSpreadFloorDefaultBps: 0,
  perTransactionSpreadCalibrationFromExactGas: true,
  globalSpreadConfigurationTransactionRequired: false,
  signedMandateExecutionCountEnforced: true,
  signedMandateCadenceEnforced: true,
  signedMandateVersionIsolation: true,
  oneActiveExecutionPerMandate: true,
  durableSubmissionLedgerRequired: true,
  chainFailureLocal: true,
  zeroCapitalIntegration: false,
  supportedChains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche'] as const,
} as const;