import logger from '../../../logger.js';
import {
  getZeroCapitalNetworkCapability,
  recordMeasuredNetworkCapability,
  type ZeroCapitalNetworkCapability,
} from './zero-capital-network-capability-registry.js';

interface NetworkObservation {
  id: string;
  healthy: boolean;
  latencyMs: number;
  observedAt: number;
  blockOrSlot?: number;
  identity?: string;
  reason?: string;
}

let installed = false;
let timer: NodeJS.Timeout | null = null;
const latest = new Map<string, NetworkObservation>();

function intervalMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_EXPANDED_NETWORK_OBSERVE_MS || 60_000);
  return Number.isFinite(parsed) ? Math.max(15_000, Math.min(10 * 60_000, Math.trunc(parsed))) : 60_000;
}

async function rpc(url: string, method: string, params: unknown[] = []): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { result?: any; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message || `${method} failed`);
    return body.result;
  } finally {
    clearTimeout(timeout);
  }
}

function observed(base: ZeroCapitalNetworkCapability, healthy: boolean, reason: string): ZeroCapitalNetworkCapability {
  const observedAt = Date.now();
  return {
    ...base,
    rpcUrl: base.id === 'evm:sei'
      ? (process.env.SEI_EVM_RPC_URL?.trim() || base.rpcUrl)
      : base.id === 'solana:mainnet-beta'
        ? (process.env.SOLANA_RPC_URL?.trim() || base.rpcUrl)
        : base.rpcUrl,
    bootstrapEligible: false,
    providerEvidenceReady: false,
    feePaymentEvidenceReady: false,
    settlementEvidenceReady: false,
    executionReady: false,
    source: 'measured_runtime',
    observedAt,
    expiresAt: observedAt + Math.max(intervalMs() * 3, 60_000),
    provenance: [...new Set([...base.provenance, healthy ? 'fresh_rpc_identity_observed' : 'rpc_identity_observation_failed'])],
    reason: healthy ? reason : `Runtime observation unavailable: ${reason}`,
    executionAuthority: false,
    capitalMovementAuthority: false,
  };
}

async function observeSei(): Promise<NetworkObservation> {
  const id = 'evm:sei';
  const capability = getZeroCapitalNetworkCapability(id);
  if (!capability) return { id, healthy: false, latencyMs: 0, observedAt: Date.now(), reason: 'Sei capability unavailable or stale' };
  const url = process.env.SEI_EVM_RPC_URL?.trim() || capability.rpcUrl;
  if (!url) return { id, healthy: false, latencyMs: 0, observedAt: Date.now(), reason: 'Sei RPC unavailable' };
  const startedAt = Date.now();
  try {
    const [chainIdHex, blockHex] = await Promise.all([rpc(url, 'eth_chainId'), rpc(url, 'eth_blockNumber')]);
    const chainId = Number.parseInt(String(chainIdHex), 16);
    const block = Number.parseInt(String(blockHex), 16);
    if (chainId !== 1329) throw new Error(`unexpected chain id ${chainId}`);
    if (!Number.isFinite(block) || block < 1) throw new Error('invalid block number');
    const result = { id, healthy: true, latencyMs: Date.now() - startedAt, observedAt: Date.now(), blockOrSlot: block, identity: String(chainId) };
    recordMeasuredNetworkCapability(observed(capability, true, 'Fresh Sei EVM chain identity and block evidence verified; execution remains zero-capital route-evidence gated.'));
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    recordMeasuredNetworkCapability(observed(capability, false, reason));
    return { id, healthy: false, latencyMs: Date.now() - startedAt, observedAt: Date.now(), reason };
  }
}

async function observeSolana(): Promise<NetworkObservation> {
  const id = 'solana:mainnet-beta';
  const capability = getZeroCapitalNetworkCapability(id);
  if (!capability) return { id, healthy: false, latencyMs: 0, observedAt: Date.now(), reason: 'Solana capability unavailable or stale' };
  const url = process.env.SOLANA_RPC_URL?.trim() || capability.rpcUrl;
  if (!url) return { id, healthy: false, latencyMs: 0, observedAt: Date.now(), reason: 'Solana RPC unavailable' };
  const startedAt = Date.now();
  try {
    const [latestBlockhash, slot] = await Promise.all([
      rpc(url, 'getLatestBlockhash', [{ commitment: 'confirmed' }]),
      rpc(url, 'getSlot', [{ commitment: 'confirmed' }]),
    ]);
    const blockhash = String(latestBlockhash?.value?.blockhash || '');
    const lastValidBlockHeight = Number(latestBlockhash?.value?.lastValidBlockHeight);
    if (!blockhash || !Number.isFinite(lastValidBlockHeight)) throw new Error('latest blockhash evidence incomplete');
    if (!Number.isFinite(Number(slot)) || Number(slot) < 1) throw new Error('invalid confirmed slot');
    const result = { id, healthy: true, latencyMs: Date.now() - startedAt, observedAt: Date.now(), blockOrSlot: Number(slot), identity: 'mainnet-beta' };
    recordMeasuredNetworkCapability(observed(capability, true, 'Fresh Solana confirmed-slot/blockhash evidence verified; execution remains native signer/fee-payer/funding/settlement gated.'));
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    recordMeasuredNetworkCapability(observed(capability, false, reason));
    return { id, healthy: false, latencyMs: Date.now() - startedAt, observedAt: Date.now(), reason };
  }
}

async function observeOnce(): Promise<void> {
  const results = await Promise.allSettled([observeSei(), observeSolana()]);
  for (const result of results) if (result.status === 'fulfilled') latest.set(result.value.id, result.value);
  logger.debug('[ExpandedNetworkObservability] Advisory capability observation completed', {
    component: 'ExpandedNetworkObservability',
    networks: [...latest.values()].map(value => ({ id: value.id, healthy: value.healthy, latencyMs: value.latencyMs, blockOrSlot: value.blockOrSlot })),
    executionAuthority: false,
    capitalMovementAuthority: false,
  });
}

export function ensureExpandedNetworkObservability(): void {
  if (installed) return;
  installed = true;
  void observeOnce();
  if (process.env.NO_INTERVALS !== 'true') {
    timer = setInterval(() => void observeOnce(), intervalMs());
    timer.unref?.();
  }
  logger.info('[ExpandedNetworkObservability] Advisory Sei/Solana observers installed', {
    component: 'ExpandedNetworkObservability',
    seiMode: 'identity_and_health_only_execution_fail_closed',
    solanaMode: 'native_identity_and_blockhash_only_execution_fail_closed',
    fakeEvmChainIdZero: false,
    executionAuthority: false,
    capitalMovementAuthority: false,
  });
}

export function stopExpandedNetworkObservability(): void {
  if (timer) clearInterval(timer);
  timer = null;
  installed = false;
}

export function getExpandedNetworkObservabilitySnapshot(): NetworkObservation[] {
  return [...latest.values()].map(value => ({ ...value }));
}