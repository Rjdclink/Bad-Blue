import logger from '../../../logger.js';
import { multiProviderRpcManager, type LogicalSubscription, type SupportedChain } from '../api/blockchain-providers.js';

interface StreamConfig {
  wsUrl?: string;
  httpUrl?: string;
  chain?: SupportedChain;
  reconnectDelay?: number;
}

type BlockCallback = (blockNumber: number) => void;
type PendingCallback = (tx: any) => void;

class RealtimeDataStream {
  private httpProvider: import('ethers').providers.JsonRpcProvider | null = null;
  private blockSubscription: LogicalSubscription | null = null;
  private pendingSubscription: LogicalSubscription | null = null;
  private config: StreamConfig;
  private reconnecting = false;
  private shuttingDown = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private blockCallbacks: BlockCallback[] = [];
  private pendingCallbacks: PendingCallback[] = [];
  private connected = false;

  constructor(config: StreamConfig) {
    this.config = {
      reconnectDelay: 5000,
      ...config
    };
    
  }

  async initialize(): Promise<void> {
    if (this.shuttingDown || this.connected || this.reconnecting) return;
    const chain = this.config.chain || 'ethereum';
    
    try {
      await multiProviderRpcManager.initialize([chain]);
      const managed = await multiProviderRpcManager.getProvider(chain, 'blocks');
      this.httpProvider = managed.http;
      this.blockSubscription = await multiProviderRpcManager.subscribe(chain, 'blocks', value => {
        if (typeof value !== 'number') return;
        this.dispatchBlock(value);
      });
      this.connected = this.blockSubscription.state === 'healthy';
      try {
        this.pendingSubscription = await multiProviderRpcManager.subscribe(chain, 'pending_transactions', value => {
          if (typeof value === 'string') this.analyzePendingTransaction(value).catch(() => undefined);
        });
      } catch {
        this.pendingSubscription = null;
      }
      logger.info(this.connected ? 'WebSocket connection established' : 'Realtime stream degraded to HTTP polling', {
        component: 'RealtimeDataStream',
        chain,
        provider: this.blockSubscription.provider,
        pendingTransactions: this.pendingSubscription?.state === 'healthy' ? 'available' : 'unavailable',
      });
    } catch (error) {
      logger.error('Failed to establish WebSocket connection', {
        component: 'RealtimeDataStream',
        error: error instanceof Error ? error.message : String(error)
      });
      
      logger.info('Falling back to shared HTTP block polling', { component: 'RealtimeDataStream', chain });
      this.handleDisconnect();
    }
  }

  private dispatchBlock(blockNumber: number): void {
      logger.debug('New block detected', { 
        component: 'RealtimeDataStream',
        blockNumber 
      });
      
      // Fire and forget - don't await
      this.blockCallbacks.forEach(callback => {
        try {
          callback(blockNumber);
        } catch (error) {
          logger.error('Block callback error', {
            component: 'RealtimeDataStream',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });
  }

  private async analyzePendingTransaction(txHash: string): Promise<void> {
    try {
      const { result: tx } = await multiProviderRpcManager.execute(
        this.config.chain || 'ethereum', 'transactions', provider => provider.getTransaction(txHash),
      );
      
      if (!tx || !tx.value) return;
      
      // Filter: only large swaps >$50k (assuming 1 ETH = $2000, so >25 ETH)
      const valueInEth = Number(tx.value) / 1e18;
      if (valueInEth < 25) return;
      
      // Notify callbacks for backrun opportunities
      this.pendingCallbacks.forEach(callback => {
        try {
          callback(tx);
        } catch (error) {
          logger.debug('Pending callback error', {
            component: 'RealtimeDataStream',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });
    } catch (error) {
      // Silently ignore - pending tx might not be available yet
    }
  }

  private handleDisconnect(): void {
    if (this.shuttingDown || this.reconnecting) return;
    
    this.connected = false;
    this.reconnecting = true;

    logger.info('Attempting to reconnect...', { component: 'RealtimeDataStream' });
    
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        this.reconnecting = false;
        await this.initialize();
      } catch (error) {
        this.reconnecting = false;
        logger.error('Reconnection failed', {
          component: 'RealtimeDataStream',
          error: error instanceof Error ? error.message : String(error)
        });
        // Try again
        this.handleDisconnect();
      }
    }, this.config.reconnectDelay);
  }

  onBlock(callback: BlockCallback): void {
    this.blockCallbacks.push(callback);
  }

  onPendingTransaction(callback: PendingCallback): void {
    this.pendingCallbacks.push(callback);
  }

  async getHttpProvider(): Promise<import('ethers').providers.JsonRpcProvider> {
    if (this.httpProvider) return this.httpProvider;
    await multiProviderRpcManager.initialize([this.config.chain || 'ethereum']);
    const provider = await multiProviderRpcManager.getProvider(this.config.chain || 'ethereum', 'blocks');
    this.httpProvider = provider.http;
    return provider.http;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async destroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.blockSubscription?.unsubscribe();
    await this.pendingSubscription?.unsubscribe();
    this.blockSubscription = null;
    this.pendingSubscription = null;
    this.connected = false;
    this.blockCallbacks = [];
    this.pendingCallbacks = [];
    
    logger.info('RealtimeDataStream destroyed', { component: 'RealtimeDataStream' });
  }
}

export { RealtimeDataStream, type StreamConfig, type BlockCallback, type PendingCallback };
