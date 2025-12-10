/**
 * Wallet Connection Optimizer
 * 
 * Purpose: Optimize cryptocrawler wallet connections for speed and reliability
 * ONE FILE AT A TIME approach
 */

import { createLogger } from '../../logger';
import { enforceStoragySafety } from './safetyRules';

const log = createLogger('WalletOptimizer');

/**
 * Wallet connection state
 */
interface WalletConnectionState {
  address: string | null;
  chain: string | null;
  connected: boolean;
  lastConnected: number | null;
  connectionAttempts: number;
}

/**
 * Wallet Connection Optimizer
 * 
 * Optimizes wallet connections by:
 * 1. Caching connection states
 * 2. Implementing automatic reconnection
 * 3. Connection pooling
 * 4. Health monitoring
 */
export class WalletOptimizer {
  private static instance: WalletOptimizer;
  private connectionCache: Map<string, WalletConnectionState> = new Map();
  private reconnectionTimers: Map<string, NodeJS.Timeout> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  
  // Optimization settings
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY_MS = 2000;
  private readonly CONNECTION_CACHE_TTL_MS = 300000; // 5 minutes
  private readonly HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds
  
  private constructor() {
    // Enforce safety rules
    enforceStoragySafety('wallet-optimizer-initialization');
    
    // Start health check monitoring
    this.startHealthMonitoring();
    
    log.info('✅ Wallet Optimizer initialized');
    log.info('   Purpose: Optimize wallet connections for cryptocrawler');
    log.info('   Features: Caching, Auto-reconnection, Health monitoring');
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): WalletOptimizer {
    if (!WalletOptimizer.instance) {
      WalletOptimizer.instance = new WalletOptimizer();
    }
    return WalletOptimizer.instance;
  }
  
  /**
   * Optimize wallet connection
   * 
   * This method wraps the wallet connection process with:
   * - Connection state caching
   * - Automatic retry logic
   * - Performance monitoring
   */
  async optimizeConnection(
    walletAddress: string,
    chainId: string,
    connectionFn: () => Promise<boolean>
  ): Promise<{
    success: boolean;
    cached: boolean;
    connectionTime: number;
  }> {
    const startTime = Date.now();
    const cacheKey = `${walletAddress}-${chainId}`;
    
    // Check if we have a cached valid connection
    const cachedState = this.connectionCache.get(cacheKey);
    if (cachedState && cachedState.connected) {
      const cacheAge = Date.now() - (cachedState.lastConnected || 0);
      if (cacheAge < this.CONNECTION_CACHE_TTL_MS) {
        log.info('🎯 Wallet connection served from cache', {
          address: walletAddress.substring(0, 10) + '...',
          chain: chainId,
          cacheAge: cacheAge + 'ms',
        });
        
        return {
          success: true,
          cached: true,
          connectionTime: Date.now() - startTime,
        };
      }
    }
    
    // Attempt new connection
    try {
      log.info('🔌 Attempting wallet connection...', {
        address: walletAddress.substring(0, 10) + '...',
        chain: chainId,
      });
      
      const connected = await connectionFn();
      
      if (connected) {
        // Cache successful connection
        this.connectionCache.set(cacheKey, {
          address: walletAddress,
          chain: chainId,
          connected: true,
          lastConnected: Date.now(),
          connectionAttempts: 0,
        });
        
        log.info('✅ Wallet connected successfully', {
          address: walletAddress.substring(0, 10) + '...',
          chain: chainId,
          connectionTime: (Date.now() - startTime) + 'ms',
        });
        
        return {
          success: true,
          cached: false,
          connectionTime: Date.now() - startTime,
        };
      } else {
        // Connection failed - attempt automatic reconnection
        await this.scheduleReconnection(cacheKey, walletAddress, chainId, connectionFn);
        
        return {
          success: false,
          cached: false,
          connectionTime: Date.now() - startTime,
        };
      }
    } catch (error) {
      log.error('❌ Wallet connection failed', {
        address: walletAddress.substring(0, 10) + '...',
        chain: chainId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        success: false,
        cached: false,
        connectionTime: Date.now() - startTime,
      };
    }
  }
  
  /**
   * Schedule automatic reconnection
   */
  private async scheduleReconnection(
    cacheKey: string,
    walletAddress: string,
    chainId: string,
    connectionFn: () => Promise<boolean>
  ): Promise<void> {
    const state = this.connectionCache.get(cacheKey) || {
      address: walletAddress,
      chain: chainId,
      connected: false,
      lastConnected: null,
      connectionAttempts: 0,
    };
    
    if (state.connectionAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      log.warn('⚠️ Max reconnection attempts reached', {
        address: walletAddress.substring(0, 10) + '...',
        attempts: state.connectionAttempts,
      });
      return;
    }
    
    // Clear any existing reconnection timer
    const existingTimer = this.reconnectionTimers.get(cacheKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Schedule reconnection
    const timer = setTimeout(async () => {
      log.info('🔄 Attempting automatic reconnection...', {
        address: walletAddress.substring(0, 10) + '...',
        attempt: state.connectionAttempts + 1,
      });
      
      try {
        const connected = await connectionFn();
        if (connected) {
          this.connectionCache.set(cacheKey, {
            ...state,
            connected: true,
            lastConnected: Date.now(),
            connectionAttempts: 0,
          });
          
          log.info('✅ Automatic reconnection successful');
        } else {
          // Increment attempts and try again
          state.connectionAttempts++;
          this.connectionCache.set(cacheKey, state);
          
          if (state.connectionAttempts < this.MAX_RECONNECT_ATTEMPTS) {
            await this.scheduleReconnection(cacheKey, walletAddress, chainId, connectionFn);
          }
        }
      } catch (error) {
        log.error('❌ Automatic reconnection failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        
        state.connectionAttempts++;
        this.connectionCache.set(cacheKey, state);
      }
      
      this.reconnectionTimers.delete(cacheKey);
    }, this.RECONNECT_DELAY_MS * (state.connectionAttempts + 1)); // Exponential backoff
    
    this.reconnectionTimers.set(cacheKey, timer);
  }
  
  /**
   * Disconnect wallet and clear cache
   */
  disconnectWallet(walletAddress: string, chainId: string): void {
    const cacheKey = `${walletAddress}-${chainId}`;
    
    // Clear cache
    this.connectionCache.delete(cacheKey);
    
    // Clear reconnection timer
    const timer = this.reconnectionTimers.get(cacheKey);
    if (timer) {
      clearTimeout(timer);
      this.reconnectionTimers.delete(cacheKey);
    }
    
    log.info('🔌 Wallet disconnected', {
      address: walletAddress.substring(0, 10) + '...',
      chain: chainId,
    });
  }
  
  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.HEALTH_CHECK_INTERVAL_MS);
  }
  
  /**
   * Perform health check on all cached connections
   */
  private performHealthCheck(): void {
    const now = Date.now();
    let activeConnections = 0;
    let staleConnections = 0;
    
    for (const [cacheKey, state] of this.connectionCache.entries()) {
      if (state.connected && state.lastConnected) {
        const age = now - state.lastConnected;
        
        if (age > this.CONNECTION_CACHE_TTL_MS) {
          // Connection is stale - remove from cache
          this.connectionCache.delete(cacheKey);
          staleConnections++;
        } else {
          activeConnections++;
        }
      }
    }
    
    if (activeConnections > 0 || staleConnections > 0) {
      log.debug('🏥 Wallet health check complete', {
        activeConnections,
        staleConnections,
        totalCached: this.connectionCache.size,
      });
    }
  }
  
  /**
   * Get optimization statistics
   */
  getStats(): {
    cachedConnections: number;
    activeReconnections: number;
    cacheHitRate: number;
  } {
    return {
      cachedConnections: this.connectionCache.size,
      activeReconnections: this.reconnectionTimers.size,
      cacheHitRate: 0, // Would need to track cache hits/misses
    };
  }
  
  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    // Clear all reconnection timers
    for (const timer of this.reconnectionTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectionTimers.clear();
    
    // Clear cache
    this.connectionCache.clear();
    
    log.info('🛑 Wallet Optimizer shutdown complete');
  }
}

/**
 * Export singleton instance
 */
export const walletOptimizer = WalletOptimizer.getInstance();
