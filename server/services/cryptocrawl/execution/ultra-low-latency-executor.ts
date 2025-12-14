import { Wallet, providers, ethers } from 'ethers';
import logger from '../../../logger.js';
import { CRYPTO_EXECUTION_RELEASED, assertCryptoExecutionReleased } from '../../../../shared/cryptoExecutionPolicy';

const { JsonRpcProvider } = providers;
const { parseEther, parseUnits } = ethers.utils;

interface OpportunityData {
  to: string;
  data: string;
  value: string;
  gasLimit: number;
}

interface ExecutionResult {
  success: boolean;
  txHash?: string;
  latency: number;
  method: 'instant' | 'multipath';
}

interface PreSignedTx {
  nonce: number;
  transaction: ethers.Transaction;
  used: boolean;
}

interface GasPrediction {
  mean: number;
  volatility: number;
  recommended: number;
  maxFeePerGas?: number; // 2024: EIP-1559 support
  maxPriorityFeePerGas?: number; // 2024: EIP-1559 support
  confidence: number; // 2024: Prediction confidence score
}

class UltraLowLatencyExecutor {
  private wallet: Wallet | null = null;
  private provider: providers.JsonRpcProvider | null = null;
  private preSignedTxPool: PreSignedTx[] = [];
  private currentNonce: number = 0;
  private initialized = false;
  private privateRpcUrl: string;
  private flashbotsUrl: string;
  private bloxrouteUrl: string;
  private gasHistory: number[] = []; // 2024: Gas history tracking

  constructor() {
    this.privateRpcUrl = process.env.PRIVATE_RPC_URL || process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo';
    this.flashbotsUrl = process.env.FLASHBOTS_RPC || 'https://rpc.flashbots.net';
    this.bloxrouteUrl = process.env.BLOXROUTE_RPC || 'https://mev.api.bloxroute.com';

    // STAGE 2: prevent any signer/private-key usage at module load time.
    // Only construct provider/wallet if execution is explicitly released.
    if (CRYPTO_EXECUTION_RELEASED) {
      this.provider = new JsonRpcProvider(this.privateRpcUrl);
      this.wallet = new Wallet(
        process.env.PRIVATE_KEY || Wallet.createRandom().privateKey,
        this.provider
      );
    }
  }

  async initialize(): Promise<void> {
    if (!CRYPTO_EXECUTION_RELEASED) {
      assertCryptoExecutionReleased('cryptocrawl.execution.ultra-low-latency.initialize');
    }
    if (this.initialized) return;
    if (!this.wallet || !this.provider) {
      assertCryptoExecutionReleased('cryptocrawl.execution.ultra-low-latency.missing-provider-or-wallet');
    }

    logger.info('Initializing ultra-low-latency executor...', { 
      component: 'UltraLowLatencyExecutor' 
    });

    // Get current nonce
    this.currentNonce = await this.wallet.getTransactionCount();
    
    // Pre-sign 100 transaction templates
    const gasPrice = await this.predictOptimalGas();
    
    for (let i = 0; i < 100; i++) {
      try {
        const tx = await this.wallet.signTransaction({
          nonce: this.currentNonce + i,
          gasPrice: gasPrice.recommended,
          gasLimit: 500000,
          to: this.wallet.address, // Placeholder
          value: 0,
          data: '0x', // Placeholder
          chainId: 1
        });

        this.preSignedTxPool.push({
          nonce: this.currentNonce + i,
          transaction: ethers.utils.parseTransaction(tx),
          used: false
        });
      } catch (error) {
        logger.warn('Failed to pre-sign transaction', {
          component: 'UltraLowLatencyExecutor',
          nonce: this.currentNonce + i,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.initialized = true;
    logger.info(`Pre-signed ${this.preSignedTxPool.length} transactions`, {
      component: 'UltraLowLatencyExecutor',
      startNonce: this.currentNonce
    });
  }

  async executeInstant(opp: OpportunityData): Promise<ExecutionResult> {
    const startTime = Date.now();
    if (!CRYPTO_EXECUTION_RELEASED) {
      assertCryptoExecutionReleased('cryptocrawl.execution.ultra-low-latency.executeInstant');
    }
    if (!this.wallet || !this.provider) {
      assertCryptoExecutionReleased('cryptocrawl.execution.ultra-low-latency.missing-provider-or-wallet');
    }

    if (!this.initialized) {
      await this.initialize();
    }

    // Find unused pre-signed transaction
    const preSignedTx = this.preSignedTxPool.find(tx => !tx.used);
    
    if (!preSignedTx) {
      logger.warn('No pre-signed transactions available', {
        component: 'UltraLowLatencyExecutor'
      });
      return {
        success: false,
        latency: Date.now() - startTime,
        method: 'instant'
      };
    }

    try {
      // Update transaction parameters (takes ~2ms)
      // Extract only the properties needed for TransactionRequest
      const updatedTx: ethers.providers.TransactionRequest = {
        nonce: preSignedTx.transaction.nonce,
        gasPrice: preSignedTx.transaction.gasPrice,
        chainId: preSignedTx.transaction.chainId,
        type: preSignedTx.transaction.type || undefined,
        accessList: preSignedTx.transaction.accessList,
        maxPriorityFeePerGas: preSignedTx.transaction.maxPriorityFeePerGas,
        maxFeePerGas: preSignedTx.transaction.maxFeePerGas,
        to: opp.to,
        data: opp.data,
        value: opp.value,
        gasLimit: opp.gasLimit
      };

      // Mark as used
      preSignedTx.used = true;

      // Submit via private RPC
      const signedTx = await this.wallet.signTransaction(updatedTx);
      const response = await this.provider.sendTransaction(signedTx);

      const latency = Date.now() - startTime;
      
      logger.info('Transaction executed via instant path', {
        component: 'UltraLowLatencyExecutor',
        txHash: response.hash,
        latency: `${latency}ms`
      });

      return {
        success: true,
        txHash: response.hash,
        latency,
        method: 'instant'
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      logger.error('Instant execution failed', {
        component: 'UltraLowLatencyExecutor',
        error: error instanceof Error ? error.message : String(error),
        latency: `${latency}ms`
      });

      return {
        success: false,
        latency,
        method: 'instant'
      };
    }
  }

  async executeMultiPath(opp: OpportunityData): Promise<ExecutionResult> {
    const startTime = Date.now();
    if (!CRYPTO_EXECUTION_RELEASED) {
      assertCryptoExecutionReleased('cryptocrawl.execution.ultra-low-latency.executeMultiPath');
    }
    if (!this.wallet || !this.provider) {
      assertCryptoExecutionReleased('cryptocrawl.execution.ultra-low-latency.missing-provider-or-wallet');
    }
    const wallet = this.wallet;
    const provider = this.provider;

    // Prepare transaction
    const tx = {
      to: opp.to,
      data: opp.data,
      value: opp.value,
      gasLimit: opp.gasLimit,
      nonce: await wallet.getTransactionCount()
    };

    // Race 3 execution paths simultaneously
    const flashbotsPromise = this.submitViaFlashbots(tx);
    const bloxroutePromise = this.submitViaBloxroute(tx);
    const directPromise = this.submitDirect(tx);

    try {
      // First one wins
      const result = await Promise.race([
        flashbotsPromise,
        bloxroutePromise,
        directPromise
      ]);

      const latency = Date.now() - startTime;

      logger.info('Transaction executed via multi-path', {
        component: 'UltraLowLatencyExecutor',
        txHash: result.txHash,
        latency: `${latency}ms`,
        winner: result.path
      });

      return {
        success: true,
        txHash: result.txHash,
        latency,
        method: 'multipath'
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      logger.error('Multi-path execution failed', {
        component: 'UltraLowLatencyExecutor',
        error: error instanceof Error ? error.message : String(error),
        latency: `${latency}ms`
      });

      return {
        success: false,
        latency,
        method: 'multipath'
      };
    }
  }

  private async submitViaFlashbots(tx: any): Promise<{ txHash: string; path: string }> {
    if (!this.wallet) {
      assertCryptoExecutionReleased('cryptocrawl.execution.ultra-low-latency.submitViaFlashbots.missing-wallet');
    }
    const signedTx = await this.wallet.signTransaction(tx);
    const flashbotsProvider = new JsonRpcProvider(this.flashbotsUrl);
    const response = await flashbotsProvider.sendTransaction(signedTx);
    return { txHash: response.hash, path: 'flashbots' };
  }

  private async submitViaBloxroute(tx: any): Promise<{ txHash: string; path: string }> {
    if (!this.wallet) {
      assertCryptoExecutionReleased('cryptocrawl.execution.ultra-low-latency.submitViaBloxroute.missing-wallet');
    }
    const signedTx = await this.wallet.signTransaction(tx);
    const bloxrouteProvider = new JsonRpcProvider(this.bloxrouteUrl);
    const response = await bloxrouteProvider.sendTransaction(signedTx);
    return { txHash: response.hash, path: 'bloxroute' };
  }

  private async submitDirect(tx: any): Promise<{ txHash: string; path: string }> {
    if (!this.wallet || !this.provider) {
      assertCryptoExecutionReleased('cryptocrawl.execution.ultra-low-latency.submitDirect.missing-wallet-or-provider');
    }
    const signedTx = await this.wallet.signTransaction(tx);
    const response = await this.provider.sendTransaction(signedTx);
    return { txHash: response.hash, path: 'direct' };
  }

  async predictOptimalGas(): Promise<GasPrediction> {
    try {
      if (!this.provider) {
        assertCryptoExecutionReleased('cryptocrawl.execution.ultra-low-latency.predictOptimalGas.missing-provider');
      }
      const provider = this.provider;
      const currentBlock = await provider.getBlockNumber();
      
      // 2024 Research: Fetch more blocks for better prediction (200 blocks ~40min)
      const blockCount = Math.min(200, currentBlock);
      const blocks = await Promise.all(
        Array.from({ length: blockCount }, (_, i) => 
          provider.getBlock(currentBlock - i)
        )
      );

      const gasPrices = blocks
        .filter(b => b && b.baseFeePerGas)
        .map(b => Number(b!.baseFeePerGas));

      // Store gas history for trend analysis
      this.gasHistory = gasPrices.slice(0, 100);

      if (gasPrices.length === 0) {
        const feeData = await provider.getFeeData();
        const gasPrice = Number(feeData.gasPrice || parseUnits('1', 'gwei'));
        return {
          mean: gasPrice,
          volatility: 0,
          recommended: gasPrice,
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: Math.floor(gasPrice * 0.1),
          confidence: 0.5
        };
      }

      // Calculate statistical measures
      const mean = gasPrices.reduce((a, b) => a + b, 0) / gasPrices.length;
      const variance = gasPrices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / gasPrices.length;
      const volatility = Math.sqrt(variance);

      // 2024 Research: Use percentile-based recommendation (more robust than mean + 2σ)
      const sortedPrices = [...gasPrices].sort((a, b) => a - b);
      const p95Index = Math.floor(sortedPrices.length * 0.95);
      const recommended = sortedPrices[p95Index] || mean + (2 * volatility);

      // 2024: Calculate trend-based adjustment (with safety guards)
      const recentPrices = gasPrices.slice(0, Math.min(10, gasPrices.length));
      const olderPrices = gasPrices.slice(10, Math.min(20, gasPrices.length));
      
      let trend = 0;
      if (recentPrices.length > 0 && olderPrices.length > 0) {
        const recentAvg = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
        const olderAvg = olderPrices.reduce((a, b) => a + b, 0) / olderPrices.length;
        trend = olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
      }

      // Adjust recommendation based on trend
      const trendAdjusted = trend > 0.1 ? recommended * 1.1 : recommended;

      // 2024: EIP-1559 support
      const maxFeePerGas = Math.ceil(trendAdjusted);
      const maxPriorityFeePerGas = Math.ceil(maxFeePerGas * 0.15); // 15% tip

      // Calculate confidence score based on data quality
      const confidence = Math.min(1.0, gasPrices.length / 200);

      logger.debug('Gas prediction calculated', {
        component: 'UltraLowLatencyExecutor',
        mean: Math.floor(mean),
        volatility: Math.floor(volatility),
        recommended: maxFeePerGas,
        maxPriorityFee: maxPriorityFeePerGas,
        trend: `${(trend * 100).toFixed(2)}%`,
        confidence: confidence.toFixed(2),
        blocksAnalyzed: gasPrices.length
      });

      return { 
        mean, 
        volatility, 
        recommended: maxFeePerGas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        confidence
      };
    } catch (error) {
      logger.warn('Failed to predict gas', {
        component: 'UltraLowLatencyExecutor',
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Fallback to current gas price
      if (!this.provider) {
        assertCryptoExecutionReleased('cryptocrawl.execution.ultra-low-latency.predictOptimalGas.fallback.missing-provider');
      }
      const feeData = await this.provider.getFeeData();
      const gasPrice = Number(feeData.gasPrice || parseUnits('1', 'gwei'));
      
      return {
        mean: gasPrice,
        volatility: 0,
        recommended: gasPrice,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: Math.floor(gasPrice * 0.1),
        confidence: 0.3
      };
    }
  }
}

export { UltraLowLatencyExecutor, type OpportunityData, type ExecutionResult, type GasPrediction };
