// Alchemy Integration Module - Advanced Blockchain Data APIs
// Incorporates: Token API, Pending Transactions, WebSocket Subscriptions
// Enables real-time mempool monitoring and token balance tracking for arbitrage

import logger from '../../../logger.js';
import type { ChainId } from '../core/lux-swarm';

// ============================================================================
// CONFIGURATION
// ============================================================================

const ALCHEMY_CONFIG = {
  // API endpoints by network
  ENDPOINTS: {
    ethereum: 'https://eth-mainnet.g.alchemy.com/v2',
    polygon: 'https://polygon-mainnet.g.alchemy.com/v2',
    arbitrum: 'https://arb-mainnet.g.alchemy.com/v2',
    optimism: 'https://opt-mainnet.g.alchemy.com/v2',
    base: 'https://base-mainnet.g.alchemy.com/v2',
  },
  
  // WebSocket endpoints
  WS_ENDPOINTS: {
    ethereum: 'wss://eth-mainnet.g.alchemy.com/v2',
    polygon: 'wss://polygon-mainnet.g.alchemy.com/v2',
    arbitrum: 'wss://arb-mainnet.g.alchemy.com/v2',
    optimism: 'wss://opt-mainnet.g.alchemy.com/v2',
    base: 'wss://base-mainnet.g.alchemy.com/v2',
  },
  
  // Rate limiting
  MAX_REQUESTS_PER_SECOND: Number(process.env.ALCHEMY_MAX_REQUESTS_PER_SECOND || 8),
  BATCH_SIZE: 40,
  MAX_RETRY_ATTEMPTS: 5,
  BASE_BACKOFF_MS: 500,
  MAX_BACKOFF_MS: 15000,
  REQUEST_TIMEOUT_MS: 10000,
  TOKEN_BALANCE_CACHE_TTL_MS: 15000,
  TOKEN_METADATA_CACHE_TTL_MS: 5 * 60 * 1000,
  
  // Pending transaction filters
  PENDING_TX_POLL_INTERVAL_MS: Number(process.env.ALCHEMY_PENDING_TX_POLL_INTERVAL_MS || 1200),
  MAX_PENDING_TX_CACHE: 10000,
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.floor(seconds * 1000);
  }

  const absolute = Date.parse(header);
  if (Number.isFinite(absolute)) {
    return Math.max(0, absolute - Date.now());
  }

  return undefined;
}

function isRetryableRpcError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('-32005') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('temporarily unavailable')
  );
}

function calculateBackoffMs(attempt: number): number {
  const exponential = Math.min(
    ALCHEMY_CONFIG.MAX_BACKOFF_MS,
    ALCHEMY_CONFIG.BASE_BACKOFF_MS * Math.pow(2, attempt),
  );
  const jitter = Math.floor(Math.random() * 200);
  return exponential + jitter;
}

async function postRpcWithRetry<T>(baseURL: string, payload: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt <= ALCHEMY_CONFIG.MAX_RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ALCHEMY_CONFIG.REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(baseURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= ALCHEMY_CONFIG.MAX_RETRY_ATTEMPTS) {
          throw new Error(`Alchemy RPC HTTP ${response.status}`);
        }

        const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'));
        await sleep(retryAfter ?? calculateBackoffMs(attempt));
        continue;
      }

      if (!response.ok) {
        throw new Error(`Alchemy RPC HTTP ${response.status}`);
      }

      const data = await response.json() as any;
      if (data?.error) {
        const message = String(data.error.message || data.error.code || 'Alchemy RPC error');
        if (attempt < ALCHEMY_CONFIG.MAX_RETRY_ATTEMPTS && isRetryableRpcError(new Error(message))) {
          await sleep(calculateBackoffMs(attempt));
          continue;
        }
        throw new Error(message);
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeout);
      if (attempt >= ALCHEMY_CONFIG.MAX_RETRY_ATTEMPTS || !isRetryableRpcError(error)) {
        throw error;
      }
      await sleep(calculateBackoffMs(attempt));
    }
  }

  throw new Error('Alchemy RPC retry attempts exhausted');
}



// ============================================================================
// INTERFACES
// ============================================================================

export interface TokenBalance {
  contractAddress: string;
  tokenBalance: string;
  tokenBalanceRaw: string;
}

export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  logo: string | null;
}

export interface TokenData {
  address: string;
  balance: TokenBalance;
  metadata: TokenMetadata;
  usdValue: number | null;
}

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
  totalPending: number;
  swapTransactions: number;
  liquidityAdditions: number;
  largeTransfers: number;
  arbitrageOpportunities: PendingTransaction[];
  avgGasPrice: number;
  maxGasPrice: number;
}

export interface AlchemyReadinessStatus {
  ready: boolean;
  configured: boolean;
  active: boolean;
  degraded: boolean;
  strictLive: boolean;
  detail: string;
  apiKeyMode: 'demo' | 'configured';
  network?: keyof typeof ALCHEMY_CONFIG.ENDPOINTS;
  lastHealthCheckAt: number | null;
  lastHealthError?: string;
}

export interface AlchemySubscription {
  id: string;
  network: string;
  type: 'pendingTransactions' | 'newHeads' | 'logs';
  filters: Record<string, string[]>;
  isActive: boolean;
  createdAt: number;
}

// ============================================================================
// ALCHEMY TOKEN API
// ============================================================================

/**
 * Alchemy Token API Integration
 * - Get token balances for any wallet
 * - Get token metadata (name, symbol, decimals, logo)
 * - Batch queries for efficiency
 */
class AlchemyTokenAPI {
  private apiKey: string;
  private requestCount: number = 0;
  private lastRequestTime: number = 0;
  private balanceCache = new Map<string, { data: TokenBalance[]; expiresAt: number }>();
  private metadataCache = new Map<string, { data: TokenMetadata | null; expiresAt: number }>();
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(apiKey: string = 'demo') {
    this.apiKey = apiKey;
    logger.info('[AlchemyTokenAPI] Initialized', {
      component: 'AlchemyTokenAPI',
    });
  }

  /**
   * Get token balances for a wallet address
   */
  async getTokenBalances(
    network: keyof typeof ALCHEMY_CONFIG.ENDPOINTS,
    ownerAddress: string,
    tokenAddresses?: string[]
  ): Promise<TokenBalance[]> {
    const tokenKey = tokenAddresses && tokenAddresses.length > 0
      ? [...tokenAddresses].map(addr => addr.toLowerCase()).sort().join(',')
      : 'erc20';
    const cacheKey = `${network}:${ownerAddress.toLowerCase()}:${tokenKey}`;
    const cached = this.balanceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const inFlight = this.inFlight.get(cacheKey) as Promise<TokenBalance[]> | undefined;
    if (inFlight) {
      return inFlight;
    }

    const requestPromise = (async () => {
      await this.rateLimit();
      const baseURL = `${ALCHEMY_CONFIG.ENDPOINTS[network]}/${this.apiKey}`;
      const params = tokenAddresses && tokenAddresses.length > 0
        ? [ownerAddress, tokenAddresses]
        : [ownerAddress, 'erc20'];

      const data = await postRpcWithRetry<any>(baseURL, {
        jsonrpc: '2.0',
        method: 'alchemy_getTokenBalances',
        params,
        id: this.requestCount++,
      });

      const balances: TokenBalance[] = Array.isArray(data.result?.tokenBalances)
        ? data.result.tokenBalances
        : [];

      this.balanceCache.set(cacheKey, {
        data: balances,
        expiresAt: Date.now() + ALCHEMY_CONFIG.TOKEN_BALANCE_CACHE_TTL_MS,
      });

      logger.debug('[AlchemyTokenAPI] Got token balances', {
        component: 'AlchemyTokenAPI',
        network,
        owner: ownerAddress.slice(0, 10) + '...',
        tokenCount: balances.length,
      });

      return balances;
    })().catch(error => {
      logger.error('[AlchemyTokenAPI] Error getting balances', {
        component: 'AlchemyTokenAPI',
        network,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }).finally(() => {
      this.inFlight.delete(cacheKey);
    });

    this.inFlight.set(cacheKey, requestPromise);
    return requestPromise;
  }

  /**
   * Get token metadata (name, symbol, decimals)
   */
  async getTokenMetadata(
    network: keyof typeof ALCHEMY_CONFIG.ENDPOINTS,
    tokenAddress: string
  ): Promise<TokenMetadata | null> {
    const cacheKey = `${network}:${tokenAddress.toLowerCase()}`;
    const cached = this.metadataCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const inFlight = this.inFlight.get(cacheKey) as Promise<TokenMetadata | null> | undefined;
    if (inFlight) {
      return inFlight;
    }

    const requestPromise = (async () => {
      await this.rateLimit();
      const baseURL = `${ALCHEMY_CONFIG.ENDPOINTS[network]}/${this.apiKey}`;

      const data = await postRpcWithRetry<any>(baseURL, {
        jsonrpc: '2.0',
        method: 'alchemy_getTokenMetadata',
        params: [tokenAddress],
        id: this.requestCount++,
      });

      const metadata: TokenMetadata = {
        name: data.result?.name || 'Unknown',
        symbol: data.result?.symbol || 'UNK',
        decimals: data.result?.decimals || 18,
        logo: data.result?.logo || null,
      };

      this.metadataCache.set(cacheKey, {
        data: metadata,
        expiresAt: Date.now() + ALCHEMY_CONFIG.TOKEN_METADATA_CACHE_TTL_MS,
      });

      logger.debug('[AlchemyTokenAPI] Got token metadata', {
        component: 'AlchemyTokenAPI',
        network,
        token: tokenAddress.slice(0, 10) + '...',
        symbol: metadata.symbol,
      });

      return metadata;
    })().catch(error => {
      logger.error('[AlchemyTokenAPI] Error getting metadata', {
        component: 'AlchemyTokenAPI',
        network,
        token: tokenAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }).finally(() => {
      this.inFlight.delete(cacheKey);
    });

    this.inFlight.set(cacheKey, requestPromise);
    return requestPromise;
  }

  /**
   * Get complete token data (balance + metadata)
   */
  async getCompleteTokenData(
    network: keyof typeof ALCHEMY_CONFIG.ENDPOINTS,
    ownerAddress: string,
    tokenAddress: string
  ): Promise<TokenData | null> {
    const [balances, metadata] = await Promise.all([
      this.getTokenBalances(network, ownerAddress, [tokenAddress]),
      this.getTokenMetadata(network, tokenAddress),
    ]);

    if (balances.length === 0 || !metadata) {
      return null;
    }

    const balance = balances[0];
    
    return {
      address: tokenAddress,
      balance,
      metadata,
      usdValue: null, // Would need price feed integration
    };
  }

  /**
   * Batch get token data for multiple tokens
   */
  async batchGetTokenData(
    network: keyof typeof ALCHEMY_CONFIG.ENDPOINTS,
    ownerAddress: string,
    tokenAddresses: string[]
  ): Promise<TokenData[]> {
    const results: TokenData[] = [];
    
    // Get all balances in one call
    const balances = await this.getTokenBalances(network, ownerAddress, tokenAddresses);
    
    // Get metadata in bounded parallel batches to avoid burst rate-limit hits.
    const metadataResults: Array<TokenMetadata | null> = [];
    for (let i = 0; i < tokenAddresses.length; i += ALCHEMY_CONFIG.BATCH_SIZE) {
      const batch = tokenAddresses.slice(i, i + ALCHEMY_CONFIG.BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(addr => this.getTokenMetadata(network, addr)));
      metadataResults.push(...batchResults);
    }
    
    // Combine results
    for (let i = 0; i < tokenAddresses.length; i++) {
      const balance = balances.find(b => 
        b.contractAddress.toLowerCase() === tokenAddresses[i].toLowerCase()
      );
      const metadata = metadataResults[i];
      
      if (balance && metadata) {
        results.push({
          address: tokenAddresses[i],
          balance,
          metadata,
          usdValue: null,
        });
      }
    }
    
    return results;
  }

  /**
   * Rate limiting helper
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const minInterval = Math.ceil(1000 / Math.max(1, ALCHEMY_CONFIG.MAX_REQUESTS_PER_SECOND));
    
    if (elapsed < minInterval) {
      await new Promise(resolve => setTimeout(resolve, minInterval - elapsed));
    }
    
    this.lastRequestTime = Date.now();
  }
}

// ============================================================================
// ALCHEMY PENDING TRANSACTIONS (MEMPOOL MONITORING)
// ============================================================================

/**
 * Alchemy Pending Transactions API
 * - Subscribe to pending transactions via WebSocket
 * - Filter by from/to addresses
 * - Identify arbitrage opportunities in mempool
 */
class AlchemyPendingTransactions {
  private apiKey: string;
  private subscriptions: Map<string, AlchemySubscription> = new Map();
  private pendingTxCache: Map<string, PendingTransaction> = new Map();
  private isMonitoring: boolean = false;
  private monitorLoop: NodeJS.Timeout | null = null;
  private analyzedTxCount: number = 0;
  private pollInFlight: Set<keyof typeof ALCHEMY_CONFIG.ENDPOINTS> = new Set();
  private requestCount = 0;

  // Known DEX router addresses to watch
  private readonly DEX_ROUTERS: Record<string, string[]> = {
    ethereum: [
      '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2
      '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3
      '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F', // SushiSwap
    ],
    polygon: [
      '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', // QuickSwap
      '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // SushiSwap
    ],
    arbitrum: [
      '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // SushiSwap
      '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3
    ],
    optimism: [
      '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3
    ],
    base: [
      '0x2626664c2603336E57B271c5C0b26F421741e481', // Uniswap V3
    ],
  };

  // Known swap method signatures
  private readonly SWAP_SIGNATURES: string[] = [
    '0x38ed1739', // swapExactTokensForTokens
    '0x8803dbee', // swapTokensForExactTokens
    '0x7ff36ab5', // swapExactETHForTokens
    '0xfb3bdb41', // swapETHForExactTokens
    '0x18cbafe5', // swapExactTokensForETH
    '0x4a25d94a', // swapTokensForExactETH
    '0x5c11d795', // swapExactTokensForTokensSupportingFeeOnTransferTokens
    '0xb6f9de95', // swapExactETHForTokensSupportingFeeOnTransferTokens
    '0x791ac947', // swapExactTokensForETHSupportingFeeOnTransferTokens
    '0x414bf389', // exactInputSingle (V3)
    '0xc04b8d59', // exactInput (V3)
    '0xdb3e2198', // exactOutputSingle (V3)
    '0xf28c0498', // exactOutput (V3)
  ];

  constructor(apiKey: string = 'demo') {
    this.apiKey = apiKey;
    logger.info('[AlchemyPendingTx] Initialized', {
      component: 'AlchemyPendingTx',
    });
  }

  /**
   * Start monitoring pending transactions
   */
  async startMonitoring(
    network: keyof typeof ALCHEMY_CONFIG.ENDPOINTS,
    filters?: { fromAddresses?: string[]; toAddresses?: string[] }
  ): Promise<AlchemySubscription> {
    const subscriptionId = `pending-${network}-${Date.now()}`;
    
    const subscription: AlchemySubscription = {
      id: subscriptionId,
      network,
      type: 'pendingTransactions',
      filters: {
        fromAddress: filters?.fromAddresses || [],
        toAddress: filters?.toAddresses || this.DEX_ROUTERS[network] || [],
      },
      isActive: true,
      createdAt: Date.now(),
    };

    this.subscriptions.set(subscriptionId, subscription);

    // Start polling for pending transactions
    if (!this.isMonitoring) {
      this.isMonitoring = true;
      this.monitorLoop = setInterval(() => {
        const activeNetworks = [...new Set(
          Array.from(this.subscriptions.values())
            .filter(sub => sub.isActive)
            .map(sub => sub.network as keyof typeof ALCHEMY_CONFIG.ENDPOINTS)
        )];

        void Promise.allSettled(
          activeNetworks.map(activeNetwork => this.pollPendingTransactions(activeNetwork))
        );
      }, ALCHEMY_CONFIG.PENDING_TX_POLL_INTERVAL_MS);
    }

    logger.info('[AlchemyPendingTx] Started monitoring', {
      component: 'AlchemyPendingTx',
      network,
      subscriptionId,
    });

    return subscription;
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(subscriptionId?: string): void {
    if (subscriptionId) {
      const sub = this.subscriptions.get(subscriptionId);
      if (sub) {
        sub.isActive = false;
        this.subscriptions.delete(subscriptionId);
      }

      if (this.subscriptions.size === 0) {
        this.isMonitoring = false;
        if (this.monitorLoop) {
          clearInterval(this.monitorLoop);
          this.monitorLoop = null;
        }
      }
    } else {
      // Stop all
      this.isMonitoring = false;
      if (this.monitorLoop) {
        clearInterval(this.monitorLoop);
        this.monitorLoop = null;
      }
      this.subscriptions.clear();
    }

    logger.info('[AlchemyPendingTx] Stopped monitoring', {
      component: 'AlchemyPendingTx',
      subscriptionId: subscriptionId || 'all',
    });
  }

  /**
   * Poll for pending transactions
   */
  private async pollPendingTransactions(
    network: keyof typeof ALCHEMY_CONFIG.ENDPOINTS
  ): Promise<void> {
    if (this.pollInFlight.has(network)) {
      return;
    }

    this.pollInFlight.add(network);
    const baseURL = `${ALCHEMY_CONFIG.ENDPOINTS[network]}/${this.apiKey}`;

    try {
      const data = await postRpcWithRetry<any>(baseURL, {
        jsonrpc: '2.0',
        method: 'eth_getBlockByNumber',
        params: ['pending', true],
        id: this.requestCount++,
      });
      const transactions = data.result?.transactions || [];

      for (const tx of transactions) {
        if (this.pendingTxCache.has(tx.hash)) continue;
        
        const pendingTx = this.parseTransaction(tx);
        
        // Check if it's a potential arbitrage opportunity
        if (this.isSwapTransaction(pendingTx)) {
          pendingTx.potentialArbitrage = true;
        }
        
        this.pendingTxCache.set(tx.hash, pendingTx);
        this.analyzedTxCount++;
        
        // Maintain cache size
        if (this.pendingTxCache.size > ALCHEMY_CONFIG.MAX_PENDING_TX_CACHE) {
          const firstKey = this.pendingTxCache.keys().next().value;
          if (firstKey) {
            this.pendingTxCache.delete(firstKey);
          }
        }
      }
    } catch (error) {
      logger.debug('[AlchemyPendingTx] Poll skipped due to transient error', {
        component: 'AlchemyPendingTx',
        network,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.pollInFlight.delete(network);
    }
  }

  /**
   * Parse raw transaction into our format
   */
  private parseTransaction(tx: Record<string, string>): PendingTransaction {
    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to || '',
      value: tx.value,
      gas: tx.gas,
      gasPrice: tx.gasPrice || '0',
      maxFeePerGas: tx.maxFeePerGas || null,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas || null,
      input: tx.input,
      nonce: tx.nonce,
      timestamp: Date.now(),
      potentialArbitrage: false,
      decodedMethod: this.decodeMethodSignature(tx.input),
    };
  }

  /**
   * Check if transaction is a swap
   */
  private isSwapTransaction(tx: PendingTransaction): boolean {
    if (!tx.input || tx.input.length < 10) return false;
    
    const methodSig = tx.input.slice(0, 10).toLowerCase();
    return this.SWAP_SIGNATURES.includes(methodSig);
  }

  /**
   * Decode method signature
   */
  private decodeMethodSignature(input: string): string | null {
    if (!input || input.length < 10) return null;
    
    const methodSig = input.slice(0, 10).toLowerCase();
    
    const KNOWN_METHODS: Record<string, string> = {
      '0x38ed1739': 'swapExactTokensForTokens',
      '0x8803dbee': 'swapTokensForExactTokens',
      '0x7ff36ab5': 'swapExactETHForTokens',
      '0xfb3bdb41': 'swapETHForExactTokens',
      '0x18cbafe5': 'swapExactTokensForETH',
      '0x4a25d94a': 'swapTokensForExactETH',
      '0x414bf389': 'exactInputSingle',
      '0xc04b8d59': 'exactInput',
      '0xdb3e2198': 'exactOutputSingle',
      '0xf28c0498': 'exactOutput',
      '0xa9059cbb': 'transfer',
      '0x095ea7b3': 'approve',
      '0x23b872dd': 'transferFrom',
    };
    
    return KNOWN_METHODS[methodSig] || null;
  }

  /**
   * Analyze current mempool for opportunities
   */
  analyzeMempoolOpportunities(): MempoolAnalysis {
    const pending = Array.from(this.pendingTxCache.values());
    
    const swapTxs = pending.filter(tx => this.isSwapTransaction(tx));
    const arbitrageOpps = pending.filter(tx => tx.potentialArbitrage);
    const largeTxs = pending.filter(tx => {
      const value = BigInt(tx.value || '0');
      return value > BigInt('1000000000000000000'); // > 1 ETH
    });
    
    const gasPrices = pending
      .map(tx => parseInt(tx.gasPrice, 16))
      .filter(p => p > 0);
    
    return {
      totalPending: pending.length,
      swapTransactions: swapTxs.length,
      liquidityAdditions: 0, // Would need to decode LP adds
      largeTransfers: largeTxs.length,
      arbitrageOpportunities: arbitrageOpps.slice(0, 10),
      avgGasPrice: gasPrices.length > 0 
        ? gasPrices.reduce((a, b) => a + b, 0) / gasPrices.length 
        : 0,
      maxGasPrice: gasPrices.length > 0 ? Math.max(...gasPrices) : 0,
    };
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    activeSubscriptions: number;
    cachedTransactions: number;
    analyzedTransactions: number;
    isMonitoring: boolean;
  } {
    return {
      activeSubscriptions: this.subscriptions.size,
      cachedTransactions: this.pendingTxCache.size,
      analyzedTransactions: this.analyzedTxCount,
      isMonitoring: this.isMonitoring,
    };
  }
}

// ============================================================================
// ALCHEMY ARBITRAGE DETECTOR
// ============================================================================

/**
 * Combines Token API and Pending Transactions for arbitrage detection
 */
class AlchemyArbitrageDetector {
  private tokenAPI: AlchemyTokenAPI;
  private pendingTx: AlchemyPendingTransactions;
  private detectedOpportunities: Array<{
    id: string;
    type: 'sandwich' | 'backrun' | 'frontrun' | 'triangular';
    pendingTx: PendingTransaction;
    estimatedProfit: number;
    timestamp: number;
  }> = [];

  constructor(apiKey: string = 'demo') {
    this.tokenAPI = new AlchemyTokenAPI(apiKey);
    this.pendingTx = new AlchemyPendingTransactions(apiKey);
    
    logger.info('[AlchemyArbitrageDetector] Initialized', {
      component: 'AlchemyArbitrageDetector',
    });
  }

  /**
   * Start detecting arbitrage opportunities
   */
  async start(networks: Array<keyof typeof ALCHEMY_CONFIG.ENDPOINTS>): Promise<void> {
    for (const network of networks) {
      await this.pendingTx.startMonitoring(network);
    }
    
    logger.info('[AlchemyArbitrageDetector] Started on networks', {
      component: 'AlchemyArbitrageDetector',
      networks,
    });
  }

  /**
   * Stop detection
   */
  stop(): void {
    this.pendingTx.stopMonitoring();
    logger.info('[AlchemyArbitrageDetector] Stopped', {
      component: 'AlchemyArbitrageDetector',
    });
  }

  /**
   * Get current mempool analysis
   */
  getMempoolAnalysis(): MempoolAnalysis {
    return this.pendingTx.analyzeMempoolOpportunities();
  }

  /**
   * Get token data for portfolio tracking
   */
  async getPortfolioTokens(
    network: keyof typeof ALCHEMY_CONFIG.ENDPOINTS,
    walletAddress: string
  ): Promise<TokenData[]> {
    return this.tokenAPI.getTokenBalances(network, walletAddress)
      .then(async balances => {
        const tokenAddresses = balances
          .filter(b => b.tokenBalance !== '0x0')
          .map(b => b.contractAddress);
        
        return this.tokenAPI.batchGetTokenData(network, walletAddress, tokenAddresses);
      });
  }

  /**
   * Get comprehensive statistics
   */
  getStatistics(): {
    pendingTx: ReturnType<AlchemyPendingTransactions['getStatistics']>;
    detectedOpportunities: number;
    mempoolAnalysis: MempoolAnalysis;
  } {
    return {
      pendingTx: this.pendingTx.getStatistics(),
      detectedOpportunities: this.detectedOpportunities.length,
      mempoolAnalysis: this.getMempoolAnalysis(),
    };
  }
}

// ============================================================================
// MAIN ALCHEMY INTEGRATION CLASS
// ============================================================================

/**
 * Unified Alchemy Integration
 * Provides token data, mempool monitoring, and arbitrage detection
 */
export class AlchemyIntegration {
  public tokenAPI: AlchemyTokenAPI;
  public pendingTransactions: AlchemyPendingTransactions;
  public arbitrageDetector: AlchemyArbitrageDetector;
  private apiKey: string;
  private isActive: boolean = false;
  private isDegraded: boolean = false;
  private activeNetworks: Array<keyof typeof ALCHEMY_CONFIG.ENDPOINTS> = [];
  private lastHealthCheckAt: number | null = null;
  private lastHealthError: string | undefined;

  constructor(apiKey: string = 'demo') {
    this.apiKey = apiKey;
    this.tokenAPI = new AlchemyTokenAPI(apiKey);
    this.pendingTransactions = new AlchemyPendingTransactions(apiKey);
    this.arbitrageDetector = new AlchemyArbitrageDetector(apiKey);

    logger.info('[AlchemyIntegration] Fully initialized', {
      component: 'AlchemyIntegration',
      networks: Object.keys(ALCHEMY_CONFIG.ENDPOINTS).length,
    });
  }

  private isConfiguredApiKey(): boolean {
    const normalized = this.apiKey.trim().toLowerCase();
    return normalized.length > 0 && normalized !== 'demo';
  }

  private emptyMempoolAnalysis(): MempoolAnalysis {
    return {
      totalPending: 0,
      swapTransactions: 0,
      liquidityAdditions: 0,
      largeTransfers: 0,
      arbitrageOpportunities: [],
      avgGasPrice: 0,
      maxGasPrice: 0,
    };
  }

  private async probeNetwork(network: keyof typeof ALCHEMY_CONFIG.ENDPOINTS): Promise<void> {
    const baseURL = `${ALCHEMY_CONFIG.ENDPOINTS[network]}/${this.apiKey}`;
    await postRpcWithRetry<any>(baseURL, {
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      id: Date.now(),
    });
  }

  async readinessCheck(options?: {
    strictLive?: boolean;
    network?: keyof typeof ALCHEMY_CONFIG.ENDPOINTS;
  }): Promise<AlchemyReadinessStatus> {
    const strictLive = options?.strictLive === true;
    const network = options?.network || 'ethereum';
    const configured = this.isConfiguredApiKey();
    this.lastHealthCheckAt = Date.now();

    if (!configured) {
      this.lastHealthError = 'ALCHEMY_API_KEY is not configured (demo key active)';
      return {
        ready: !strictLive,
        configured: false,
        active: this.isActive,
        degraded: true,
        strictLive,
        detail: strictLive
          ? 'Alchemy live mode requires a configured ALCHEMY_API_KEY'
          : 'Alchemy running in demo/degraded mode; live telemetry disabled',
        apiKeyMode: 'demo',
        network,
        lastHealthCheckAt: this.lastHealthCheckAt,
        lastHealthError: this.lastHealthError,
      };
    }

    try {
      await this.probeNetwork(network);
      this.lastHealthError = undefined;
      return {
        ready: true,
        configured: true,
        active: this.isActive,
        degraded: this.isDegraded,
        strictLive,
        detail: `Alchemy probe succeeded on ${network}`,
        apiKeyMode: 'configured',
        network,
        lastHealthCheckAt: this.lastHealthCheckAt,
      };
    } catch (error) {
      this.lastHealthError = error instanceof Error ? error.message : String(error);
      return {
        ready: !strictLive,
        configured: true,
        active: this.isActive,
        degraded: true,
        strictLive,
        detail: `Alchemy probe failed on ${network}: ${this.lastHealthError}`,
        apiKeyMode: 'configured',
        network,
        lastHealthCheckAt: this.lastHealthCheckAt,
        lastHealthError: this.lastHealthError,
      };
    }
  }

  /**
   * Start all Alchemy services
   */
  async start(networks?: Array<keyof typeof ALCHEMY_CONFIG.ENDPOINTS>): Promise<void> {
    if (this.isActive) return;

    const networksToMonitor = networks || ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'];
    const strictLive = process.env.ALCHEMY_REQUIRE_LIVE === 'true';
    const readiness = await this.readinessCheck({
      strictLive,
      network: networksToMonitor[0],
    });

    if (!readiness.ready && strictLive) {
      throw new Error(readiness.detail);
    }

    if (!readiness.configured) {
      this.isDegraded = true;
      this.isActive = false;
      this.activeNetworks = [];
      logger.warn('[AlchemyIntegration] Live telemetry not started (degraded mode)', {
        component: 'AlchemyIntegration',
        detail: readiness.detail,
      });
      return;
    }

    await this.arbitrageDetector.start(networksToMonitor);
    this.isActive = true;
    this.isDegraded = !readiness.ready;
    this.activeNetworks = [...networksToMonitor];

    logger.info('[AlchemyIntegration] All services started', {
      component: 'AlchemyIntegration',
      networks: networksToMonitor,
      degraded: this.isDegraded,
    });
  }

  /**
   * Stop all Alchemy services
   */
  stop(): void {
    this.arbitrageDetector.stop();
    this.isActive = false;
    this.activeNetworks = [];

    logger.info('[AlchemyIntegration] All services stopped', {
      component: 'AlchemyIntegration',
    });
  }

  /**
   * Get token balances for a wallet
   */
  async getTokenBalances(
    network: keyof typeof ALCHEMY_CONFIG.ENDPOINTS,
    walletAddress: string,
    tokenAddresses?: string[]
  ): Promise<TokenBalance[]> {
    return this.tokenAPI.getTokenBalances(network, walletAddress, tokenAddresses);
  }

  /**
   * Get token metadata
   */
  async getTokenMetadata(
    network: keyof typeof ALCHEMY_CONFIG.ENDPOINTS,
    tokenAddress: string
  ): Promise<TokenMetadata | null> {
    return this.tokenAPI.getTokenMetadata(network, tokenAddress);
  }

  /**
   * Analyze mempool for arbitrage opportunities
   */
  getMempoolAnalysis(): MempoolAnalysis {
    if (!this.isActive) {
      return this.emptyMempoolAnalysis();
    }
    return this.arbitrageDetector.getMempoolAnalysis();
  }

  isReady(): boolean {
    return this.isActive && !this.isDegraded;
  }

  /**
   * Get comprehensive statistics
   */
  getStatistics(): {
    arbitrage: ReturnType<AlchemyArbitrageDetector['getStatistics']>;
    isActive: boolean;
    apiKey: string;
    readiness: {
      configured: boolean;
      ready: boolean;
      degraded: boolean;
      activeNetworks: Array<keyof typeof ALCHEMY_CONFIG.ENDPOINTS>;
      lastHealthCheckAt: number | null;
      lastHealthError?: string;
    };
  } {
    return {
      arbitrage: this.arbitrageDetector.getStatistics(),
      isActive: this.isActive,
      apiKey: this.apiKey === 'demo' ? 'demo' : '***configured***',
      readiness: {
        configured: this.isConfiguredApiKey(),
        ready: this.isReady(),
        degraded: this.isDegraded,
        activeNetworks: [...this.activeNetworks],
        lastHealthCheckAt: this.lastHealthCheckAt,
        lastHealthError: this.lastHealthError,
      },
    };
  }
}

// Export singleton instance
export const alchemyIntegration = new AlchemyIntegration(process.env.ALCHEMY_API_KEY || 'demo');
