/**
 * FAUCET - Single-Source Signal Emitter
 * 
 * The Faucet is a stateless signal emitter that provides:
 * - Trade signals (buy/sell opportunities)
 * - Spread analysis (price differences across venues)
 * - Momentum indicators (trend strength)
 * - Imbalance detection (order book asymmetry)
 * 
 * HARD RULES:
 * - Stateless by design (no internal state)
 * - Single source of truth for signals
 * - No execution authority
 * - Pure signal enrichment only
 */

import { EventEmitter } from 'events';

export enum SignalType {
  TRADE = 'trade',
  SPREAD = 'spread',
  MOMENTUM = 'momentum',
  IMBALANCE = 'imbalance',
  VOLATILITY = 'volatility',
}

export interface Signal {
  id: string;
  type: SignalType;
  timestamp: number;
  source: string;
  chain: string;
  asset: string;
  pair?: string;
  data: {
    price?: number;
    spread?: number;
    momentum?: number;
    imbalance?: number;
    volatility?: number;
    confidence: number;
  };
  metadata: Record<string, any>;
}

export interface FaucetMetrics {
  signalsEmitted: number;
  signalsByType: Record<SignalType, number>;
  lastSignalTime: number;
  avgConfidence: number;
  uptime: number;
}

/**
 * Faucet - Single-source signal emitter
 */
export class Faucet extends EventEmitter {
  private id: string;
  private isActive: boolean = false;
  private startTime: number = 0;
  private metrics: FaucetMetrics;

  constructor(id: string = 'faucet-primary') {
    super();
    this.id = id;
    this.metrics = {
      signalsEmitted: 0,
      signalsByType: {
        [SignalType.TRADE]: 0,
        [SignalType.SPREAD]: 0,
        [SignalType.MOMENTUM]: 0,
        [SignalType.IMBALANCE]: 0,
        [SignalType.VOLATILITY]: 0,
      },
      lastSignalTime: 0,
      avgConfidence: 0,
      uptime: 0,
    };
  }

  /**
   * Start the faucet
   */
  start(): void {
    if (this.isActive) return;
    
    this.isActive = true;
    this.startTime = Date.now();
    
    console.log(`[Faucet:${this.id}] 💧 Faucet started - Signal emission active`);
    this.emit('started', { id: this.id, timestamp: this.startTime });
  }

  /**
   * Stop the faucet
   */
  stop(): void {
    if (!this.isActive) return;
    
    this.isActive = false;
    
    console.log(`[Faucet:${this.id}] 🛑 Faucet stopped`);
    this.emit('stopped', { id: this.id, timestamp: Date.now() });
  }

  /**
   * Emit a signal
   */
  emitSignal(signal: Omit<Signal, 'id' | 'timestamp' | 'source'>): Signal {
    if (!this.isActive) {
      throw new Error('Faucet not active - cannot emit signals');
    }

    const fullSignal: Signal = {
      id: this.generateSignalId(),
      timestamp: Date.now(),
      source: this.id,
      ...signal,
    };

    // Update metrics
    this.metrics.signalsEmitted++;
    this.metrics.signalsByType[signal.type]++;
    this.metrics.lastSignalTime = fullSignal.timestamp;
    
    // Update average confidence
    const totalConfidence = this.metrics.avgConfidence * (this.metrics.signalsEmitted - 1);
    this.metrics.avgConfidence = (totalConfidence + signal.data.confidence) / this.metrics.signalsEmitted;

    // Emit event
    this.emit('signal', fullSignal);
    this.emit(`signal:${signal.type}`, fullSignal);

    return fullSignal;
  }

  /**
   * Analyze trade opportunity
   */
  analyzeTrade(chain: string, asset: string, price: number, confidence: number): Signal {
    return this.emitSignal({
      type: SignalType.TRADE,
      chain,
      asset,
      data: {
        price,
        confidence,
      },
      metadata: {
        analyzed: true,
      },
    });
  }

  /**
   * Analyze spread
   */
  analyzeSpread(chain: string, pair: string, spread: number, confidence: number): Signal {
    return this.emitSignal({
      type: SignalType.SPREAD,
      chain,
      asset: pair.split('/')[0],
      pair,
      data: {
        spread,
        confidence,
      },
      metadata: {
        spreadBps: spread * 10000, // basis points
      },
    });
  }

  /**
   * Analyze momentum
   */
  analyzeMomentum(chain: string, asset: string, momentum: number, confidence: number): Signal {
    return this.emitSignal({
      type: SignalType.MOMENTUM,
      chain,
      asset,
      data: {
        momentum,
        confidence,
      },
      metadata: {
        direction: momentum > 0 ? 'bullish' : 'bearish',
        strength: Math.abs(momentum),
      },
    });
  }

  /**
   * Analyze order book imbalance
   */
  analyzeImbalance(chain: string, asset: string, imbalance: number, confidence: number): Signal {
    return this.emitSignal({
      type: SignalType.IMBALANCE,
      chain,
      asset,
      data: {
        imbalance,
        confidence,
      },
      metadata: {
        side: imbalance > 0 ? 'bid' : 'ask',
        ratio: Math.abs(imbalance),
      },
    });
  }

  /**
   * Analyze volatility
   */
  analyzeVolatility(chain: string, asset: string, volatility: number, confidence: number): Signal {
    return this.emitSignal({
      type: SignalType.VOLATILITY,
      chain,
      asset,
      data: {
        volatility,
        confidence,
      },
      metadata: {
        level: volatility > 0.5 ? 'high' : volatility > 0.2 ? 'medium' : 'low',
      },
    });
  }

  /**
   * Get faucet ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Is faucet active?
   */
  isRunning(): boolean {
    return this.isActive;
  }

  /**
   * Get metrics
   */
  getMetrics(): FaucetMetrics {
    this.metrics.uptime = this.isActive ? Date.now() - this.startTime : 0;
    return { ...this.metrics };
  }

  /**
   * Generate signal ID
   */
  private generateSignalId(): string {
    return `${this.id}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}

// Primary faucet instance
export const primaryFaucet = new Faucet('faucet-primary');
