import { JsonRpcProvider, Wallet } from 'ethers';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import logger from '../../../logger.js';

interface RelayConfig {
  name: string;
  endpoint: string;
  latency: number;
}

interface SubmissionResult {
  submitted: number;
  successful: string[];
  failed: string[];
}

interface Bundle {
  signedTransactions: string[];
  targetBlock: number;
}

interface RelayMetrics {
  successCount: number;
  failureCount: number;
  totalAttempts: number;
  successRate: number;
}

const RELAYS: RelayConfig[] = [
  { name: 'Flashbots', endpoint: 'https://relay.flashbots.net', latency: 12 },
  { name: 'BloXroute', endpoint: 'https://mev.api.bloxroute.com', latency: 8 },
  { name: 'Beaver', endpoint: 'https://rpc.beaverbuild.org', latency: 14 },
  { name: 'Titan', endpoint: 'https://rpc.titanbuilder.xyz', latency: 16 },
  { name: 'Rsync', endpoint: 'https://rsync-builder.xyz', latency: 10 }
];

class MultiRelaySubmitter {
  private providers: Map<string, FlashbotsBundleProvider> = new Map();
  private metrics: Map<string, RelayMetrics> = new Map();
  private initialized = false;
  private provider: JsonRpcProvider;
  private wallet: Wallet;

  constructor() {
    this.provider = new JsonRpcProvider(process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo');
    this.wallet = new Wallet(
      process.env.PRIVATE_KEY || Wallet.createRandom().privateKey,
      this.provider
    );
    
    // Initialize metrics for all relays
    RELAYS.forEach(relay => {
      this.metrics.set(relay.name, {
        successCount: 0,
        failureCount: 0,
        totalAttempts: 0,
        successRate: 0
      });
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing multi-relay connections...', { component: 'MultiRelaySubmitter' });

    const initPromises = RELAYS.map(async (relay) => {
      try {
        const flashbotsProvider = await FlashbotsBundleProvider.create(
          this.provider,
          this.wallet,
          relay.endpoint,
          'mainnet'
        );
        this.providers.set(relay.name, flashbotsProvider);
        logger.debug(`Connected to ${relay.name} relay`, { component: 'MultiRelaySubmitter' });
      } catch (error) {
        logger.warn(`Failed to connect to ${relay.name}`, { 
          component: 'MultiRelaySubmitter',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    await Promise.allSettled(initPromises);
    this.initialized = true;
    logger.info(`Multi-relay initialization complete: ${this.providers.size}/${RELAYS.length} relays connected`, {
      component: 'MultiRelaySubmitter'
    });
  }

  async submitBundle(bundle: Bundle, targetBlock: number): Promise<SubmissionResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const result: SubmissionResult = {
      submitted: 0,
      successful: [],
      failed: []
    };

    const submissionPromises = Array.from(this.providers.entries()).map(async ([name, provider]) => {
      const metrics = this.metrics.get(name)!;
      metrics.totalAttempts++;

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Submission timeout')), 2000)
        );

        const submissionPromise = provider.sendBundle(bundle.signedTransactions, targetBlock);
        
        await Promise.race([submissionPromise, timeoutPromise]);
        
        result.submitted++;
        result.successful.push(name);
        metrics.successCount++;
        metrics.successRate = metrics.successCount / metrics.totalAttempts;
        
        logger.debug(`Bundle submitted to ${name}`, { 
          component: 'MultiRelaySubmitter',
          targetBlock 
        });
      } catch (error) {
        result.failed.push(name);
        metrics.failureCount++;
        metrics.successRate = metrics.successCount / metrics.totalAttempts;
        
        logger.debug(`Failed to submit to ${name}`, { 
          component: 'MultiRelaySubmitter',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    await Promise.allSettled(submissionPromises);

    logger.info('Bundle submission complete', {
      component: 'MultiRelaySubmitter',
      submitted: result.submitted,
      successful: result.successful.length,
      failed: result.failed.length,
      targetBlock
    });

    return result;
  }

  getMetrics(): Map<string, RelayMetrics> {
    return new Map(this.metrics);
  }

  getSuccessRate(relayName: string): number {
    return this.metrics.get(relayName)?.successRate || 0;
  }
}

export { MultiRelaySubmitter, type Bundle, type SubmissionResult, type RelayMetrics };
