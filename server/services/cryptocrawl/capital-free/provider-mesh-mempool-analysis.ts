import logger from '../../../logger.js';
import {
  ensureProviderMeshPendingStream,
  providerMeshPendingStream,
  type ProviderMeshPendingNetwork,
  type ProviderMeshPendingTransaction,
} from './provider-mesh-pending-stream.js';

export interface PendingTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  input: string;
  nonce: string;
  timestamp: number;
  potentialArbitrage: boolean;
  decodedMethod: string | null;
}

export interface MempoolAnalysis {
  available: boolean;
  observedAt: number | null;
  provenance: string[];
  totalPending: number;
  swapTransactions: number;
  liquidityAdditions: number;
  largeTransfers: number;
  arbitrageOpportunities: PendingTransaction[];
  avgGasPrice: number;
  maxGasPrice: number;
}

interface TxpoolPressureSample {
  network: ProviderMeshPendingNetwork;
  pendingCount: number;
  queuedCount: number;
  averageGasPriceWei: number;
  maxGasPriceWei: number;
  observedAt: number;
  source: string;
}

const PUBLIC_HTTP_ENDPOINTS: Record<ProviderMeshPendingNetwork, string> = {
  ethereum: 'https://eth.drpc.org/',
  polygon: 'https://polygon.drpc.org/',
};

const PRESSURE_SAMPLE_TTL_MS = Math.max(
  5_000,
  Math.min(60_000, Number(process.env.CRYPTOCRAWL_MEMPOOL_PRESSURE_TTL_MS || 15_000)),
);
const PRESSURE_REQUEST_TIMEOUT_MS = Math.max(
  500,
  Math.min(1_900, Number(process.env.CRYPTOCRAWL_MEMPOOL_PRESSURE_TIMEOUT_MS || 1_800)),
);
const RELEVANT_OBSERVATION_WINDOW_MS = Math.max(
  5_000,
  Math.min(120_000, Number(process.env.CRYPTOCRAWL_MEMPOOL_ANALYSIS_WINDOW_MS || 60_000)),
);
const MAX_GAS_SAMPLES_PER_POOL = Math.max(
  100,
  Math.min(10_000, Number(process.env.CRYPTOCRAWL_MEMPOOL_MAX_GAS_SAMPLES || 2_000)),
);

const pressureSamples = new Map<ProviderMeshPendingNetwork, TxpoolPressureSample>();
const pressureRefreshes = new Map<ProviderMeshPendingNetwork, Promise<void>>();

function configuredPressureNetworks(): ProviderMeshPendingNetwork[] {
  const supported = new Set<ProviderMeshPendingNetwork>(['ethereum', 'polygon']);
  const raw = process.env.CRYPTOCRAWL_MEMPOOL_PRESSURE_NETWORKS?.trim();
  if (!raw) return ['ethereum', 'polygon'];
  return [...new Set(
    raw.split(',')
      .map(value => value.trim().toLowerCase())
      .filter((value): value is ProviderMeshPendingNetwork => supported.has(value as ProviderMeshPendingNetwork)),
  )];
}

function parseGasPriceWei(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = Number(BigInt(value));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

function collectPoolTransactions(bucket: unknown): unknown[] {
  if (!bucket || typeof bucket !== 'object') return [];
  const output: unknown[] = [];
  for (const nonceMap of Object.values(bucket as Record<string, unknown>)) {
    if (!nonceMap || typeof nonceMap !== 'object') continue;
    for (const transaction of Object.values(nonceMap as Record<string, unknown>)) {
      if (transaction && typeof transaction === 'object') output.push(transaction);
    }
  }
  return output;
}

function pressureSampleFresh(sample: TxpoolPressureSample | undefined, now = Date.now()): sample is TxpoolPressureSample {
  return Boolean(sample && now - sample.observedAt <= PRESSURE_SAMPLE_TTL_MS);
}

async function refreshPressureNetwork(network: ProviderMeshPendingNetwork): Promise<void> {
  const current = pressureSamples.get(network);
  if (pressureSampleFresh(current)) return;
  const existing = pressureRefreshes.get(network);
  if (existing) return existing;

  const task = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PRESSURE_REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const response = await fetch(PUBLIC_HTTP_ENDPOINTS[network], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'txpool_content',
          params: [],
          id: Date.now(),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as {
        result?: { pending?: unknown; queued?: unknown };
        error?: { code?: number; message?: string };
      };
      if (payload.error) throw new Error(payload.error.message || `RPC ${payload.error.code ?? 'error'}`);
      if (!payload.result || typeof payload.result !== 'object') throw new Error('txpool_content returned no result');

      const pending = collectPoolTransactions(payload.result.pending);
      const queued = collectPoolTransactions(payload.result.queued);
      const gasPrices = pending
        .slice(0, MAX_GAS_SAMPLES_PER_POOL)
        .map(transaction => parseGasPriceWei((transaction as Record<string, unknown>).gasPrice))
        .filter((value): value is number => value !== null && value > 0);
      const sample: TxpoolPressureSample = {
        network,
        pendingCount: pending.length,
        queuedCount: queued.length,
        averageGasPriceWei: gasPrices.length > 0
          ? gasPrices.reduce((sum, value) => sum + value, 0) / gasPrices.length
          : 0,
        maxGasPriceWei: gasPrices.length > 0 ? Math.max(...gasPrices) : 0,
        observedAt: Date.now(),
        source: `drpc_public_txpool_content:${network}`,
      };
      pressureSamples.set(network, sample);
    } catch (error) {
      logger.debug('[ProviderMeshMempool] Route-local txpool pressure sample unavailable', {
        component: 'ProviderMeshMempoolAnalysis',
        network,
        error: error instanceof Error ? error.message : String(error),
        routeLocalFailure: true,
        priorFreshSamplePreserved: pressureSampleFresh(pressureSamples.get(network)),
        alchemyFallback: false,
      });
    } finally {
      clearTimeout(timeout);
    }
  })().finally(() => pressureRefreshes.delete(network));

  pressureRefreshes.set(network, task);
  return task;
}

function toPendingTransaction(transaction: ProviderMeshPendingTransaction): PendingTransaction {
  return {
    hash: transaction.hash,
    from: transaction.from,
    to: transaction.to,
    value: transaction.value,
    gas: transaction.gas,
    gasPrice: transaction.gasPrice,
    maxFeePerGas: transaction.maxFeePerGas,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    input: transaction.input,
    nonce: transaction.nonce,
    timestamp: transaction.timestamp,
    potentialArbitrage: transaction.potentialArbitrage,
    decodedMethod: transaction.decodedMethod,
  };
}

function largeTransfer(transaction: ProviderMeshPendingTransaction): boolean {
  try {
    return BigInt(transaction.value || '0') > 1_000_000_000_000_000_000n;
  } catch {
    return false;
  }
}

export function getProviderMeshMempoolAnalysis(): MempoolAnalysis {
  ensureProviderMeshPendingStream();
  const now = Date.now();
  const networks = configuredPressureNetworks();
  for (const network of networks) {
    if (!pressureSampleFresh(pressureSamples.get(network), now)) void refreshPressureNetwork(network);
  }

  const freshPressure = networks
    .map(network => pressureSamples.get(network))
    .filter((sample): sample is TxpoolPressureSample => pressureSampleFresh(sample, now));
  const observations = providerMeshPendingStream.getRecentObservations(RELEVANT_OBSERVATION_WINDOW_MS);
  const streamStats = providerMeshPendingStream.getStatistics();
  const gasPrices = freshPressure
    .map(sample => sample.averageGasPriceWei)
    .filter(value => Number.isFinite(value) && value > 0);
  const maxGasPrices = freshPressure
    .map(sample => sample.maxGasPriceWei)
    .filter(value => Number.isFinite(value) && value > 0);
  const observedAt = freshPressure.length > 0
    ? Math.max(...freshPressure.map(sample => sample.observedAt))
    : null;

  return {
    // Mempool pressure is declared available only when at least one current
    // txpool_content measurement exists. A working pending stream alone is not
    // converted into a synthetic pool-size estimate.
    available: freshPressure.length > 0,
    observedAt,
    provenance: [
      ...freshPressure.map(sample => sample.source),
      ...streamStats.activeNetworks.map(network => `provider_mesh_pending_stream:${network}`),
      'mempool_pressure:measured_not_inferred',
      'operator_billing_liability:false',
      'alchemy_dependency:false',
      'synthetic_evidence:false',
    ],
    totalPending: freshPressure.reduce((sum, sample) => sum + sample.pendingCount, 0),
    swapTransactions: observations.length,
    liquidityAdditions: 0,
    largeTransfers: observations.filter(largeTransfer).length,
    arbitrageOpportunities: observations
      .filter(transaction => transaction.potentialArbitrage)
      .slice(0, 50)
      .map(toPendingTransaction),
    avgGasPrice: gasPrices.length > 0
      ? gasPrices.reduce((sum, value) => sum + value, 0) / gasPrices.length
      : 0,
    maxGasPrice: maxGasPrices.length > 0 ? Math.max(...maxGasPrices) : 0,
  };
}

export async function refreshProviderMeshMempoolAnalysis(): Promise<MempoolAnalysis> {
  ensureProviderMeshPendingStream();
  await Promise.all(configuredPressureNetworks().map(network => refreshPressureNetwork(network)));
  return getProviderMeshMempoolAnalysis();
}

export function getProviderMeshMempoolPressureSnapshot() {
  const now = Date.now();
  return {
    observedAt: now,
    sampleTtlMs: PRESSURE_SAMPLE_TTL_MS,
    requestTimeoutMs: PRESSURE_REQUEST_TIMEOUT_MS,
    samples: configuredPressureNetworks().map(network => {
      const sample = pressureSamples.get(network);
      return sample
        ? { ...sample, fresh: pressureSampleFresh(sample, now) }
        : { network, pendingCount: null, queuedCount: null, averageGasPriceWei: null, maxGasPriceWei: null, observedAt: null, source: null, fresh: false };
    }),
    inFlightNetworks: [...pressureRefreshes.keys()],
    alchemyDependency: false,
  };
}
