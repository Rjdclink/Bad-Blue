import { providers } from 'ethers';

export const EUROPA_NETWORK = {
  chainId: 2_046_399_126,
  name: 'SKALE Europa',
  rpcUrl: 'https://mainnet.skalenodes.com/v1/europa',
  wsUrl: 'wss://mainnet.skalenodes.com/v1/ws/europa',
} as const;

export interface EuropaRpcHealth {
  endpoint: string;
  chainId: number;
  blockNumber: number;
  gasPriceWei: string;
  latencyMs: number;
  healthy: boolean;
  error?: string;
}

function normalizeEndpoint(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function getEuropaRpcUrls(environment: NodeJS.ProcessEnv = process.env): string[] {
  const configured = [
    environment.EUROPA_RPC_URL || '',
    ...(environment.EUROPA_RPC_FALLBACK_URLS || '').split(','),
    EUROPA_NETWORK.rpcUrl,
  ];
  return Array.from(new Set(configured.map(normalizeEndpoint).filter((url): url is string => !!url)));
}

export class EuropaRpcPool {
  private readonly providersByEndpoint = new Map<string, providers.JsonRpcProvider>();

  constructor(endpoints: string[] = getEuropaRpcUrls()) {
    if (endpoints.length === 0) {
      throw new Error('No valid Europa HTTPS RPC endpoint is configured');
    }
    for (const endpoint of endpoints) {
      this.providersByEndpoint.set(endpoint, new providers.JsonRpcProvider(endpoint));
    }
  }

  async healthCheck(): Promise<EuropaRpcHealth[]> {
    return Promise.all(Array.from(this.providersByEndpoint.entries()).map(async ([endpoint, provider]) => {
      const startedAt = Date.now();
      try {
        const [network, blockNumber, gasPrice] = await Promise.all([
          provider.getNetwork(),
          provider.getBlockNumber(),
          provider.getGasPrice(),
        ]);
        const latencyMs = Date.now() - startedAt;
        if (network.chainId !== EUROPA_NETWORK.chainId) {
          throw new Error(`Expected chain ID ${EUROPA_NETWORK.chainId}, received ${network.chainId}`);
        }
        if (blockNumber <= 0) {
          throw new Error('Europa RPC returned a non-positive block height');
        }
        return {
          endpoint,
          chainId: network.chainId,
          blockNumber,
          gasPriceWei: gasPrice.toString(),
          latencyMs,
          healthy: true,
        };
      } catch (error) {
        return {
          endpoint,
          chainId: 0,
          blockNumber: 0,
          gasPriceWei: '0',
          latencyMs: Date.now() - startedAt,
          healthy: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
  }

  async getHealthyProvider(): Promise<{ provider: providers.JsonRpcProvider; health: EuropaRpcHealth }> {
    const healthChecks = await this.healthCheck();
    const healthy = healthChecks.filter(check => check.healthy).sort((left, right) => left.latencyMs - right.latencyMs)[0];
    if (!healthy) {
      throw new Error(`No healthy Europa RPC endpoint: ${healthChecks.map(check => `${check.endpoint}: ${check.error || 'unhealthy'}`).join(' | ')}`);
    }
    const provider = this.providersByEndpoint.get(healthy.endpoint);
    if (!provider) throw new Error(`Europa provider disappeared for ${healthy.endpoint}`);
    return { provider, health: healthy };
  }

  async getTransaction(hash: string): Promise<providers.TransactionResponse | null> {
    for (const provider of this.providersByEndpoint.values()) {
      try {
        const transaction = await provider.getTransaction(hash);
        if (transaction) return transaction;
      } catch {
        // Try the next independently configured endpoint.
      }
    }
    return null;
  }

  async getTransactionReceipt(hash: string): Promise<providers.TransactionReceipt | null> {
    for (const provider of this.providersByEndpoint.values()) {
      try {
        const receipt = await provider.getTransactionReceipt(hash);
        if (receipt) return receipt;
      } catch {
        // Try the next independently configured endpoint.
      }
    }
    return null;
  }

  async broadcastSignedTransaction(signedTransaction: string): Promise<providers.TransactionResponse> {
    let lastError: unknown;
    for (const provider of this.providersByEndpoint.values()) {
      try {
        return await provider.sendTransaction(signedTransaction);
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Europa transaction broadcast failed across all configured endpoints: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async waitForReceipt(hash: string, timeoutMs: number): Promise<providers.TransactionReceipt> {
    const deadline = Date.now() + Math.max(1_000, timeoutMs);
    while (Date.now() < deadline) {
      const receipt = await this.getTransactionReceipt(hash);
      if (receipt) return receipt;
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    throw new Error(`Europa transaction ${hash} was not confirmed before the timeout`);
  }
}