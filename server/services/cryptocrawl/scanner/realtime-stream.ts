import { WebSocketProvider, JsonRpcProvider } from 'ethers';
import logger from '../../../logger.js';

interface StreamConfig {
  wsUrl?: string;
  httpUrl: string;
  reconnectDelay?: number;
}

type BlockCallback = (blockNumber: number) => void;
type PendingCallback = (tx: any) => void;

class RealtimeDataStream {
  private wsProvider: WebSocketProvider | null = null;
  private httpProvider: JsonRpcProvider;
  private config: StreamConfig;
  private reconnecting = false;
  private blockCallbacks: BlockCallback[] = [];
  private pendingCallbacks: PendingCallback[] = [];
  private connected = false;

  constructor(config: StreamConfig) {
    this.config = {
      reconnectDelay: 5000,
      ...config
    };
    
    this.httpProvider = new JsonRpcProvider(this.config.httpUrl);
  }

  async initialize(): Promise<void> {
    const wsUrl = this.config.wsUrl || this.constructWsUrl(this.config.httpUrl);
    
    try {
      this.wsProvider = new WebSocketProvider(wsUrl, undefined, {
        batchMaxCount: 1 // No batching = instant
      });

      await this.wsProvider.ready;
      this.connected = true;
      
      this.setupEventListeners();
      
      logger.info('WebSocket connection established', { 
        component: 'RealtimeDataStream',
        wsUrl: wsUrl.replace(/\/\/[^@]*@/, '//***@') // Hide credentials in logs
      });
    } catch (error) {
      logger.error('Failed to establish WebSocket connection', {
        component: 'RealtimeDataStream',
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Fallback to HTTP provider
      logger.info('Falling back to HTTP provider', { component: 'RealtimeDataStream' });
    }
  }

  private constructWsUrl(httpUrl: string): string {
    // Convert https:// to wss:// and http:// to ws://
    return httpUrl.replace(/^https?:\/\//, (match) => 
      match === 'https://' ? 'wss://' : 'ws://'
    );
  }

  private setupEventListeners(): void {
    if (!this.wsProvider) return;

    // Listen for new blocks - trigger immediate opportunity scan
    this.wsProvider.on('block', (blockNumber: number) => {
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
    });

    // Listen for pending transactions - analyze for backrun opportunities
    this.wsProvider.on('pending', (txHash: string) => {
      // Fire and forget - analyze in background
      this.analyzePendingTransaction(txHash).catch(error => {
        logger.debug('Error analyzing pending transaction', {
          component: 'RealtimeDataStream',
          error: error instanceof Error ? error.message : String(error)
        });
      });
    });

    // Handle disconnection
    this.wsProvider.on('error', (error: Error) => {
      logger.warn('WebSocket error', {
        component: 'RealtimeDataStream',
        error: error.message
      });
      this.handleDisconnect();
    });
  }

  private async analyzePendingTransaction(txHash: string): Promise<void> {
    try {
      const tx = await this.wsProvider!.getTransaction(txHash);
      
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
    if (this.reconnecting) return;
    
    this.connected = false;
    this.reconnecting = true;
    
    logger.info('Attempting to reconnect...', { component: 'RealtimeDataStream' });
    
    setTimeout(async () => {
      try {
        await this.initialize();
        this.reconnecting = false;
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

  getHttpProvider(): JsonRpcProvider {
    return this.httpProvider;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async destroy(): Promise<void> {
    if (this.wsProvider) {
      this.wsProvider.removeAllListeners();
      await this.wsProvider.destroy();
      this.wsProvider = null;
    }
    this.connected = false;
    this.blockCallbacks = [];
    this.pendingCallbacks = [];
    
    logger.info('RealtimeDataStream destroyed', { component: 'RealtimeDataStream' });
  }
}

export { RealtimeDataStream, type StreamConfig, type BlockCallback, type PendingCallback };
