/**
 * PR 4: Hydra Brain - Cooldown & Intensity Controller
 * Manages network intensity and enforces cooldown periods to avoid detection
 */

import { IntensityMetrics } from '../types';
import { EventLogger } from '../utils/event-logger';

export class CooldownController {
  private intensityMetrics: Map<string, IntensityMetrics> = new Map();
  private logger: EventLogger;
  
  // Configuration - tunable based on operational requirements
  private readonly maxSwapsPerMinute = parseInt(process.env.HYDRA_MAX_SWAPS_PER_MIN || '3');
  private readonly baseCooldownSeconds = 30;
  private readonly MAX_COOLDOWN_SECONDS = 600; // 10 minutes maximum
  private readonly networkWideCooldownSeconds = 120;
  private readonly networkWideDetectionThreshold = 10;

  constructor() {
    this.logger = EventLogger.getInstance();
  }

  /**
   * Check if execution can proceed (not in cooldown)
   */
  async canExecute(chain: string, urgency: number): Promise<boolean> {
    const metric = this.getOrCreateMetric(chain);
    const now = Date.now();

    // Check if in cooldown
    if (metric.cooldownUntil && now < metric.cooldownUntil.getTime()) {
      // Check for urgency override
      if (urgency >= 90) {
        console.log(`[CooldownController] ⚡ URGENCY OVERRIDE for ${chain} (urgency: ${urgency})`);
        
        await this.logger.logEvent({
          id: this.generateId(),
          type: 'urgency-override',
          crawlerId: 'system',
          chain,
          metadata: { urgency, reason: 'high-priority-asset' },
          timestamp: new Date(),
        });
        
        return true; // Bypass cooldown
      }

      const remainingSeconds = Math.ceil((metric.cooldownUntil.getTime() - now) / 1000);
      console.log(`[CooldownController] ❄️  ${chain} in cooldown for ${remainingSeconds}s more`);
      return false;
    }

    // Check intensity (swaps per minute)
    const oneMinuteAgo = now - 60000;
    if (metric.lastSwap.getTime() > oneMinuteAgo && metric.swapsPerMinute >= this.maxSwapsPerMinute) {
      // Trigger exponential cooldown
      const cooldownDuration = this.calculateCooldown(metric.swapsPerMinute);
      await this.triggerCooldown(chain, cooldownDuration);
      return false;
    }

    return true;
  }

  /**
   * Record a swap/rotation event
   */
  async recordSwap(chain: string): Promise<void> {
    const metric = this.getOrCreateMetric(chain);
    const now = new Date();
    
    // Reset counter if more than 1 minute since last swap
    const oneMinuteAgo = Date.now() - 60000;
    if (metric.lastSwap.getTime() < oneMinuteAgo) {
      metric.swapsPerMinute = 0;
    }

    metric.swapsPerMinute++;
    metric.lastSwap = now;
    this.intensityMetrics.set(chain, metric);

    // Check if we've exceeded limit
    if (metric.swapsPerMinute >= this.maxSwapsPerMinute) {
      const cooldownDuration = this.calculateCooldown(metric.swapsPerMinute);
      await this.triggerCooldown(chain, cooldownDuration);
    }
  }

  /**
   * Trigger cooldown for a specific chain
   */
  private async triggerCooldown(chain: string, durationSeconds: number): Promise<void> {
    const metric = this.getOrCreateMetric(chain);
    metric.cooldownUntil = new Date(Date.now() + durationSeconds * 1000);
    metric.cooldownDuration = durationSeconds;
    this.intensityMetrics.set(chain, metric);

    console.log(`[CooldownController] ❄️  Cooldown triggered for ${chain}: ${durationSeconds}s`);

    await this.logger.logEvent({
      id: this.generateId(),
      type: 'cooldown-triggered',
      crawlerId: 'system',
      chain,
      metadata: { 
        duration: durationSeconds,
        reason: 'intensity-limit',
        swapsPerMinute: metric.swapsPerMinute,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Calculate exponential cooldown based on swap count
   * Starts at 30s and doubles each time, capped at 10 minutes
   */
  private calculateCooldown(swapCount: number): number {
    // Exponential backoff: 30s, 60s, 120s, 240s, etc.
    const multiplier = Math.pow(2, swapCount - this.maxSwapsPerMinute);
    return Math.min(this.baseCooldownSeconds * multiplier, this.MAX_COOLDOWN_SECONDS);
  }

  /**
   * Trigger network-wide "Chill Mode"
   */
  async triggerChillMode(reason: string = 'detection-spike'): Promise<void> {
    console.log(`[CooldownController] 🌊 CHILL MODE activated: ${reason}`);

    // Apply cooldown to all chains
    const chains = ['ethereum', 'polygon', 'bsc', 'avalanche', 'arbitrum'];
    for (const chain of chains) {
      const metric = this.getOrCreateMetric(chain);
      metric.cooldownUntil = new Date(Date.now() + this.networkWideCooldownSeconds * 1000);
      metric.cooldownDuration = this.networkWideCooldownSeconds;
      this.intensityMetrics.set(chain, metric);
    }

    await this.logger.logEvent({
      id: this.generateId(),
      type: 'cooldown-triggered',
      crawlerId: 'system',
      metadata: { 
        duration: this.networkWideCooldownSeconds,
        reason,
        networkWide: true,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Check if network-wide chill mode should trigger
   */
  async checkNetworkDetections(): Promise<void> {
    const recentDetections = this.logger.getRecentDetections(50);
    const lastMinute = Date.now() - 60000;
    
    const recentCount = recentDetections.filter(d => 
      d.timestamp.getTime() > lastMinute
    ).length;

    if (recentCount >= this.networkWideDetectionThreshold) {
      await this.triggerChillMode('network-detection-spike');
    }
  }

  /**
   * Get or create intensity metric for a chain
   */
  private getOrCreateMetric(chain: string): IntensityMetrics {
    let metric = this.intensityMetrics.get(chain);
    if (!metric) {
      metric = {
        chain,
        swapsPerMinute: 0,
        lastSwap: new Date(0),
        cooldownDuration: 0,
      };
      this.intensityMetrics.set(chain, metric);
    }
    return metric;
  }

  /**
   * Get intensity metrics for all chains
   */
  getIntensityMetrics(): IntensityMetrics[] {
    return Array.from(this.intensityMetrics.values());
  }

  /**
   * Get cooldown status for a chain
   */
  getCooldownStatus(chain: string): {
    inCooldown: boolean;
    remainingSeconds: number;
    swapsPerMinute: number;
  } {
    const metric = this.getOrCreateMetric(chain);
    const now = Date.now();
    
    const inCooldown = metric.cooldownUntil ? now < metric.cooldownUntil.getTime() : false;
    const remainingSeconds = inCooldown
      ? Math.ceil((metric.cooldownUntil!.getTime() - now) / 1000)
      : 0;

    return {
      inCooldown,
      remainingSeconds,
      swapsPerMinute: metric.swapsPerMinute,
    };
  }

  /**
   * Get network-wide cooldown status
   */
  getNetworkCooldownStatus(): {
    chains: Record<string, ReturnType<typeof this.getCooldownStatus>>;
    anyInCooldown: boolean;
    allInCooldown: boolean;
  } {
    const chains = ['ethereum', 'polygon', 'bsc', 'avalanche', 'arbitrum'];
    const status: Record<string, ReturnType<typeof this.getCooldownStatus>> = {};
    
    let anyInCooldown = false;
    let allInCooldown = true;

    for (const chain of chains) {
      status[chain] = this.getCooldownStatus(chain);
      if (status[chain].inCooldown) {
        anyInCooldown = true;
      } else {
        allInCooldown = false;
      }
    }

    return {
      chains: status,
      anyInCooldown,
      allInCooldown,
    };
  }

  /**
   * Manually override cooldown for a chain
   */
  async overrideCooldown(chain: string, reason: string): Promise<void> {
    const metric = this.getOrCreateMetric(chain);
    metric.cooldownUntil = undefined;
    metric.swapsPerMinute = 0;
    this.intensityMetrics.set(chain, metric);

    console.log(`[CooldownController] ⚡ Cooldown overridden for ${chain}: ${reason}`);

    await this.logger.logEvent({
      id: this.generateId(),
      type: 'urgency-override',
      crawlerId: 'system',
      chain,
      metadata: { reason: `manual-override: ${reason}` },
      timestamp: new Date(),
    });
  }

  /**
   * Reset all cooldowns
   */
  resetAllCooldowns(): void {
    this.intensityMetrics.clear();
    console.log('[CooldownController] ✅ All cooldowns reset');
  }

  private generateId(): string {
    return `cool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
