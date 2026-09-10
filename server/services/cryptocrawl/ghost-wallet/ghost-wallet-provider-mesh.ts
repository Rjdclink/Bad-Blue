import { providers } from 'ethers';
import logger from '../../../logger.js';

export type GhostWalletChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base' | 'bsc' | 'avalanche';

const CHAIN_IDS: Record<GhostWalletChain, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  bsc: 56,
  avalanche: 43114,
};

const HTTP_PUBLIC: Record<GhostWalletChain, string[]> = {
  ethereum: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'],
  polygon: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
  arbitrum: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
  optimism: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'],
  base: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'],
  bsc: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org'],
  avalanche: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://api.avax.network/ext/bc/C/rpc'],
};

const WS_PUBLIC: Partial<Record<GhostWalletChain, string[]>> = {
  ethereum: ['wss://ethereum-rpc.publicnode.com', 'wss://ethereum.drpc.org'],
  polygon: ['wss://polygon-bor-rpc.publicnode.com', 'wss://polygon.drpc.org'],
  arbitrum: ['wss://arbitrum-one-rpc.publicnode.com', 'wss://arbitrum.drpc.org'],
  optimism: ['wss://optimism-rpc.publicnode.com', 'wss://optimism.drpc.org'],
  base: ['wss://base-rpc.publicnode.com', 'wss://base.drpc.org'],
  bsc: ['wss://bsc-rpc.publicnode.com', 'wss://bsc.drpc.org'],
  avalanche: ['wss://avalanche-c-chain-rpc.publicnode.com', 'wss://avalanche.drpc.org'],
};

interface Candidate {
  label: string;
  url: string;
  provider: providers.JsonRpcProvider;
  latencyMs: number;
}

function uniq(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function envHttp(chain: GhostWalletChain): string[] {
  const upper = chain.toUpperCase();
  const values = [
    process.env[`${upper}_RPC_URL`],
    ...(chain === 'ethereum' ? [process.env.ETHEREM_RPC_URL, process.env.RPC_URL, process.env.PRIVATE_RPC_URL] : []),
    ...(chain === 'bsc' ? [process.env.BNB_SMART_CHAIN_RPC_URL] : []),
  ];
  return uniq(values).filter(url => /^https?:\/\//i.test(url) && !/alchemy\.com/i.test(url));
}

function envWs(chain: GhostWalletChain): string[] {
  const upper = chain.toUpperCase();
  return uniq([
    process.env[`${upper}_WS_URL`],
    process.env[`${upper}_WEBSOCKET`],
    ...(chain === 'ethereum' ? [process.env.PRIVATE_WS_URL] : []),
  ]).filter(url => /^wss?:\/\//i.test(url) && !/alchemy\.com/i.test(url));
}

function infuraSlug(chain: GhostWalletChain): string | null {
  if (chain === 'ethereum') return 'mainnet';
  if (chain === 'polygon') return 'polygon-mainnet';
  if (chain === 'arbitrum') return 'arbitrum-mainnet';
  if (chain === 'optimism') return 'optimism-mainnet';
  if (chain === 'base') return 'base-mainnet';
  if (chain === 'avalanche') return 'avalanche-mainnet';
  return null;
}

function infuraProjectId(): string | null {
  return process.env.INFURA_API_KEY?.trim()
    || process.env.INFURA_PUBLIC_ID?.trim()
    || null;
}

function configuredHttpUrls(chain: GhostWalletChain): Array<{ label: string; url: string }> {
  const result: Array<{ label: string; url: string }> = [];
  for (const url of envHttp(chain)) result.push({ label: 'railway-configured', url });
  const infura = infuraProjectId();
  const slug = infuraSlug(chain);
  if (infura && slug) result.push({ label: 'infura', url: `https://${slug}.infura.io/v3/${infura}` });
  HTTP_PUBLIC[chain].forEach((url, index) => result.push({ label: `public-${index + 1}`, url }));
  return [...new Map(result.map(row => [row.url, row])).values()];
}

export function ghostWalletWebSocketUrls(chain: GhostWalletChain): string[] {
  const result = [...envWs(chain)];
  const infura = infuraProjectId();
  const slug = infuraSlug(chain);
  if (infura && slug) result.push(`wss://${slug}.infura.io/ws/v3/${infura}`);
  result.push(...(WS_PUBLIC[chain] || []));
  return uniq(result).filter(url => !/alchemy\.com/i.test(url));
}

function timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

class GhostWalletProviderMesh {
  private readonly healthy = new Map<GhostWalletChain, Candidate[]>();
  private readonly initialized = new Set<GhostWalletChain>();
  private readonly inFlight = new Map<GhostWalletChain, Promise<void>>();

  async initialize(chains: GhostWalletChain[] = Object.keys(CHAIN_IDS) as GhostWalletChain[]): Promise<void> {
    const settled = await Promise.allSettled(chains.map(chain => this.ensureChain(chain)));
    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        const chain = chains[index];
        logger.warn('[GhostWalletProviderMesh] Chain unavailable; other Ghost routes remain live', {
          component: 'GhostWalletProviderMesh',
          chain,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          routeLocalFailure: true,
          alchemyEligible: false,
        });
      }
    });
  }

  async ensureChain(chain: GhostWalletChain): Promise<void> {
    if (this.initialized.has(chain)) return;
    const existing = this.inFlight.get(chain);
    if (existing) return existing;
    const work = this.probeChain(chain).finally(() => this.inFlight.delete(chain));
    this.inFlight.set(chain, work);
    return work;
  }

  private async probeChain(chain: GhostWalletChain): Promise<void> {
    const expectedChainId = CHAIN_IDS[chain];
    const candidates = configuredHttpUrls(chain);
    const measured = await Promise.allSettled(candidates.map(async row => {
      const provider = new providers.JsonRpcProvider(row.url, expectedChainId);
      const startedAt = Date.now();
      const [network, block] = await timeout(
        Promise.all([provider.getNetwork(), provider.getBlockNumber()]),
        5_000,
        `Ghost ${chain} ${row.label}`,
      );
      if (network.chainId !== expectedChainId || block < 0) throw new Error('chain identity mismatch');
      return { ...row, provider, latencyMs: Date.now() - startedAt } as Candidate;
    }));
    const healthy = measured
      .filter((result): result is PromiseFulfilledResult<Candidate> => result.status === 'fulfilled')
      .map(result => result.value)
      .sort((a, b) => a.latencyMs - b.latencyMs);
    if (healthy.length === 0) {
      this.healthy.delete(chain);
      this.initialized.delete(chain);
      throw new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${chain}`);
    }
    this.healthy.set(chain, healthy);
    this.initialized.add(chain);
    logger.info('[GhostWalletProviderMesh] Alchemy-free RPC redundancy ready', {
      component: 'GhostWalletProviderMesh',
      chain,
      selected: healthy[0].label,
      healthyProviders: healthy.map(row => ({ label: row.label, latencyMs: row.latencyMs })),
      alchemyEligible: false,
      periodicHealthPolling: false,
    });
  }

  async getProvider(chain: string): Promise<providers.JsonRpcProvider | null> {
    const normalized = chain.trim().toLowerCase() as GhostWalletChain;
    if (!(normalized in CHAIN_IDS)) return null;
    await this.ensureChain(normalized);
    return this.healthy.get(normalized)?.[0]?.provider || null;
  }

  async getProviders(chain: string): Promise<providers.JsonRpcProvider[]> {
    const normalized = chain.trim().toLowerCase() as GhostWalletChain;
    if (!(normalized in CHAIN_IDS)) return [];
    await this.ensureChain(normalized);
    return (this.healthy.get(normalized) || []).map(row => row.provider);
  }

  getReadyProvider(chain: string): providers.JsonRpcProvider | null {
    const normalized = chain.trim().toLowerCase() as GhostWalletChain;
    return this.healthy.get(normalized)?.[0]?.provider || null;
  }

  getReadyChains(): GhostWalletChain[] {
    return [...this.healthy.entries()].filter(([, rows]) => rows.length > 0).map(([chain]) => chain);
  }

  getStatus() {
    return [...this.healthy.entries()].map(([chain, rows]) => ({
      chain,
      selected: rows[0]?.label || null,
      redundancy: rows.length,
      alchemy: false,
      websocketCandidates: ghostWalletWebSocketUrls(chain).length,
    }));
  }
}

export const ghostWalletProviderMesh = new GhostWalletProviderMesh();

export const GHOST_WALLET_PROVIDER_POLICY = {
  alchemyAllowed: false,
  configuredRailwayRpcPreferred: true,
  independentPublicFallbacks: true,
  parallelInitialProbe: true,
  routeLocalFailure: true,
  periodicHealthPolling: false,
} as const;
