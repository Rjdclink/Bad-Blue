import { Wallet, providers, ethers } from 'ethers';
import logger from '../../../logger.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { walletFromPrivateKey } from '../core/wallet-identity.js';
import { withEvmSignerLane } from './evm-signer-lane.js';
import {
  isSignedRawTransaction,
  nextNonceAfterReservation,
  normalizePendingNonce,
} from './low-latency-execution-policy.js';

const { JsonRpcProvider } = providers;
const { parseUnits } = ethers.utils;

interface OpportunityData {
  to: string;
  data: string;
  value: string;
  gasLimit: number;
}

interface ExecutionResult {
  success: boolean;
  txHash?: string;
  signedTransaction?: string;
  latency: number;
  method: 'instant' | 'multipath';
}

interface GasPrediction {
  mean: number;
  volatility: number;
  recommended: number;
  maxFeePerGas?: number;
  maxPriorityFeePerGas?: number;
  confidence: number;
}

interface SignedSubmission {
  txHash: string;
  path: string;
}

class UltraLowLatencyExecutor {
  private wallet: Wallet | null = null;
  private provider!: providers.JsonRpcProvider;
  private currentNonce: number | null = null;
  private initialized = false;
  private privateRpcUrl: string;
  private gasHistory: number[] = [];
  private executionTail: Promise<void> = Promise.resolve();

  constructor() {
    this.privateRpcUrl = process.env.PRIVATE_RPC_URL || process.env.RPC_URL || '';
  }

  async initialize(): Promise<void> {
    // Any initialization here can touch RPC and prepare transaction state: treat
    // it as execution-adjacent and retain the canonical governance gate.
    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX');
    if (this.initialized) return;

    this.privateRpcUrl = this.privateRpcUrl || process.env.PRIVATE_RPC_URL || process.env.RPC_URL || '';
    if (!this.privateRpcUrl) {
      throw new Error('Missing PRIVATE_RPC_URL or RPC_URL (required for UltraLowLatencyExecutor)');
    }

    const pk = process.env.WALLET_PRIVATE_KEY;
    if (!pk || pk.trim().length === 0) {
      throw new Error('Missing WALLET_PRIVATE_KEY (required for UltraLowLatencyExecutor signer)');
    }
    this.provider = new JsonRpcProvider(this.privateRpcUrl);
    this.wallet = walletFromPrivateKey(pk).connect(this.provider);
    this.currentNonce = await this.wallet.getTransactionCount('pending');
    this.initialized = true;

    logger.info('Ultra-low-latency executor initialized with pending-nonce authority', {
      component: 'UltraLowLatencyExecutor',
      pendingNonce: this.currentNonce,
      configuredSubmissionPaths: ['direct'],
      privateRelayAuthority: 'MultiRelaySubmitter',
      placeholderPresigning: false,
      signOncePerNonce: true,
      distributedSignerLane: true,
    });
  }

  /**
   * One wallet cannot safely have multiple independent nonce owners. Serialize
   * complete submissions for this signer inside the process; executeInstant and
   * executeMultiPath additionally acquire the shared PostgreSQL signer lane so
   * separate replicas cannot race the same account nonce.
   */
  private async withExecutionLane<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.executionTail;
    let release!: () => void;
    this.executionTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private async withDistributedSignerLane<T>(work: () => Promise<T>): Promise<T> {
    if (!this.wallet) throw new Error('Signer wallet not initialized');
    const network = await this.provider.getNetwork();
    return withEvmSignerLane({
      chainId: network.chainId,
      walletAddress: this.wallet.address,
      operation: work,
    });
  }

  private async buildSignedTransaction(opp: OpportunityData): Promise<{ signedTransaction: string; nonce: number }> {
    if (!this.wallet) throw new Error('Signer wallet not initialized');
    const pendingNonce = await this.wallet.getTransactionCount('pending');
    const nonce = normalizePendingNonce(pendingNonce, this.currentNonce);
    const [network, feeData] = await Promise.all([
      this.provider.getNetwork(),
      this.provider.getFeeData(),
    ]);

    const tx: ethers.providers.TransactionRequest = {
      to: opp.to,
      data: opp.data,
      value: opp.value,
      gasLimit: opp.gasLimit,
      nonce,
      chainId: network.chainId,
    };

    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      tx.type = 2;
      tx.maxFeePerGas = feeData.maxFeePerGas;
      tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    } else if (feeData.gasPrice) {
      tx.gasPrice = feeData.gasPrice;
    } else {
      throw new Error('Provider did not return usable transaction fee data');
    }

    const signedTransaction = await this.wallet.signTransaction(tx);
    if (!isSignedRawTransaction(signedTransaction)) {
      throw new Error('Signer did not produce a valid raw transaction payload');
    }
    this.currentNonce = nextNonceAfterReservation(nonce);
    return { signedTransaction, nonce };
  }

  async executeInstant(opp: OpportunityData): Promise<ExecutionResult> {
    const startTime = Date.now();
    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX');
    if (!this.initialized) await this.initialize();

    return this.withExecutionLane(() => this.withDistributedSignerLane(async () => {
      let nonce: number | null = null;
      try {
        const signed = await this.buildSignedTransaction(opp);
        nonce = signed.nonce;
        const result = await this.submitDirect(signed.signedTransaction);
        const latency = Date.now() - startTime;
        logger.info('Transaction accepted via direct low-latency path', {
          component: 'UltraLowLatencyExecutor',
          txHash: result.txHash,
          latency: `${latency}ms`,
          nonce,
        });
        return {
          success: true,
          txHash: result.txHash,
          signedTransaction: signed.signedTransaction,
          latency,
          method: 'instant',
        };
      } catch (error) {
        // With both signer lanes held there is no later local or replica-owned
        // reservation behind this failure. Resync from the shared pending nonce
        // on the next attempt rather than inventing a nonce.
        this.currentNonce = null;
        const latency = Date.now() - startTime;
        logger.error('Instant execution failed', {
          component: 'UltraLowLatencyExecutor',
          nonce,
          error: error instanceof Error ? error.message : String(error),
          latency: `${latency}ms`,
        });
        return { success: false, latency, method: 'instant' };
      }
    }));
  }

  async executeMultiPath(opp: OpportunityData): Promise<ExecutionResult> {
    const startTime = Date.now();
    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX');
    if (!this.initialized) await this.initialize();

    return this.withExecutionLane(() => this.withDistributedSignerLane(async () => {
      let nonce: number | null = null;
      try {
        const signed = await this.buildSignedTransaction(opp);
        nonce = signed.nonce;

        // Direct broadcast is the sole authority here. Private relay/builders
        // are owned by MultiRelaySubmitter and may receive these exact signed
        // bytes after direct acceptance; this executor must not create a second
        // Flashbots/Bloxroute submission authority.
        const result = await this.submitDirect(signed.signedTransaction);
        const latency = Date.now() - startTime;
        logger.info('Transaction accepted via canonical direct broadcast', {
          component: 'UltraLowLatencyExecutor',
          txHash: result.txHash,
          latency: `${latency}ms`,
          winner: result.path,
          nonce,
          privateRelayAuthority: 'MultiRelaySubmitter',
        });
        return {
          success: true,
          txHash: result.txHash,
          signedTransaction: signed.signedTransaction,
          latency,
          method: 'multipath',
        };
      } catch (error) {
        this.currentNonce = null;
        const latency = Date.now() - startTime;
        logger.error('Direct execution failed', {
          component: 'UltraLowLatencyExecutor',
          nonce,
          error: error instanceof Error ? error.message : String(error),
          latency: `${latency}ms`,
        });
        return { success: false, latency, method: 'multipath' };
      }
    }));
  }

  private async submitDirect(signedTransaction: string): Promise<SignedSubmission> {
    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX');
    const response = await this.provider.sendTransaction(signedTransaction);
    return { txHash: response.hash, path: 'direct' };
  }

  async predictOptimalGas(): Promise<GasPrediction> {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      const blockCount = Math.min(200, currentBlock);
      const blocks = await Promise.all(
        Array.from({ length: blockCount }, (_, i) => this.provider.getBlock(currentBlock - i)),
      );
      const gasPrices = blocks
        .filter(b => b && b.baseFeePerGas)
        .map(b => Number(b!.baseFeePerGas));
      this.gasHistory = gasPrices.slice(0, 100);

      if (gasPrices.length === 0) {
        const feeData = await this.provider.getFeeData();
        if (!feeData.gasPrice) throw new Error('Provider did not return gas history or a current gas price');
        const gasPrice = Number(feeData.gasPrice);
        return {
          mean: gasPrice,
          volatility: 0,
          recommended: gasPrice,
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: Math.floor(gasPrice * 0.1),
          confidence: 0.5,
        };
      }

      const mean = gasPrices.reduce((a, b) => a + b, 0) / gasPrices.length;
      const variance = gasPrices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / gasPrices.length;
      const volatility = Math.sqrt(variance);
      const sortedPrices = [...gasPrices].sort((a, b) => a - b);
      const p95Index = Math.floor(sortedPrices.length * 0.95);
      const recommended = sortedPrices[p95Index] || mean + (2 * volatility);
      const recentPrices = gasPrices.slice(0, Math.min(10, gasPrices.length));
      const olderPrices = gasPrices.slice(10, Math.min(20, gasPrices.length));
      let trend = 0;
      if (recentPrices.length > 0 && olderPrices.length > 0) {
        const recentAvg = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
        const olderAvg = olderPrices.reduce((a, b) => a + b, 0) / olderPrices.length;
        trend = olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
      }
      const trendAdjusted = trend > 0.1 ? recommended * 1.1 : recommended;
      const maxFeePerGas = Math.ceil(trendAdjusted);
      const maxPriorityFeePerGas = Math.ceil(maxFeePerGas * 0.15);
      const confidence = Math.min(1.0, gasPrices.length / 200);

      logger.debug('Gas prediction calculated', {
        component: 'UltraLowLatencyExecutor',
        mean: Math.floor(mean),
        volatility: Math.floor(volatility),
        recommended: maxFeePerGas,
        maxPriorityFee: maxPriorityFeePerGas,
        trend: `${(trend * 100).toFixed(2)}%`,
        confidence: confidence.toFixed(2),
        blocksAnalyzed: gasPrices.length,
      });

      return {
        mean,
        volatility,
        recommended: maxFeePerGas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        confidence,
      };
    } catch (error) {
      logger.warn('Failed to predict gas', {
        component: 'UltraLowLatencyExecutor',
        error: error instanceof Error ? error.message : String(error),
      });
      const feeData = await this.provider.getFeeData();
      if (!feeData.gasPrice) throw error;
      const gasPrice = Number(feeData.gasPrice);
      return {
        mean: gasPrice,
        volatility: 0,
        recommended: gasPrice,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: Math.floor(gasPrice * 0.1),
        confidence: 0.3,
      };
    }
  }
}

export { UltraLowLatencyExecutor, type OpportunityData, type ExecutionResult, type GasPrediction };
