import { providers } from 'ethers';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import logger from '../../../logger.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { getOrCreateFlashbotsAuthPrivateKey } from './adapters/flashbots-auth-identity.js';
import { walletFromPrivateKey } from '../core/wallet-identity.js';

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
  avgLatency: number;
  lastSuccessTime: number;
  performance: RelayPerformance;
}

interface RelayPerformance {
  latency: number;
  successRate: number;
  lastUpdate: number;
  profitShare: number;
  preferredForPrivate: boolean;
}

interface RealBundleSimulation {
  valid: boolean;
  reason?: string;
  relay?: string;
  bundleHash?: string;
  totalGasUsed?: number;
  firstRevert?: string;
}

const MIN_RELAYS = 5;
const MAX_RELAYS = 7;
const COMPLEX_BUNDLE_THRESHOLD = 5;

const RELAYS: RelayConfig[] = [
  { name: 'Flashbots', endpoint: 'https://relay.flashbots.net', latency: 12 },
  { name: 'BloXroute', endpoint: 'https://mev.api.bloxroute.com', latency: 8 },
  { name: 'Beaver', endpoint: 'https://rpc.beaverbuild.org', latency: 14 },
  { name: 'Titan', endpoint: 'https://rpc.titanbuilder.xyz', latency: 16 },
  { name: 'Rsync', endpoint: 'https://rsync-builder.xyz', latency: 10 },
  { name: 'Manifold', endpoint: 'https://rpc.manifold.xyz', latency: 11 },
  { name: 'Agnostic', endpoint: 'https://agnostic-relay.net', latency: 13 },
];

class MultiRelaySubmitter {
  private providers: Map<string, FlashbotsBundleProvider> = new Map();
  private metrics: Map<string, RelayMetrics> = new Map();
  private initialized = false;
  private provider!: providers.JsonRpcProvider;

  constructor() {
    RELAYS.forEach(relay => {
      this.metrics.set(relay.name, {
        successCount: 0,
        failureCount: 0,
        totalAttempts: 0,
        successRate: 0,
        avgLatency: relay.latency,
        lastSuccessTime: 0,
        performance: {
          latency: relay.latency,
          successRate: 0,
          lastUpdate: Date.now(),
          profitShare: 0,
          preferredForPrivate: false,
        },
      });
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await multiProviderRpcManager.initialize(['ethereum']);
    this.provider = (await multiProviderRpcManager.getProvider('ethereum', 'json_rpc')).http;
    const authPrivateKey = await getOrCreateFlashbotsAuthPrivateKey();
    const authSigner = walletFromPrivateKey(authPrivateKey);

    logger.info('Initializing multi-relay connections...', { component: 'MultiRelaySubmitter' });

    const initPromises = RELAYS.map(async relay => {
      try {
        const flashbotsProvider = await FlashbotsBundleProvider.create(
          this.provider,
          authSigner,
          relay.endpoint,
          'mainnet',
        );
        this.providers.set(relay.name, flashbotsProvider);
        logger.debug(`Connected to ${relay.name} relay`, { component: 'MultiRelaySubmitter' });
      } catch (error) {
        logger.warn(`Failed to connect to ${relay.name}`, {
          component: 'MultiRelaySubmitter',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await Promise.allSettled(initPromises);
    this.initialized = true;
    logger.info(`Multi-relay initialization complete: ${this.providers.size}/${RELAYS.length} relays connected`, {
      component: 'MultiRelaySubmitter',
    });
  }

  async submitBundle(bundle: Bundle, targetBlock: number): Promise<SubmissionResult> {
    if (!this.initialized) await this.initialize();

    if (!Number.isSafeInteger(targetBlock) || targetBlock <= 0 || bundle.targetBlock !== targetBlock) {
      logger.warn('Bundle target-block mismatch; skipping submission', {
        component: 'MultiRelaySubmitter',
        bundleTargetBlock: bundle.targetBlock,
        requestedTargetBlock: targetBlock,
      });
      return { submitted: 0, successful: [], failed: Array.from(this.providers.keys()) };
    }

    const simulation = await this.simulateBundle(bundle, targetBlock);
    if (!simulation.valid) {
      logger.warn('Real eth_callBundle simulation failed, skipping submission', {
        component: 'MultiRelaySubmitter',
        reason: simulation.reason,
        relay: simulation.relay,
        firstRevert: simulation.firstRevert,
      });
      return {
        submitted: 0,
        successful: [],
        failed: Array.from(this.providers.keys()),
      };
    }

    const selectedRelays = this.selectOptimalRelays(bundle);
    const result: SubmissionResult = { submitted: 0, successful: [], failed: [] };

    const submissionPromises = Array.from(selectedRelays.entries()).map(async ([name, provider]: [string, FlashbotsBundleProvider]) => {
      const metrics = this.metrics.get(name)!;
      metrics.totalAttempts++;
      const startTime = Date.now();

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Submission timeout')), 2000),
        );
        const flashbotsBundle = bundle.signedTransactions.map(tx => ({ signedTransaction: tx }));
        const submissionPromise = provider.sendBundle(flashbotsBundle, targetBlock);
        const response = await Promise.race([submissionPromise, timeoutPromise]);
        if (response && typeof response === 'object' && 'error' in response) {
          const relayError = (response as any).error;
          throw new Error(relayError?.message || 'relay rejected bundle');
        }

        const latency = Date.now() - startTime;
        result.submitted++;
        result.successful.push(name);
        metrics.successCount++;
        metrics.successRate = metrics.successCount / metrics.totalAttempts;
        metrics.avgLatency = (metrics.avgLatency * (metrics.totalAttempts - 1) + latency) / metrics.totalAttempts;
        metrics.lastSuccessTime = Date.now();
        metrics.performance.lastUpdate = Date.now();
        metrics.performance.successRate = metrics.successRate;
        metrics.performance.latency = metrics.avgLatency;

        logger.debug(`Bundle submitted to ${name}`, {
          component: 'MultiRelaySubmitter',
          targetBlock,
          latency: `${latency}ms`,
        });
      } catch (error) {
        const latency = Date.now() - startTime;
        result.failed.push(name);
        metrics.failureCount++;
        metrics.successRate = metrics.successCount / metrics.totalAttempts;
        metrics.performance.lastUpdate = Date.now();
        metrics.performance.successRate = metrics.successRate;
        metrics.performance.latency = metrics.avgLatency;

        logger.debug(`Failed to submit to ${name}`, {
          component: 'MultiRelaySubmitter',
          latency: `${latency}ms`,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await Promise.allSettled(submissionPromises);

    logger.info('Bundle submission complete', {
      component: 'MultiRelaySubmitter',
      submitted: result.submitted,
      successful: result.successful.length,
      failed: result.failed.length,
      targetBlock,
      simulationRelay: simulation.relay,
      simulationBundleHash: simulation.bundleHash,
      simulationTotalGasUsed: simulation.totalGasUsed,
      simulationAuthority: 'eth_callBundle',
    });

    return result;
  }

  /**
   * Actual Flashbots-compatible eth_callBundle simulation. Structural checks or
   * synthetic scores are not accepted as execution evidence. A single revert or
   * relay error blocks submission to every relay.
   */
  private async simulateBundle(bundle: Bundle, targetBlock: number): Promise<RealBundleSimulation> {
    if (!bundle.signedTransactions?.length) return { valid: false, reason: 'Empty bundle' };
    if (bundle.signedTransactions.some(transaction => typeof transaction !== 'string' || !transaction.startsWith('0x'))) {
      return { valid: false, reason: 'Bundle contains an invalid signed transaction' };
    }

    try {
      const currentBlock = await this.provider.getBlockNumber();
      if (targetBlock <= currentBlock) return { valid: false, reason: 'Target block must be in the future' };
      if (targetBlock > currentBlock + 10) return { valid: false, reason: 'Target block too far in future' };

      const preferred = this.providers.get('Flashbots');
      const fallback = preferred ? null : this.providers.entries().next().value as [string, FlashbotsBundleProvider] | undefined;
      const relayName = preferred ? 'Flashbots' : fallback?.[0];
      const simulationProvider = preferred || fallback?.[1];
      if (!simulationProvider || !relayName) return { valid: false, reason: 'No relay is available for eth_callBundle simulation' };

      const simulation = await simulationProvider.simulate(bundle.signedTransactions, targetBlock);
      if ('error' in simulation) {
        return {
          valid: false,
          relay: relayName,
          reason: simulation.error?.message || 'Relay returned a simulation error',
        };
      }

      const firstRevert = (simulation as any).firstRevert ||
        (Array.isArray((simulation as any).results)
          ? (simulation as any).results.find((item: any) => item?.error || item?.revert)
          : undefined);
      if (firstRevert) {
        return {
          valid: false,
          relay: relayName,
          bundleHash: (simulation as any).bundleHash,
          totalGasUsed: Number((simulation as any).totalGasUsed) || undefined,
          firstRevert: String(firstRevert.revert || firstRevert.error || 'transaction reverted'),
          reason: 'One or more bundle transactions revert in relay simulation',
        };
      }

      return {
        valid: true,
        relay: relayName,
        bundleHash: (simulation as any).bundleHash,
        totalGasUsed: Number((simulation as any).totalGasUsed) || undefined,
      };
    } catch (error) {
      logger.error('Bundle eth_callBundle simulation error', {
        component: 'MultiRelaySubmitter',
        error: error instanceof Error ? error.message : String(error),
      });
      return { valid: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private selectOptimalRelays(bundle: Bundle): Map<string, FlashbotsBundleProvider> {
    const relayScores = new Map<string, number>();

    for (const [name, metrics] of this.metrics) {
      const provider = this.providers.get(name);
      if (!provider) continue;
      const successScore = metrics.successRate * 40;
      const latencyScore = (1 - Math.min(metrics.avgLatency / 100, 1)) * 30;
      const recencyScore = Date.now() - metrics.lastSuccessTime < 60_000 ? 30 : 15;
      relayScores.set(name, successScore + latencyScore + recencyScore);
    }

    const targetRelayCount = bundle.signedTransactions.length > COMPLEX_BUNDLE_THRESHOLD ? MAX_RELAYS : MIN_RELAYS;
    const sortedRelays = Array.from(relayScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, targetRelayCount);

    const selectedRelays = new Map<string, FlashbotsBundleProvider>();
    for (const [name] of sortedRelays) {
      const provider = this.providers.get(name);
      if (provider) selectedRelays.set(name, provider);
    }

    logger.debug('Selected relays for submission', {
      component: 'MultiRelaySubmitter',
      relays: Array.from(selectedRelays.keys()),
      scores: Object.fromEntries(sortedRelays),
    });

    return selectedRelays;
  }

  getMetrics(): Map<string, RelayMetrics> {
    return new Map(this.metrics);
  }

  getSuccessRate(relayName: string): number {
    return this.metrics.get(relayName)?.successRate || 0;
  }
}

export { MultiRelaySubmitter, type Bundle, type SubmissionResult, type RelayMetrics };
