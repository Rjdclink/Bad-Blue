// Light Communication System - Instant coordination with minimal bandwidth
// Crawlers communicate across networks using minimal "light" channels

import logger from '../../../logger.js';
import type { ChainId } from '../core/lux-swarm';

export interface LightSignal {
  id: string;
  source: string; // Agent ID
  type: 'alert' | 'discovery' | 'coordination' | 'emergency' | 'heartbeat';
  priority: 'low' | 'medium' | 'high' | 'critical';
  data: number; // Compressed single number containing all info
  timestamp: number;
  ttl: number; // Time to live in ms
}

export interface LightChannel {
  id: string;
  frequency: number; // Channel frequency (0-1000)
  bandwidth: number; // Max signals per second
  activeSignals: LightSignal[];
  subscribers: Set<string>; // Agent IDs subscribed to this channel
  totalSignals: number;
  lastActivity: number;
}

export interface SignalCompression {
  alert: number; // 0-15 (4 bits)
  chain: number; // 0-7 (3 bits)
  priority: number; // 0-3 (2 bits)
  value: number; // 0-1023 (10 bits)
  status: number; // 0-3 (2 bits)
}

/**
 * Light Communication System - Ultra-low bandwidth instant messaging
 */
export class LightCommunicationSystem {
  private static channels = new Map<string, LightChannel>();
  private static signalHistory: LightSignal[] = [];
  private static maxHistorySize = 10000;
  private static isActive = false;
  private static cleanupInterval: NodeJS.Timeout | null = null;

  // Predefined frequencies for different purposes
  private static readonly FREQUENCIES = {
    ALERT: 100,
    DISCOVERY: 200,
    COORDINATION: 300,
    EMERGENCY: 999,
    HEARTBEAT: 50
  };

  /**
   * Initialize light communication system
   */
  static initialize(): void {
    if (this.isActive) {
      logger.warn('Light communication already active', { component: 'LightCommunicationSystem' });
      return;
    }

    // Create predefined channels
    for (const [type, frequency] of Object.entries(this.FREQUENCIES)) {
      this.createChannel(frequency, type.toLowerCase());
    }

    // Start cleanup routine
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSignals();
    }, 1000);

    this.isActive = true;

    logger.info('Light communication system initialized', {
      component: 'LightCommunicationSystem',
      channels: this.channels.size
    });
  }

  /**
   * Create a communication channel
   */
  static createChannel(frequency: number, id?: string): LightChannel {
    const channelId = id || `channel-${frequency}`;

    if (this.channels.has(channelId)) {
      return this.channels.get(channelId)!;
    }

    const channel: LightChannel = {
      id: channelId,
      frequency,
      bandwidth: 1000, // 1000 signals per second
      activeSignals: [],
      subscribers: new Set(),
      totalSignals: 0,
      lastActivity: Date.now()
    };

    this.channels.set(channelId, channel);

    logger.debug('Light channel created', {
      component: 'LightCommunicationSystem',
      channelId,
      frequency
    });

    return channel;
  }

  /**
   * Compress data into a single number (ultra-efficient)
   */
  static compress(data: SignalCompression): number {
    // Pack all data into a single 21-bit number
    let compressed = 0;
    
    compressed |= (data.alert & 0x0F) << 17;      // 4 bits for alert type
    compressed |= (data.chain & 0x07) << 14;      // 3 bits for chain
    compressed |= (data.priority & 0x03) << 12;   // 2 bits for priority
    compressed |= (data.value & 0x3FF) << 2;      // 10 bits for value
    compressed |= (data.status & 0x03);           // 2 bits for status

    return compressed;
  }

  /**
   * Decompress a light signal number
   */
  static decompress(compressed: number): SignalCompression {
    return {
      alert: (compressed >> 17) & 0x0F,
      chain: (compressed >> 14) & 0x07,
      priority: (compressed >> 12) & 0x03,
      value: (compressed >> 2) & 0x3FF,
      status: compressed & 0x03
    };
  }

  /**
   * Emit a light signal
   */
  static emit(
    source: string,
    type: LightSignal['type'],
    priority: LightSignal['priority'],
    data: SignalCompression,
    ttl: number = 5000
  ): LightSignal {
    const frequency = this.FREQUENCIES[type.toUpperCase() as keyof typeof this.FREQUENCIES] || 500;
    const channelId = this.getChannelByFrequency(frequency)?.id;

    if (!channelId) {
      throw new Error(`No channel found for frequency ${frequency}`);
    }

    const channel = this.channels.get(channelId)!;

    // Check bandwidth
    const recentSignals = channel.activeSignals.filter(
      s => Date.now() - s.timestamp < 1000
    );

    if (recentSignals.length >= channel.bandwidth) {
      logger.warn('Channel bandwidth exceeded', {
        component: 'LightCommunicationSystem',
        channelId,
        current: recentSignals.length,
        max: channel.bandwidth
      });
      // Signals are dropped when bandwidth is exceeded (lightweight behavior)
      throw new Error('Channel bandwidth exceeded');
    }

    const signal: LightSignal = {
      id: `signal-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      source,
      type,
      priority,
      data: this.compress(data),
      timestamp: Date.now(),
      ttl
    };

    channel.activeSignals.push(signal);
    channel.totalSignals++;
    channel.lastActivity = Date.now();

    // Add to history
    this.signalHistory.push(signal);
    if (this.signalHistory.length > this.maxHistorySize) {
      this.signalHistory.shift();
    }

    // Notify subscribers (instant transmission)
    this.notifySubscribers(channel, signal);

    logger.debug('Light signal emitted', {
      component: 'LightCommunicationSystem',
      signalId: signal.id,
      type,
      priority,
      channel: channelId
    });

    return signal;
  }

  /**
   * Subscribe to a channel
   */
  static subscribe(agentId: string, frequency: number): boolean {
    const channel = this.getChannelByFrequency(frequency);
    
    if (!channel) {
      logger.warn('Channel not found', {
        component: 'LightCommunicationSystem',
        agentId,
        frequency
      });
      return false;
    }

    channel.subscribers.add(agentId);

    logger.debug('Agent subscribed to channel', {
      component: 'LightCommunicationSystem',
      agentId,
      channelId: channel.id,
      subscribers: channel.subscribers.size
    });

    return true;
  }

  /**
   * Unsubscribe from a channel
   */
  static unsubscribe(agentId: string, frequency: number): boolean {
    const channel = this.getChannelByFrequency(frequency);
    
    if (!channel) return false;

    channel.subscribers.delete(agentId);

    logger.debug('Agent unsubscribed from channel', {
      component: 'LightCommunicationSystem',
      agentId,
      channelId: channel.id
    });

    return true;
  }

  /**
   * Receive signals from subscribed channels
   */
  static receive(agentId: string, since?: number): LightSignal[] {
    const receivedSignals: LightSignal[] = [];
    const cutoff = since || Date.now() - 5000; // Last 5 seconds by default

    for (const channel of this.channels.values()) {
      if (!channel.subscribers.has(agentId)) continue;

      const signals = channel.activeSignals.filter(
        s => s.timestamp >= cutoff && s.source !== agentId // Don't receive own signals
      );

      receivedSignals.push(...signals);
    }

    return receivedSignals.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get channel by frequency
   */
  private static getChannelByFrequency(frequency: number): LightChannel | undefined {
    for (const channel of this.channels.values()) {
      if (channel.frequency === frequency) {
        return channel;
      }
    }
    return undefined;
  }

  /**
   * Notify subscribers of new signal
   */
  private static notifySubscribers(channel: LightChannel, signal: LightSignal): void {
    // In a real implementation, this would trigger callbacks or events
    // For now, signals are available via receive() method
    logger.debug('Signal broadcast to subscribers', {
      component: 'LightCommunicationSystem',
      signalId: signal.id,
      subscribers: channel.subscribers.size
    });
  }

  /**
   * Cleanup expired signals
   */
  private static cleanupExpiredSignals(): void {
    const now = Date.now();
    let totalRemoved = 0;

    for (const channel of this.channels.values()) {
      const initialCount = channel.activeSignals.length;
      
      channel.activeSignals = channel.activeSignals.filter(
        s => now - s.timestamp < s.ttl
      );

      totalRemoved += initialCount - channel.activeSignals.length;
    }

    if (totalRemoved > 0) {
      logger.debug('Expired signals cleaned up', {
        component: 'LightCommunicationSystem',
        removed: totalRemoved
      });
    }
  }

  /**
   * Get channel statistics
   */
  static getChannelStats(channelId: string): {
    id: string;
    frequency: number;
    activeSignals: number;
    subscribers: number;
    totalSignals: number;
    bandwidth: number;
    utilizationRate: number;
  } | undefined {
    const channel = this.channels.get(channelId);
    if (!channel) return undefined;

    const recentSignals = channel.activeSignals.filter(
      s => Date.now() - s.timestamp < 1000
    );

    return {
      id: channel.id,
      frequency: channel.frequency,
      activeSignals: channel.activeSignals.length,
      subscribers: channel.subscribers.size,
      totalSignals: channel.totalSignals,
      bandwidth: channel.bandwidth,
      utilizationRate: recentSignals.length / channel.bandwidth
    };
  }

  /**
   * Get all channels
   */
  static getAllChannels(): LightChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Broadcast emergency signal (highest priority, all channels)
   */
  static broadcastEmergency(source: string, data: SignalCompression): void {
    let successCount = 0;
    const frequency = this.FREQUENCIES.EMERGENCY;
    
    // Broadcast to the emergency channel directly
    try {
      this.emit(source, 'emergency', 'critical', data, 10000);
      successCount++;
    } catch (error) {
      logger.error('Emergency broadcast failed', {
        component: 'LightCommunicationSystem',
        error: error instanceof Error ? error.message : String(error)
      });
    }

    logger.warn('Emergency signal broadcast', {
      component: 'LightCommunicationSystem',
      source,
      frequency,
      success: successCount > 0
    });
  }

  /**
   * Shutdown system
   */
  static shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.isActive = false;
    logger.info('Light communication system shutdown', { component: 'LightCommunicationSystem' });
  }

  /**
   * Reset (for testing)
   */
  static reset(): void {
    this.shutdown();
    this.channels.clear();
    this.signalHistory = [];
    logger.info('Light communication system reset', { component: 'LightCommunicationSystem' });
  }
}

/**
 * Shrink-and-Grow Adaptability - Dynamic resource optimization
 */
export interface CrawlerSize {
  scale: 'nano' | 'micro' | 'normal' | 'macro' | 'mega';
  resourceMultiplier: number;
  capacity: number;
  priority: number;
}

export class ShrinkGrowEngine {
  private static crawlerSizes = new Map<string, CrawlerSize>();
  private static isActive = false;
  private static adjustmentInterval: NodeJS.Timeout | null = null;

  // Size configurations
  private static readonly SIZES: Record<CrawlerSize['scale'], Omit<CrawlerSize, 'scale'>> = {
    nano: { resourceMultiplier: 0.1, capacity: 10, priority: 10 },
    micro: { resourceMultiplier: 0.25, capacity: 50, priority: 25 },
    normal: { resourceMultiplier: 1, capacity: 100, priority: 50 },
    macro: { resourceMultiplier: 2.5, capacity: 500, priority: 75 },
    mega: { resourceMultiplier: 10, capacity: 2000, priority: 95 }
  };

  /**
   * Start adaptive sizing
   */
  static start(): void {
    if (this.isActive) {
      logger.warn('Shrink-grow engine already active', { component: 'ShrinkGrowEngine' });
      return;
    }

    this.isActive = true;
    this.adjustmentInterval = setInterval(() => {
      this.adjustSizes();
    }, 5000); // Adjust every 5 seconds

    logger.info('Shrink-grow engine started', { component: 'ShrinkGrowEngine' });
  }

  /**
   * Register a crawler
   */
  static register(crawlerId: string, initialScale: CrawlerSize['scale'] = 'normal'): void {
    const size: CrawlerSize = {
      scale: initialScale,
      ...this.SIZES[initialScale]
    };

    this.crawlerSizes.set(crawlerId, size);

    logger.debug('Crawler registered for adaptive sizing', {
      component: 'ShrinkGrowEngine',
      crawlerId,
      scale: initialScale
    });
  }

  /**
   * Shrink a crawler (reduce resources during low activity)
   */
  static shrink(crawlerId: string): boolean {
    const size = this.crawlerSizes.get(crawlerId);
    if (!size) return false;

    const scales: CrawlerSize['scale'][] = ['mega', 'macro', 'normal', 'micro', 'nano'];
    const currentIndex = scales.indexOf(size.scale);

    if (currentIndex < scales.length - 1) {
      const newScale = scales[currentIndex + 1];
      const newSize: CrawlerSize = {
        scale: newScale,
        ...this.SIZES[newScale]
      };

      this.crawlerSizes.set(crawlerId, newSize);

      logger.info('Crawler shrunk', {
        component: 'ShrinkGrowEngine',
        crawlerId,
        from: size.scale,
        to: newScale,
        resourceSaved: (size.resourceMultiplier - newSize.resourceMultiplier) * 100 + '%'
      });

      return true;
    }

    return false; // Already at minimum size
  }

  /**
   * Grow a crawler (increase resources for high activity)
   */
  static grow(crawlerId: string): boolean {
    const size = this.crawlerSizes.get(crawlerId);
    if (!size) return false;

    const scales: CrawlerSize['scale'][] = ['nano', 'micro', 'normal', 'macro', 'mega'];
    const currentIndex = scales.indexOf(size.scale);

    if (currentIndex < scales.length - 1) {
      const newScale = scales[currentIndex + 1];
      const newSize: CrawlerSize = {
        scale: newScale,
        ...this.SIZES[newScale]
      };

      this.crawlerSizes.set(crawlerId, newSize);

      logger.info('Crawler grown', {
        component: 'ShrinkGrowEngine',
        crawlerId,
        from: size.scale,
        to: newScale,
        capacityIncrease: newSize.capacity - size.capacity
      });

      return true;
    }

    return false; // Already at maximum size
  }

  /**
   * Auto-adjust sizes based on activity
   */
  private static adjustSizes(): void {
    // Placeholder - would integrate with actual activity metrics
    // Crawlers with high task load would grow
    // Crawlers with low activity would shrink

    for (const [crawlerId, size] of this.crawlerSizes.entries()) {
      // Simulate activity check
      const activity = Math.random(); // 0-1

      if (activity > 0.8 && size.scale !== 'mega') {
        this.grow(crawlerId);
      } else if (activity < 0.2 && size.scale !== 'nano') {
        this.shrink(crawlerId);
      }
    }
  }

  /**
   * Get crawler size
   */
  static getSize(crawlerId: string): CrawlerSize | undefined {
    return this.crawlerSizes.get(crawlerId);
  }

  /**
   * Get total resource usage
   */
  static getTotalResourceUsage(): number {
    let total = 0;
    for (const size of this.crawlerSizes.values()) {
      total += size.resourceMultiplier;
    }
    return total;
  }

  /**
   * Get statistics
   */
  static getStatistics(): Record<CrawlerSize['scale'], number> {
    const stats: Record<CrawlerSize['scale'], number> = {
      nano: 0,
      micro: 0,
      normal: 0,
      macro: 0,
      mega: 0
    };

    for (const size of this.crawlerSizes.values()) {
      stats[size.scale]++;
    }

    return stats;
  }

  /**
   * Stop engine
   */
  static stop(): void {
    if (this.adjustmentInterval) {
      clearInterval(this.adjustmentInterval);
      this.adjustmentInterval = null;
    }
    this.isActive = false;
    logger.info('Shrink-grow engine stopped', { component: 'ShrinkGrowEngine' });
  }

  /**
   * Reset (for testing)
   */
  static reset(): void {
    this.stop();
    this.crawlerSizes.clear();
    logger.info('Shrink-grow engine reset', { component: 'ShrinkGrowEngine' });
  }
}
