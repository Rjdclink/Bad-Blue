// Blockchain API Services - Alchemy (Access) + Etherscan (Data)
// Implements hyper-optimized API layer with advanced rate limiting

import { ethers } from 'ethers';
import logger from '../../../logger.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type SupportedChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base';

export interface BlockchainProviderConfig {
  chain: SupportedChain;
  alchemyApiKey?: string;
  etherscanApiKey?: string;
  region?: EdenRegion;
}

export type RpcTransport = 'http' | 'websocket';
export type RpcProviderState = 'unconfigured' | 'connecting' | 'healthy' | 'degraded' | 'cooldown' | 'unavailable' | 'shutting_down';

export interface RpcHealthObservation {
  provider: string;
  chain: SupportedChain;
  transport: RpcTransport;
  state: RpcProviderState;
  success: boolean;
  latencyMs: number | null;
  observedAt: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastError?: string;
}

export interface WebSocketTransportLike {
  on(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
  removeAllListeners?(): void;
  close?(): void;
  terminate?(): void;
}

export function attachWebSocketTransportGuards(
  socket: WebSocketTransportLike,
  handlers: { onOpen?: () => void; onFailure: (error?: unknown) => void; onClose?: () => void },
): () => void {
  let failed = false;
  const onOpen = () => handlers.onOpen?.();
  const onError = (error: unknown) => {
    if (failed) return;
    failed = true;
    handlers.onFailure(error);
  };
  const onClose = () => {
    if (!failed) failed = true;
    handlers.onClose?.();
  };
  socket.on('open', onOpen);
  socket.on('error', onError);
  socket.on('close', onClose);
  return () => {
    socket.removeListener?.('open', onOpen);
    socket.removeListener?.('error', onError);
    socket.removeListener?.('close', onClose);
  };
}

export async function probeRpcEndpoint(
  provider: string,
  chain: SupportedChain,
  url: string,
): Promise<RpcHealthObservation> {
  const observedAt = Date.now();
  const rpc = new ethers.providers.JsonRpcProvider(url);
  try {
    const startedAt = Date.now();
    const [network, blockNumber] = await Promise.all([rpc.getNetwork(), rpc.getBlockNumber()]);
    if (network.chainId <= 0 || blockNumber < 0) throw new Error('RPC returned invalid network evidence');
    return {
      provider, chain, transport: 'http', state: 'healthy', success: true,
      latencyMs: Date.now() - startedAt, observedAt, consecutiveFailures: 0, consecutiveSuccesses: 1,
    };
  } catch (error) {
    return {
      provider, chain, transport: 'http', state: 'unavailable', success: false,
      latencyMs: null, observedAt, consecutiveFailures: 1, consecutiveSuccesses: 0,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

export type EdenRegion = 
  | 'us-east-1'      // New York - Primary Eden
  | 'us-west-2'      // AWS us-west (backup)
  | 'eu-central-1'   // Frankfurt
  | 'eu-west-2'      // London
  | 'ap-northeast-1' // Tokyo
  | 'ap-southeast-1' // Singapore
  | 'local';         // Local development

export interface RateLimitConfig {
  maxRequestsPerSecond: number;
  burstLimit: number;
  cooldownMs: number;
  adaptiveThrottling: boolean;
}

export interface GasData {
  baseFee: string;
  maxPriorityFee: string;
  maxFee: string;
  gasPrice: string;
  timestamp: number;
}

export interface BlockData {
  number: number;
  hash: string;
  timestamp: number;
  transactions: string[];
  baseFeePerGas?: string;
}

export interface TransactionData {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  gasPrice: string;
  gasLimit: string;
  nonce: number;
  data: string;
  blockNumber: number | null;
  status?: 'pending' | 'confirmed' | 'failed';
}

export interface TokenTransfer {
  from: string;
  to: string;
  tokenAddress: string;
  value: string;
  tokenSymbol: string;
  tokenDecimals: number;
  transactionHash: string;
  blockNumber: number;
}

export interface ContractVerification {
  verified: boolean;
  contractName?: string;
  compiler?: string;
  sourceCode?: string;
  abi?: any[];
}

// ============================================================================
// ALCHEMY ENDPOINTS BY CHAIN AND REGION
// ============================================================================

const ALCHEMY_ENDPOINTS: Record<SupportedChain, Record<EdenRegion, string>> = {
  ethereum: {
    'us-east-1': 'https://eth-mainnet.g.alchemy.com/v2',
    'us-west-2': 'https://eth-mainnet.g.alchemy.com/v2',
    'eu-central-1': 'https://eth-mainnet.g.alchemy.com/v2',
    'eu-west-2': 'https://eth-mainnet.g.alchemy.com/v2',
    'ap-northeast-1': 'https://eth-mainnet.g.alchemy.com/v2',
    'ap-southeast-1': 'https://eth-mainnet.g.alchemy.com/v2',
    'local': 'https://eth-mainnet.g.alchemy.com/v2'
  },
  polygon: {
    'us-east-1': 'https://polygon-mainnet.g.alchemy.com/v2',
    'us-west-2': 'https://polygon-mainnet.g.alchemy.com/v2',
    'eu-central-1': 'https://polygon-mainnet.g.alchemy.com/v2',
    'eu-west-2': 'https://polygon-mainnet.g.alchemy.com/v2',
    'ap-northeast-1': 'https://polygon-mainnet.g.alchemy.com/v2',
    'ap-southeast-1': 'https://polygon-mainnet.g.alchemy.com/v2',
    'local': 'https://polygon-mainnet.g.alchemy.com/v2'
  },
  arbitrum: {
    'us-east-1': 'https://arb-mainnet.g.alchemy.com/v2',
    'us-west-2': 'https://arb-mainnet.g.alchemy.com/v2',
    'eu-central-1': 'https://arb-mainnet.g.alchemy.com/v2',
    'eu-west-2': 'https://arb-mainnet.g.alchemy.com/v2',
    'ap-northeast-1': 'https://arb-mainnet.g.alchemy.com/v2',
    'ap-southeast-1': 'https://arb-mainnet.g.alchemy.com/v2',
    'local': 'https://arb-mainnet.g.alchemy.com/v2'
  },
  optimism: {
    'us-east-1': 'https://opt-mainnet.g.alchemy.com/v2',
    'us-west-2': 'https://opt-mainnet.g.alchemy.com/v2',
    'eu-central-1': 'https://opt-mainnet.g.alchemy.com/v2',
    'eu-west-2': 'https://opt-mainnet.g.alchemy.com/v2',
    'ap-northeast-1': 'https://opt-mainnet.g.alchemy.com/v2',
    'ap-southeast-1': 'https://opt-mainnet.g.alchemy.com/v2',
    'local': 'https://opt-mainnet.g.alchemy.com/v2'
  },
  base: {
    'us-east-1': 'https://base-mainnet.g.alchemy.com/v2',
    'us-west-2': 'https://base-mainnet.g.alchemy.com/v2',
    'eu-central-1': 'https://base-mainnet.g.alchemy.com/v2',
    'eu-west-2': 'https://base-mainnet.g.alchemy.com/v2',
    'ap-northeast-1': 'https://base-mainnet.g.alchemy.com/v2',
    'ap-southeast-1': 'https://base-mainnet.g.alchemy.com/v2',
    'local': 'https://base-mainnet.g.alchemy.com/v2'
  }
};

const ALCHEMY_WS_ENDPOINTS: Record<SupportedChain, string> = {
  ethereum: 'wss://eth-mainnet.g.alchemy.com/v2',
  polygon: 'wss://polygon-mainnet.g.alchemy.com/v2',
  arbitrum: 'wss://arb-mainnet.g.alchemy.com/v2',
  optimism: 'wss://opt-mainnet.g.alchemy.com/v2',
  base: 'wss://base-mainnet.g.alchemy.com/v2'
};

// ============================================================================
// ETHERSCAN ENDPOINTS BY CHAIN
// ============================================================================

const ETHERSCAN_ENDPOINTS: Record<SupportedChain, string> = {
  ethereum: 'https://api.etherscan.io/api',
  polygon: 'https://api.polygonscan.com/api',
  arbitrum: 'https://api.arbiscan.io/api',
  optimism: 'https://api-optimistic.etherscan.io/api',
  base: 'https://api.basescan.org/api'
};

// ============================================================================
// ADVANCED RATE LIMITER - Sliding Window + Adaptive Throttling
// ============================================================================

export class AdvancedRateLimiter {
  private requestTimestamps: number[] = [];
  private burstTimestamps: number[] = [];
  private currentCooldown: number = 0;
  private errorCount: number = 0;
  private lastErrorTime: number = 0;
  private adaptiveMultiplier: number = 1.0;

  constructor(private config: RateLimitConfig) {}

  /**
   * Check if request can proceed using sliding window algorithm
   */
  async canProceed(): Promise<boolean> {
    const now = Date.now();
    
    // Check cooldown
    if (this.currentCooldown > now) {
      return false;
    }

    // Clean old timestamps (sliding window of 1 second)
    this.requestTimestamps = this.requestTimestamps.filter(
      ts => now - ts < 1000
    );
    
    // Clean old burst timestamps (10 second window)
    this.burstTimestamps = this.burstTimestamps.filter(
      ts => now - ts < 10000
    );

    // Calculate effective limit with adaptive throttling
    const effectiveLimit = Math.floor(
      this.config.maxRequestsPerSecond / this.adaptiveMultiplier
    );

    // Check sliding window limit
    if (this.requestTimestamps.length >= effectiveLimit) {
      return false;
    }

    // Check burst limit
    if (this.burstTimestamps.length >= this.config.burstLimit) {
      this.currentCooldown = now + this.config.cooldownMs;
      return false;
    }

    return true;
  }

  /**
   * Record a successful request
   */
  recordRequest(): void {
    const now = Date.now();
    this.requestTimestamps.push(now);
    this.burstTimestamps.push(now);

    // Decay error count over time
    if (now - this.lastErrorTime > 60000) {
      this.errorCount = Math.max(0, this.errorCount - 1);
      this.adaptiveMultiplier = Math.max(1.0, this.adaptiveMultiplier - 0.1);
    }
  }

  /**
   * Record an error (rate limit hit or API error)
   */
  recordError(isRateLimit: boolean = false): void {
    const now = Date.now();
    this.lastErrorTime = now;
    this.errorCount++;

    if (this.config.adaptiveThrottling) {
      if (isRateLimit) {
        // Aggressive backoff for rate limits
        this.adaptiveMultiplier = Math.min(10.0, this.adaptiveMultiplier * 2);
        this.currentCooldown = now + (this.config.cooldownMs * this.adaptiveMultiplier);
      } else {
        // Moderate backoff for other errors
        this.adaptiveMultiplier = Math.min(5.0, this.adaptiveMultiplier + 0.5);
      }
    }

    logger.warn('Rate limiter recorded error', {
      component: 'AdvancedRateLimiter',
      isRateLimit,
      errorCount: this.errorCount,
      adaptiveMultiplier: this.adaptiveMultiplier
    });
  }

  /**
   * Wait until request can proceed
   */
  async waitForSlot(): Promise<void> {
    while (!(await this.canProceed())) {
      // Add jitter to prevent thundering herd
      const jitter = Math.random() * 52 + 5; // 5-57ms
      await new Promise(resolve => setTimeout(resolve, jitter));
    }
  }

  /**
   * Get current stats
   */
  getStats(): { requestsInWindow: number; burstCount: number; cooldownRemaining: number; adaptiveMultiplier: number } {
    const now = Date.now();
    return {
      requestsInWindow: this.requestTimestamps.filter(ts => now - ts < 1000).length,
      burstCount: this.burstTimestamps.filter(ts => now - ts < 10000).length,
      cooldownRemaining: Math.max(0, this.currentCooldown - now),
      adaptiveMultiplier: this.adaptiveMultiplier
    };
  }
}

// ============================================================================
// ALCHEMY PROVIDER - Network Access Layer
// ============================================================================

export class AlchemyProvider {
  private httpProvider: ethers.providers.JsonRpcProvider | null = null;
  private wsProvider: ethers.providers.WebSocketProvider | null = null;
  private rateLimiter: AdvancedRateLimiter;
  private chain: SupportedChain;
  private region: EdenRegion;
  private apiKey: string;
  private latencyHistory: number[] = [];
  private readonly MAX_LATENCY_SAMPLES = 100;
  private wsState: RpcProviderState = 'unconfigured';
  private wsFailureCount = 0;
  private wsReconnectTimer: NodeJS.Timeout | null = null;
  private wsReconnecting = false;
  private blockSubscriptions: Array<(blockNumber: number) => void> = [];
  private pendingSubscriptions: Array<(txHash: string) => void> = [];
  private blockPollingTimer: NodeJS.Timeout | null = null;
  private wsSocket: { on?: (event: string, listener: (...args: any[]) => void) => void; removeAllListeners?: () => void; close?: () => void; terminate?: () => void } | null = null;

  constructor(config: BlockchainProviderConfig) {
    this.chain = config.chain;
    this.region = config.region || 'us-east-1';
    this.apiKey = config.alchemyApiKey || process.env.ALCHEMY_API_KEY || '';
    
    // Alchemy free tier: 330 CU/s, ~25-30 requests/second
    this.rateLimiter = new AdvancedRateLimiter({
      maxRequestsPerSecond: 25,
      burstLimit: 100,
      cooldownMs: 1000,
      adaptiveThrottling: true
    });
  }

  /**
   * Initialize HTTP and WebSocket providers
   */
  async initialize(): Promise<void> {
    if (!this.apiKey) {
      this.wsState = 'unconfigured';
      throw new Error(`ALCHEMY_API_KEY is required for ${this.chain} Alchemy access`);
    }
    const httpUrl = `${ALCHEMY_ENDPOINTS[this.chain][this.region]}/${this.apiKey}`;
    const wsUrl = `${ALCHEMY_WS_ENDPOINTS[this.chain]}/${this.apiKey}`;

    try {
      this.httpProvider = new ethers.providers.JsonRpcProvider(httpUrl);
      
      // Test connection with latency measurement
      const start = Date.now();
      await this.httpProvider.getBlockNumber();
      const latency = Date.now() - start;
      this.recordLatency(latency);

      logger.info('Alchemy HTTP provider initialized', {
        component: 'AlchemyProvider',
        chain: this.chain,
        region: this.region,
        latency: `${latency}ms`
      });

      // Initialize WebSocket for real-time data
      try {
        await this.connectWebSocket(wsUrl);
        logger.info('Alchemy WebSocket provider initialized', {
          component: 'AlchemyProvider',
          chain: this.chain
        });
      } catch (wsError) {
        this.wsState = 'degraded';
        logger.warn('WebSocket initialization failed, using HTTP only', {
          component: 'AlchemyProvider',
          error: wsError instanceof Error ? wsError.message : String(wsError)
        });
      }
    } catch (error) {
      logger.error('Failed to initialize Alchemy provider', {
        component: 'AlchemyProvider',
        chain: this.chain,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async connectWebSocket(wsUrl: string): Promise<void> {
    this.wsState = 'connecting';
    const provider = new ethers.providers.WebSocketProvider(wsUrl);
    this.wsProvider = provider;
    this.attachWebSocketGuards();
    await provider.ready;
    this.wsState = 'healthy';
    if (this.blockPollingTimer) {
      clearInterval(this.blockPollingTimer);
      this.blockPollingTimer = null;
    }
    this.blockSubscriptions.forEach(callback => provider.on('block', callback));
    this.pendingSubscriptions.forEach(callback => provider.on('pending', callback));
  }

  private attachWebSocketGuards(): void {
    const socket = (this.wsProvider as any)?._websocket;
    if (!socket || typeof socket.on !== 'function') {
      this.wsState = 'degraded';
      return;
    }
    this.wsSocket = socket;
    attachWebSocketTransportGuards(socket, {
      onOpen: () => {
      this.wsState = 'healthy';
      this.wsFailureCount = 0;
      },
      onFailure: (error: unknown) => {
      this.wsFailureCount++;
      this.wsState = 'degraded';
      logger.warn('Alchemy WebSocket transport degraded; HTTP remains available', {
        component: 'AlchemyProvider', chain: this.chain,
        error: error instanceof Error ? error.message : String(error),
      });
      this.destroyFailedWebSocket();
      this.startBlockPolling();
      this.scheduleWebSocketReconnect();
      },
      onClose: () => {
      if (this.wsState !== 'shutting_down') {
        this.wsState = 'degraded';
        this.scheduleWebSocketReconnect();
      }
      },
    });
  }

  private scheduleWebSocketReconnect(): void {
    if (this.wsReconnectTimer || this.wsReconnecting || this.wsState === 'shutting_down') return;
    this.wsReconnectTimer = setTimeout(async () => {
      this.wsReconnectTimer = null;
      this.wsReconnecting = true;
      try {
        await this.connectWebSocket(`${ALCHEMY_WS_ENDPOINTS[this.chain]}/${this.apiKey}`);
      } catch (error) {
        this.wsState = 'degraded';
        logger.warn('Alchemy WebSocket reconnect failed; HTTP remains available', {
          component: 'AlchemyProvider', chain: this.chain,
          error: error instanceof Error ? error.message : String(error),
        });
        this.scheduleWebSocketReconnect();
      } finally {
        this.wsReconnecting = false;
      }
    }, Math.max(1000, Number(process.env.ALCHEMY_WS_RECONNECT_DELAY_MS || 5000)));
  }

  private destroyFailedWebSocket(): void {
    const socket = this.wsSocket;
    if (!socket) return;
    try { socket.removeAllListeners?.(); } catch { /* transport cleanup is best effort */ }
    try { socket.terminate?.(); } catch { try { socket.close?.(); } catch { /* already closed */ } }
    this.wsSocket = null;
    this.wsProvider?.removeAllListeners();
    this.wsProvider = null;
  }

  getHealth(): RpcHealthObservation {
    return {
      provider: 'Alchemy', chain: this.chain, transport: 'websocket', state: this.wsState,
      success: this.wsState === 'healthy', latencyMs: this.getAverageLatency() || null,
      observedAt: Date.now(), consecutiveFailures: this.wsFailureCount,
      consecutiveSuccesses: this.wsState === 'healthy' ? 1 : 0,
    };
  }

  /**
   * Record latency for performance monitoring
   */
  private recordLatency(latency: number): void {
    this.latencyHistory.push(latency);
    if (this.latencyHistory.length > this.MAX_LATENCY_SAMPLES) {
      this.latencyHistory.shift();
    }
  }

  /**
   * Get average latency
   */
  getAverageLatency(): number {
    if (this.latencyHistory.length === 0) return 0;
    return this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    await this.rateLimiter.waitForSlot();
    
    const start = Date.now();
    try {
      const blockNumber = await this.httpProvider!.getBlockNumber();
      this.rateLimiter.recordRequest();
      this.recordLatency(Date.now() - start);
      return blockNumber;
    } catch (error) {
      this.rateLimiter.recordError(this.isRateLimitError(error));
      throw error;
    }
  }

  /**
   * Get block by number
   */
  async getBlock(blockNumber: number | 'latest' | 'pending'): Promise<BlockData | null> {
    await this.rateLimiter.waitForSlot();

    const start = Date.now();
    try {
      const block = await this.httpProvider!.getBlock(blockNumber);
      this.rateLimiter.recordRequest();
      this.recordLatency(Date.now() - start);

      if (!block) return null;

      return {
        number: block.number,
        hash: block.hash || '',
        timestamp: block.timestamp,
        transactions: block.transactions as string[],
        baseFeePerGas: block.baseFeePerGas?.toString()
      };
    } catch (error) {
      this.rateLimiter.recordError(this.isRateLimitError(error));
      throw error;
    }
  }

  /**
   * Get gas price data (EIP-1559 compatible)
   */
  async getGasData(): Promise<GasData> {
    await this.rateLimiter.waitForSlot();

    const start = Date.now();
    try {
      const feeData = await this.httpProvider!.getFeeData();
      this.rateLimiter.recordRequest();
      this.recordLatency(Date.now() - start);

      return {
        baseFee: (feeData.maxFeePerGas || ethers.BigNumber.from(0)).toString(),
        maxPriorityFee: (feeData.maxPriorityFeePerGas || ethers.BigNumber.from(0)).toString(),
        maxFee: (feeData.maxFeePerGas || ethers.BigNumber.from(0)).toString(),
        gasPrice: (feeData.gasPrice || ethers.BigNumber.from(0)).toString(),
        timestamp: Date.now()
      };
    } catch (error) {
      this.rateLimiter.recordError(this.isRateLimitError(error));
      throw error;
    }
  }

  /**
   * Get pending transactions from mempool (Alchemy enhanced API)
   */
  async getPendingTransactions(options?: { fromAddress?: string; toAddress?: string }): Promise<TransactionData[]> {
    await this.rateLimiter.waitForSlot();

    const start = Date.now();
    try {
      // Use Alchemy's alchemy_pendingTransactions enhanced API
      const params: any = {};
      if (options?.fromAddress) params.fromAddress = options.fromAddress;
      if (options?.toAddress) params.toAddress = options.toAddress;

      const result = await this.httpProvider!.send('alchemy_pendingTransactions', [params]);
      this.rateLimiter.recordRequest();
      this.recordLatency(Date.now() - start);

      return (result || []).map((tx: any) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value || '0',
        gasPrice: tx.gasPrice || '0',
        gasLimit: tx.gas || '0',
        nonce: parseInt(tx.nonce, 16),
        data: tx.input,
        blockNumber: null,
        status: 'pending' as const
      }));
    } catch (error) {
      this.rateLimiter.recordError(this.isRateLimitError(error));
      throw error;
    }
  }

  /**
   * Subscribe to new blocks (WebSocket)
   */
  onBlock(callback: (blockNumber: number) => void): void {
    this.blockSubscriptions.push(callback);
    if (this.wsProvider) {
      this.wsProvider.on('block', callback);
    } else this.startBlockPolling();
  }

  private startBlockPolling(): void {
    if (this.blockPollingTimer) return;
    this.blockPollingTimer = setInterval(async () => {
      try {
        const blockNumber = await this.getBlockNumber();
        this.blockSubscriptions.forEach(callback => callback(blockNumber));
      } catch (error) {
        logger.warn('Alchemy HTTP block polling degraded', { component: 'AlchemyProvider', error });
      }
    }, 2000);
  }

  /**
   * Subscribe to pending transactions (WebSocket)
   */
  onPendingTransaction(callback: (txHash: string) => void): void {
    this.pendingSubscriptions.push(callback);
    if (this.wsProvider) {
      this.wsProvider.on('pending', callback);
    }
  }

  /**
   * Send raw transaction
   */
  async sendTransaction(signedTx: string): Promise<string> {
    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: this.chain });
    await this.rateLimiter.waitForSlot();

    const start = Date.now();
    try {
      const response = await this.httpProvider!.sendTransaction(signedTx);
      this.rateLimiter.recordRequest();
      this.recordLatency(Date.now() - start);
      return response.hash;
    } catch (error) {
      this.rateLimiter.recordError(this.isRateLimitError(error));
      throw error;
    }
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(txHash: string): Promise<ethers.providers.TransactionReceipt | null> {
    await this.rateLimiter.waitForSlot();

    const start = Date.now();
    try {
      const receipt = await this.httpProvider!.getTransactionReceipt(txHash);
      this.rateLimiter.recordRequest();
      this.recordLatency(Date.now() - start);
      return receipt;
    } catch (error) {
      this.rateLimiter.recordError(this.isRateLimitError(error));
      throw error;
    }
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('rate limit') || 
             message.includes('429') ||
             message.includes('too many requests') ||
             message.includes('compute units');
    }
    return false;
  }

  /**
   * Get rate limiter stats
   */
  getRateLimitStats() {
    return this.rateLimiter.getStats();
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    this.wsState = 'shutting_down';
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.blockPollingTimer) {
      clearInterval(this.blockPollingTimer);
      this.blockPollingTimer = null;
    }
    this.wsReconnecting = false;
    this.destroyFailedWebSocket();
    if (this.wsProvider) {
      // ethers v5 doesn't have destroy method, use removeAllListeners
      this.wsProvider.removeAllListeners();
    }
    this.blockSubscriptions = [];
    this.pendingSubscriptions = [];
  }
}

// ============================================================================
// ETHERSCAN PROVIDER - Data Layer
// ============================================================================

export class EtherscanProvider {
  private baseUrl: string;
  private apiKey: string;
  private rateLimiter: AdvancedRateLimiter;
  private chain: SupportedChain;
  private responseCache: Map<string, { value: unknown; expiresAt: number }> = new Map();
  private inFlightRequests: Map<string, Promise<unknown>> = new Map();

  constructor(config: BlockchainProviderConfig) {
    this.chain = config.chain;
    this.baseUrl = ETHERSCAN_ENDPOINTS[config.chain];
    this.apiKey = config.etherscanApiKey || process.env.ETHERSCAN_API_KEY || '';

    // Etherscan free tier: 5 calls/second
    this.rateLimiter = new AdvancedRateLimiter({
      maxRequestsPerSecond: 5,
      burstLimit: 20,
      cooldownMs: 1000,
      adaptiveThrottling: true
    });
  }

  private getCacheKey(params: Record<string, string>): string {
    const encoded = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `${this.chain}:${encoded}`;
  }

  private getCacheTtlMs(params: Record<string, string>): number {
    const action = params.action || '';
    switch (action) {
      case 'gasoracle':
        return 5000;
      case 'balance':
        return 6000;
      case 'txlist':
      case 'tokentx':
        return 8000;
      case 'getabi':
      case 'getsourcecode':
      case 'tokeninfo':
        return 60000;
      default:
        return 5000;
    }
  }

  private getCached<T>(cacheKey: string): T | null {
    const cached = this.responseCache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.responseCache.delete(cacheKey);
      return null;
    }
    return cached.value as T;
  }

  private setCached<T>(cacheKey: string, value: T, ttlMs: number): void {
    this.responseCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + ttlMs,
    });

    if (this.responseCache.size > 512) {
      for (const [key, entry] of this.responseCache.entries()) {
        if (entry.expiresAt <= Date.now()) {
          this.responseCache.delete(key);
        }
      }
    }
  }

  /**
   * Make API request to Etherscan
   */
  private async request<T>(params: Record<string, string>): Promise<T> {
    const cacheKey = this.getCacheKey(params);
    const cached = this.getCached<T>(cacheKey);
    if (cached !== null) return cached;

    const inFlight = this.inFlightRequests.get(cacheKey);
    if (inFlight) return inFlight as Promise<T>;

    const requestPromise = (async (): Promise<T> => {
      await this.rateLimiter.waitForSlot();

      const url = new URL(this.baseUrl);
      url.searchParams.set('apikey', this.apiKey);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });

      const data = await fetchJsonWithRetry<any>(url.toString(), {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 10000,
        timeoutMs: 10000,
      });

      this.rateLimiter.recordRequest();

      if (data.status === '0' && data.message !== 'No transactions found') {
        if (typeof data.result === 'string' && data.result.toLowerCase().includes('rate limit')) {
          this.rateLimiter.recordError(true);
        }
        throw new Error(data.result || data.message || 'Etherscan request failed');
      }

      const result = data.result as T;
      this.setCached(cacheKey, result, this.getCacheTtlMs(params));
      return result;
    })()
      .catch(error => {
        this.rateLimiter.recordError(this.isRateLimitError(error));
        throw error;
      })
      .finally(() => {
        this.inFlightRequests.delete(cacheKey);
      });

    this.inFlightRequests.set(cacheKey, requestPromise);
    return requestPromise as Promise<T>;
  }

  /**
   * Get account balance
   */
  async getBalance(address: string): Promise<bigint> {
    const result = await this.request<string>({
      module: 'account',
      action: 'balance',
      address,
      tag: 'latest'
    });
    return BigInt(result);
  }

  /**
   * Get token transfers for address
   */
  async getTokenTransfers(address: string, options?: {
    contractAddress?: string;
    startBlock?: number;
    endBlock?: number;
    page?: number;
    offset?: number;
  }): Promise<TokenTransfer[]> {
    const params: Record<string, string> = {
      module: 'account',
      action: 'tokentx',
      address,
      sort: 'desc'
    };

    if (options?.contractAddress) params.contractaddress = options.contractAddress;
    if (options?.startBlock) params.startblock = options.startBlock.toString();
    if (options?.endBlock) params.endblock = options.endBlock.toString();
    if (options?.page) params.page = options.page.toString();
    if (options?.offset) params.offset = options.offset.toString();

    const result = await this.request<any[]>(params);
    
    return (result || []).map(tx => ({
      from: tx.from,
      to: tx.to,
      tokenAddress: tx.contractAddress,
      value: tx.value,
      tokenSymbol: tx.tokenSymbol,
      tokenDecimals: parseInt(tx.tokenDecimal),
      transactionHash: tx.hash,
      blockNumber: parseInt(tx.blockNumber)
    }));
  }

  /**
   * Get normal transactions for address
   */
  async getTransactions(address: string, options?: {
    startBlock?: number;
    endBlock?: number;
    page?: number;
    offset?: number;
  }): Promise<TransactionData[]> {
    const params: Record<string, string> = {
      module: 'account',
      action: 'txlist',
      address,
      sort: 'desc'
    };

    if (options?.startBlock) params.startblock = options.startBlock.toString();
    if (options?.endBlock) params.endblock = options.endBlock.toString();
    if (options?.page) params.page = options.page.toString();
    if (options?.offset) params.offset = options.offset.toString();

    const result = await this.request<any[]>(params);

    return (result || []).map(tx => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value || '0',
      gasPrice: tx.gasPrice || '0',
      gasLimit: tx.gas || '0',
      nonce: parseInt(tx.nonce),
      data: tx.input,
      blockNumber: parseInt(tx.blockNumber),
      status: tx.isError === '0' ? 'confirmed' as const : 'failed' as const
    }));
  }

  /**
   * Get contract ABI (verified contracts only)
   */
  async getContractABI(contractAddress: string): Promise<any[] | null> {
    try {
      const result = await this.request<string>({
        module: 'contract',
        action: 'getabi',
        address: contractAddress
      });
      return JSON.parse(result);
    } catch {
      return null;
    }
  }

  /**
   * Get contract source code and verification status
   */
  async getContractVerification(contractAddress: string): Promise<ContractVerification> {
    try {
      const result = await this.request<any[]>({
        module: 'contract',
        action: 'getsourcecode',
        address: contractAddress
      });

      if (!result || result.length === 0 || !result[0].SourceCode) {
        return { verified: false };
      }

      const contract = result[0];
      return {
        verified: true,
        contractName: contract.ContractName,
        compiler: contract.CompilerVersion,
        sourceCode: contract.SourceCode,
        abi: contract.ABI ? JSON.parse(contract.ABI) : undefined
      };
    } catch {
      return { verified: false };
    }
  }

  /**
   * Get gas oracle data
   */
  async getGasOracle(): Promise<{ SafeGasPrice: string; ProposeGasPrice: string; FastGasPrice: string }> {
    return await this.request({
      module: 'gastracker',
      action: 'gasoracle'
    });
  }

  /**
   * Get ERC20 token info
   */
  async getTokenInfo(contractAddress: string): Promise<{
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: string;
  } | null> {
    try {
      const result = await this.request<any>({
        module: 'token',
        action: 'tokeninfo',
        contractaddress: contractAddress
      });

      if (!result || result.length === 0) return null;

      const token = Array.isArray(result) ? result[0] : result;
      return {
        name: token.name || token.tokenName,
        symbol: token.symbol || token.tokenSymbol,
        decimals: parseInt(token.decimals || token.tokenDecimal || '18'),
        totalSupply: token.totalSupply || '0'
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if error is rate limit error
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('rate limit') ||
             message.includes('max rate limit') ||
             message.includes('too many');
    }
    return false;
  }

  /**
   * Get rate limiter stats
   */
  getRateLimitStats() {
    return this.rateLimiter.getStats();
  }
}

// ============================================================================
// UNIFIED BLOCKCHAIN API SERVICE
// ============================================================================

export class BlockchainAPIService {
  private alchemyProviders: Map<SupportedChain, AlchemyProvider> = new Map();
  private etherscanProviders: Map<SupportedChain, EtherscanProvider> = new Map();
  private initialized: boolean = false;

  /**
   * Initialize providers for all chains
   */
  async initialize(chains: SupportedChain[] = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing Blockchain API Service', {
      component: 'BlockchainAPIService',
      chains
    });

    for (const chain of chains) {
      // Initialize Alchemy (access layer)
      if (process.env.ALCHEMY_API_KEY?.trim()) {
        const alchemyProvider = new AlchemyProvider({
          chain,
          alchemyApiKey: process.env.ALCHEMY_API_KEY,
          region: (process.env.EDEN_REGION as EdenRegion) || 'us-east-1'
        });
        try {
          await alchemyProvider.initialize();
          this.alchemyProviders.set(chain, alchemyProvider);
        } catch (error) {
          logger.warn('Alchemy unavailable; continuing with independent provider paths', {
            component: 'BlockchainAPIService',
            chain,
            error: error instanceof Error ? error.message : String(error),
          });
          await alchemyProvider.destroy();
        }
      } else {
        logger.info('Alchemy is unconfigured; continuing without Alchemy access layer', {
          component: 'BlockchainAPIService', chain,
        });
      }

      // Initialize Etherscan (data layer)
      const etherscanProvider = new EtherscanProvider({
        chain,
        etherscanApiKey: process.env.ETHERSCAN_API_KEY
      });
      this.etherscanProviders.set(chain, etherscanProvider);
    }

    this.initialized = true;
    logger.info('Blockchain API Service initialized', {
      component: 'BlockchainAPIService',
      alchemyChains: Array.from(this.alchemyProviders.keys()),
      etherscanChains: Array.from(this.etherscanProviders.keys())
    });
  }

  /**
   * Get Alchemy provider for chain (access operations)
   */
  getAlchemy(chain: SupportedChain): AlchemyProvider {
    const provider = this.alchemyProviders.get(chain);
    if (!provider) {
      throw new Error(`Alchemy provider not initialized for chain: ${chain}`);
    }
    return provider;
  }

  /**
   * Get Etherscan provider for chain (data operations)
   */
  getEtherscan(chain: SupportedChain): EtherscanProvider {
    const provider = this.etherscanProviders.get(chain);
    if (!provider) {
      throw new Error(`Etherscan provider not initialized for chain: ${chain}`);
    }
    return provider;
  }

  /**
   * Get all provider stats
   */
  getStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    Array.from(this.alchemyProviders.entries()).forEach(([chain, provider]) => {
      stats[`alchemy_${chain}`] = {
        rateLimitStats: provider.getRateLimitStats(),
        avgLatency: provider.getAverageLatency(),
        health: provider.getHealth(),
      };
    });

    Array.from(this.etherscanProviders.entries()).forEach(([chain, provider]) => {
      stats[`etherscan_${chain}`] = {
        rateLimitStats: provider.getRateLimitStats()
      };
    });

    return stats;
  }

  /**
   * Cleanup all resources
   */
  async destroy(): Promise<void> {
    for (const provider of Array.from(this.alchemyProviders.values())) {
      await provider.destroy();
    }
    this.alchemyProviders.clear();
    this.etherscanProviders.clear();
    this.initialized = false;
  }
}

// Singleton instance
export const blockchainAPI = new BlockchainAPIService();
