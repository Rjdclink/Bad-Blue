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

function measured(base: ZeroCapitalNetworkCapability, healthy: boolean, reason: string): ZeroCapitalNetworkCapability {
  return {
    ...base,
    executionReady: false,
    source: 'measured_runtime',
    reason: healthy ? reason : `Runtime observation unavailable: ${reason}`,
    executionAuthority: false,
    capitalMovementAuthority: false,
  };
}

async function observeSei(): Promise<NetworkObservation> {
  const id = 'evm:sei';
  const capability = getZeroCapitalNetworkCapability(id);
  if (!capability?.rpcUrl) return { id, healthy: false, latencyMs: 0, observedAt: Date.now(), reason: 'Sei RPC capability missing' };
  const startedAt = Date.now();
  try {
    const [chainIdHex, blockHex] = await Promise.all([
      rpc(capability.rpcUrl, 'eth_chainId'),
      rpc(capability.rpcUrl, 'eth_blockNumber'),
    ]);
    const chainId = Number.parseInt(String(chainIdHex), 16);
    const block = Number.parseInt(String(blockHex), 16);
    if (chainId !== 1329) throw new Error(`unexpected chain id ${chainId}`);
    if (!Number.isFinite(block) || block < 1) throw new Error('invalid block number');
    const observation = { id, healthy: true, latencyMs: Date.now() - startedAt, observedAt: Date.now(), blockOrSlot: block, identity: String(chainId) };
    recordMeasuredNetworkCapability(measured(capability, true, 'Fresh Sei EVM chain identity and block evidence verified; execution remains provider/receiver/funding gated.'));
    return observation;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    recordMeasuredNetworkCapability(measured(capability, false, reason));
    return { id, healthy: false, latencyMs: Date.now() - startedAt, observedAt: Date.now(), reason };
  }
}

async function observeSolana(): Promise<NetworkObservation> {
  const id = 'solana:mainnet-beta';
  const capability = getZeroCapitalNetworkCapability(id);
  if (!capability?.rpcUrl) return { id, healthy: false, latencyMs: 0, observedAt: Date.now(), reason: 'Solana RPC capability missing' };
  const startedAt = Date.now();
  try {
    const [health, latestBlockhash, slot] = await Promise.all([
      rpc(capability.rpcUrl, 'getHealth'),
      rpc(capability.rpcUrl, 'getLatestBlockhash', [{ commitment: 'confirmed' }]),
      rpc(capability.rpcUrl, 'getSlot', [{ commitment: 'confirmed' }]),
    ]);
    if (health !== 'ok') throw new Error(`RPC health=${String(health)}`);
    const blockhash = String(latestBlockhash?.value?.blockhash || '');
    const lastValidBlockHeight = Number(latestBlockhash?.value?.lastValidBlockHeight);
    if (!blockhash || !Number.isFinite(lastValidBlockHeight)) throw new Error('latest blockhash evidence incomplete');
    if (!Number.isFinite(Number(slot)) || Number(slot) < 1) throw new Error('invalid confirmed slot');
    const observation = {
      id,
      healthy: true,
      latencyMs: Date.now() - startedAt,
      observedAt: Date.now(),
      blockOrSlot: Number(slot),
      identity: 'mainnet-beta',
    };
    recordMeasuredNetworkCapability(measured(capability, true, 'Fresh Solana confirmed-slot/blockhash evidence verified; Jupiter atomic-principal capability remains execution-gated on native signer and non-operator fee payer proof.'));
    return observation;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    recordMeasuredNetworkCapability(measured(capability, false, reason));
    return { id, healthy: false, latencyMs: Date.now() - startedAt, observedAt: Date.now(), reason };
  }
}

async function observeOnce(): Promise<void> {
  const results = await Promise.allSettled([observeSei(), observeSolana()]);
  for (const result of results) {
    if (result.status === 'fulfilled') latest.set(result.value.id, result.value);
  }
  logger.debug('[ExpandedNetworkObservability] Capability observation completed', {
    component: 'ExpandedNetworkObservability',
    networks: [...latest.values()].map(value => ({ id: value.id, healthy: value.healthy, latencyMs: value.latencyMs, blockOrSlot: value.blockOrSlot })),
    credentialsLogged: false,
    executionAuthority: false,
    capitalMovementAuthority: false,
  });
}

export function ensureExpandedNetworkObservability(): void {
  if (installed) return;
  installed = true;
  void observeOnce();
  timer = setInterval(() => void observeOnce(), intervalMs());
  timer.unref?.();
  logger.info('[ExpandedNetworkObservability] Sei/Solana measured capability observers installed', {
    component: 'ExpandedNetworkObservability',
    seiMode: 'evm_discovery_only_until_zero_capital_execution_capability_proven',
    solanaMode: 'native_cluster_atomic_principal_observation_execution_fail_closed',
    fakeEvmChainIdZero: false,
    executionAuthority: false,
    capitalMovementAuthority: false,
  });
}

export function getExpandedNetworkObservabilitySnapshot(): NetworkObservation[] {
  return [...latest.values()].map(value => ({ ...value }));
}
