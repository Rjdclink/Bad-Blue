import { ethers } from 'ethers';
import logger from '../../../logger.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { evaluateGhostWalletControllerEconomics } from './ghost-wallet-controller-economics.js';
import { quoteGhostWalletBorrowerRoute } from './ghost-wallet-borrower-surface.js';
import { ghostWalletEngine } from './ghost-wallet-engine.js';
import { getGhostWalletExternalBridgeDescriptor } from './ghost-wallet-external-bridge.js';
import type { GhostWalletChain } from './ghost-wallet-provider-mesh.js';
import { enqueueGhostWalletWork } from './ghost-wallet-work-ledger.js';
import { ghostWalletWorkSignal, type GhostWalletWakeReason } from './ghost-wallet-work-signal.js';

const BRIDGE_OWNER_ABI = ['function setMinimumBrokerSpreadBps(uint16 spreadBps)'];
const CHAINS = new Set<GhostWalletChain>(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche']);
const BPS = 10_000n;
const MAX_BRIDGE_SPREAD_BPS = 1_000;

interface StandingBorrowerMandate {
  id: string;
  chain: GhostWalletChain;
  borrower: string;
  asset: string;
  amountBaseUnits: string;
  borrowerData: string;
  maxBorrowerFeeBaseUnits: string | null;
  expiresAt: number | null;
  source: 'environment' | 'venue_registry';
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

function configuredSpreadFloorBps(): number {
  const configured = Number(
    process.env.GHOST_WALLET_AUTONOMOUS_SPREAD_BPS
    || process.env.GHOST_WALLET_AUTONOMOUS_MIN_SPREAD_BPS
    || 0,
  );
  return Number.isFinite(configured)
    ? Math.max(0, Math.min(MAX_BRIDGE_SPREAD_BPS, Math.trunc(configured)))
    : 0;
}

function spreadBaseUnits(amount: bigint, spreadBps: number): bigint {
  if (amount <= 0n) return 0n;
  if (spreadBps <= 0) return 1n;
  const numerator = amount * BigInt(spreadBps);
  return (numerator + BPS - 1n) / BPS;
}

function requiredSpreadBps(amount: bigint, requiredSpread: bigint): number | null {
  if (amount <= 0n || requiredSpread <= 0n) return null;
  const result = (requiredSpread * BPS + amount - 1n) / amount;
  if (result > BigInt(MAX_BRIDGE_SPREAD_BPS)) return null;
  return Number(result);
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
    return [{
      id: String(row?.id || `env-${index}`).slice(0, 160),
      chain: parsedChain,
      borrower,
      asset,
      amountBaseUnits,
      borrowerData: hexData(row?.borrowerData),
      maxBorrowerFeeBaseUnits,
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
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
      const asset = address(row.asset || row.metadata?.asset);
      const amountBaseUnits = positiveInteger(row.metadata?.amountBaseUnits);
      if (!parsedChain || !borrower || !asset || !amountBaseUnits) return [];
      const maxBorrowerFeeBaseUnits = row.metadata?.maxBorrowerFeeBaseUnits === undefined
        ? null
        : positiveInteger(row.metadata.maxBorrowerFeeBaseUnits);
      const expiresAt = Number(row.metadata?.expiresAt);
      return [{
        id: String(row.venue_id).slice(0, 160),
        chain: parsedChain,
        borrower,
        asset,
        amountBaseUnits,
        borrowerData: hexData(row.metadata?.borrowerData),
        maxBorrowerFeeBaseUnits,
        expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
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
    const key = `${mandate.chain}:${mandate.borrower.toLowerCase()}:${mandate.asset.toLowerCase()}:${mandate.amountBaseUnits}:${mandate.borrowerData}`;
    if (!unique.has(key)) unique.set(key, mandate);
  }
  return [...unique.values()];
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
      dynamicSpreadCalibration: true,
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

  private async enqueueSpreadConfiguration(input: {
    mandate: StandingBorrowerMandate;
    bridge: string;
    spreadBps: number;
    reason: 'configured_floor' | 'dynamic_gas_calibration';
  }): Promise<void> {
    if (!ghostWalletEngine.isLiveExecutionEnabled()) return;
    const data = new ethers.utils.Interface(BRIDGE_OWNER_ABI)
      .encodeFunctionData('setMinimumBrokerSpreadBps', [input.spreadBps]);
    await enqueueGhostWalletWork({
      dedupeKey: `ghost-controller:spread-config:${input.mandate.chain}:${input.bridge.toLowerCase()}:${input.spreadBps}`,
      kind: 'prepared_atomic_execution',
      chain: input.mandate.chain,
      priority: 950,
      maxAttempts: 20,
      payload: {
        mode: 'bridge_spread_config',
        chain: input.mandate.chain,
        to: input.bridge,
        data,
        value: '0',
        verifySpreadBps: input.spreadBps,
        spreadReason: input.reason,
      },
    });
    ghostWalletWorkSignal.emitWake('local_work_enqueued');
  }

  private async evaluateMandate(mandate: StandingBorrowerMandate): Promise<void> {
    try {
      if (mandate.expiresAt !== null && mandate.expiresAt <= Date.now()) return;
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

      const configuredFloor = configuredSpreadFloorBps();
      if (configuredFloor > descriptor.minimumBrokerSpreadBps) {
        await this.enqueueSpreadConfiguration({
          mandate,
          bridge: descriptor.address,
          spreadBps: configuredFloor,
          reason: 'configured_floor',
        });
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
      const borrowerFee = BigInt(quote.selected.borrowerFeeBaseUnits);
      if (mandate.maxBorrowerFeeBaseUnits !== null && borrowerFee > BigInt(mandate.maxBorrowerFeeBaseUnits)) return;

      const request = { from: wallet.address, to: quote.transaction.to, data: quote.transaction.data, value: quote.transaction.value };
      await provider.call(request);
      const [gasRaw, feeData, blockNumber] = await Promise.all([
        provider.estimateGas(request), provider.getFeeData(), provider.getBlockNumber(),
      ]);
      const gasUnits = BigInt(gasRaw.toString());
      const feePerGas = feeData.maxFeePerGas || feeData.gasPrice;
      if (!feePerGas || feePerGas.lte(0)) return;
      const economics = await evaluateGhostWalletControllerEconomics({
        chain: mandate.chain,
        provider,
        asset: mandate.asset,
        gasUnits,
        feePerGasWei: BigInt(feePerGas.toString()),
        expectedSpreadBaseUnits: BigInt(quote.selected.ghostSpreadBaseUnits),
      });

      if (!economics.approved) {
        const amount = BigInt(mandate.amountBaseUnits);
        const neededSpread = economics.gasCostAssetBaseUnits + 1n;
        const calibratedBps = requiredSpreadBps(amount, neededSpread);
        if (calibratedBps === null || calibratedBps <= descriptor.minimumBrokerSpreadBps) return;
        const calibratedSpread = spreadBaseUnits(amount, calibratedBps);
        const calibratedBorrowerFee = BigInt(quote.selected.upstreamFeeBaseUnits) + calibratedSpread;
        if (mandate.maxBorrowerFeeBaseUnits !== null
          && calibratedBorrowerFee > BigInt(mandate.maxBorrowerFeeBaseUnits)) return;
        await this.enqueueSpreadConfiguration({
          mandate,
          bridge: descriptor.address,
          spreadBps: calibratedBps,
          reason: 'dynamic_gas_calibration',
        });
        return;
      }

      this.lastOpportunityAt = Date.now();
      if (!ghostWalletEngine.isLiveExecutionEnabled()) return;

      await enqueueGhostWalletWork({
        dedupeKey: `ghost-controller:broker:${mandate.id}:${mandate.chain}:${blockNumber}:${quote.selected.sourceKind}:${quote.selected.lender.toLowerCase()}`,
        kind: 'prepared_atomic_execution',
        chain: mandate.chain,
        priority: 900,
        maxAttempts: 20,
        payload: {
          mode: 'broker_execution',
          chain: mandate.chain,
          mandateId: mandate.id,
          mandateSource: mandate.source,
          to: quote.transaction.to,
          data: quote.transaction.data,
          value: quote.transaction.value,
          borrower: mandate.borrower,
          asset: mandate.asset,
          amountBaseUnits: mandate.amountBaseUnits,
          sourceKind: quote.selected.sourceKind,
          lender: quote.selected.lender,
          expectedSpreadBaseUnits: quote.selected.ghostSpreadBaseUnits,
          quotedBorrowerFeeBaseUnits: quote.selected.borrowerFeeBaseUnits,
          quoteObservedAt: quote.selected.observedAt,
          preflightGasUnits: gasUnits.toString(),
          preflightFeePerGasWei: feePerGas.toString(),
          preflightGasCostAssetBaseUnits: economics.gasCostAssetBaseUnits.toString(),
          preflightExpectedNetProfitBaseUnits: economics.expectedNetProfitBaseUnits.toString(),
          preflightBlockNumber: blockNumber,
        },
      });
      this.profitablePrepared += 1;
      ghostWalletWorkSignal.emitWake('local_work_enqueued');
    } catch (error) {
      this.localFailures += 1;
      logger.debug('[GhostWalletController] Opportunity path failed locally', {
        component: 'GhostWalletAutonomousController',
        mandateId: mandate.id,
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
  dynamicSpreadCalibrationFromExactGas: true,
  durableSubmissionLedgerRequired: true,
  chainFailureLocal: true,
  zeroCapitalIntegration: false,
  supportedChains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche'] as const,
} as const;