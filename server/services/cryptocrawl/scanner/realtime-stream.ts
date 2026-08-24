import { providers } from 'ethers';
import logger from '../../../logger.js';
import { attachWebSocketTransportGuards } from '../api/blockchain-providers.js';

const { WebSocketProvider, JsonRpcProvider } = providers;

interface StreamConfig {
  wsUrl?: string;
  httpUrl: string;
  reconnectDelay?: number;
}

type BlockCallback = (blockNumber: number) => void;
type PendingCallback = (tx: any) => void;

class RealtimeDataStream {
  private wsProvider: providers.WebSocketProvider | null = null;
  private httpProvider: providers.JsonRpcProvider;
  private config: StreamConfig;
  private reconnecting = false;
  private shuttingDown = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pollingTimer: NodeJS.Timeout | null = null;
  private socketGuardCleanup: (() => void) | null = null;
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
    if (this.shuttingDown || this.connected || this.reconnecting) return;
    const wsUrl = this.config.wsUrl || this.constructWsUrl(this.config.httpUrl);
    
    try {
      // WebSocketProvider in ethers v6 takes (url, network) only
      this.wsProvider = new WebSocketProvider(wsUrl);
      this.attachSocketGuards();

      await this.wsProvider.ready;
      this.connected = true;
      this.stopHttpPolling();
      
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
      this.startHttpPolling();
      this.handleDisconnect();
    }
  }

  private attachSocketGuards(): void {
    const socket = (this.wsProvider as any)?._websocket;
    if (!socket || typeof socket.on !== 'function') return;
    this.socketGuardCleanup = attachWebSocketTransportGuards(socket, {
      onFailure: (error: unknown) => {
      logger.warn('Underlying WebSocket transport failed; isolating stream', {
        component: 'RealtimeDataStream',
        error: error instanceof Error ? error.message : String(error),
      });
      this.handleDisconnect();
      },
      onClose: () => this.handleDisconnect(),
    });
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
    if (this.shuttingDown || this.reconnecting) return;
    
    this.connected = false;
    this.reconnecting = true;
    this.startHttpPolling();

    try { this.wsProvider?.removeAllListeners(); } catch { /* provider may already be closed */ }
    this.socketGuardCleanup?.();
    this.socketGuardCleanup = null;
    try { (this.wsProvider as any)?.destroy?.(); } catch { /* socket cleanup is best effort */ }
    this.wsProvider = null;
    
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

  private startHttpPolling(): void {
    if (this.pollingTimer || this.shuttingDown) return;
    this.pollingTimer = setInterval(async () => {
      try {
        const blockNumber = await this.httpProvider.getBlockNumber();
        this.blockCallbacks.forEach(callback => {
          try { callback(blockNumber); } catch (error) { logger.warn('HTTP block callback error', { component: 'RealtimeDataStream', error }); }
        });
      } catch (error) {
        logger.warn('HTTP polling degraded', { component: 'RealtimeDataStream', error: error instanceof Error ? error.message : String(error) });
      }
    }, 2000);
  }

  private stopHttpPolling(): void {
    if (!this.pollingTimer) return;
    clearInterval(this.pollingTimer);
    this.pollingTimer = null;
  }

  onBlock(callback: BlockCallback): void {
    this.blockCallbacks.push(callback);
  }

  onPendingTransaction(callback: PendingCallback): void {
    this.pendingCallbacks.push(callback);
  }

  getHttpProvider(): providers.JsonRpcProvider {
    return this.httpProvider;
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
    this.stopHttpPolling();
    if (this.wsProvider) {
      this.wsProvider.removeAllListeners();
      await (this.wsProvider as any).destroy?.();
      this.wsProvider = null;
    }
    this.connected = false;
    this.blockCallbacks = [];
    this.pendingCallbacks = [];
    
    logger.info('RealtimeDataStream destroyed', { component: 'RealtimeDataStream' });
  }
}

export { RealtimeDataStream, type StreamConfig, type BlockCallback, type PendingCallback };
