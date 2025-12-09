/**
 * Event Logger - Comprehensive lifecycle and detection event logging
 * Singleton pattern for centralized logging
 */

import { LifecycleEvent, DetectionEvent, WebhookConfig } from '../types';
import { randomBytes } from 'crypto';

export class EventLogger {
  private static instance: EventLogger;
  private events: LifecycleEvent[] = [];
  private detectionEvents: DetectionEvent[] = [];
  private webhooks: WebhookConfig[] = [];
  
  // Configuration - tunable based on memory constraints
  private readonly maxEvents = parseInt(process.env.HYDRA_MAX_EVENTS || '10000');

  private constructor() {}

  static getInstance(): EventLogger {
    if (!EventLogger.instance) {
      EventLogger.instance = new EventLogger();
    }
    return EventLogger.instance;
  }

  /**
   * Log a lifecycle event
   */
  async logEvent(event: LifecycleEvent): Promise<void> {
    this.events.push(event);

    // Trim old events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Send to webhooks if applicable
    await this.sendToWebhooks(event);

    // Console log for debugging
    this.logToConsole(event);
  }

  /**
   * Log a detection event
   */
  async logDetection(event: DetectionEvent): Promise<void> {
    this.detectionEvents.push(event);

    // Trim old detection events
    if (this.detectionEvents.length > this.maxEvents) {
      this.detectionEvents = this.detectionEvents.slice(-this.maxEvents);
    }

    // Create lifecycle event for detection
    await this.logEvent({
      id: this.generateId(),
      type: 'detection-event',
      crawlerId: event.crawlerId,
      chain: event.chain,
      subnet: event.subnet,
      metadata: {
        detectionType: event.type,
        severity: event.severity,
      },
      timestamp: event.timestamp,
    });
  }

  /**
   * Get events by type
   */
  getEventsByType(type: LifecycleEvent['type']): LifecycleEvent[] {
    return this.events.filter(e => e.type === type);
  }

  /**
   * Get events by crawler
   */
  getEventsByCrawler(crawlerId: string): LifecycleEvent[] {
    return this.events.filter(e => e.crawlerId === crawlerId);
  }

  /**
   * Get events by chain
   */
  getEventsByChain(chain: string): LifecycleEvent[] {
    return this.events.filter(e => e.chain === chain);
  }

  /**
   * Get recent events
   */
  getRecentEvents(count: number = 100): LifecycleEvent[] {
    return this.events.slice(-count);
  }

  /**
   * Get events in time range
   */
  getEventsByTimeRange(startTime: Date, endTime: Date): LifecycleEvent[] {
    return this.events.filter(e => 
      e.timestamp >= startTime && e.timestamp <= endTime
    );
  }

  /**
   * Get detection events by crawler
   */
  getDetectionsByCrawler(crawlerId: string): DetectionEvent[] {
    return this.detectionEvents.filter(e => e.crawlerId === crawlerId);
  }

  /**
   * Get recent detection events
   */
  getRecentDetections(count: number = 100): DetectionEvent[] {
    return this.detectionEvents.slice(-count);
  }

  /**
   * Check if crawler should be flagged (multiple detections in short window)
   */
  shouldFlagCrawler(crawlerId: string, windowMs: number = 60000, threshold: number = 3): boolean {
    const now = Date.now();
    const recentDetections = this.detectionEvents.filter(e =>
      e.crawlerId === crawlerId &&
      now - e.timestamp.getTime() < windowMs
    );

    return recentDetections.length >= threshold;
  }

  /**
   * Register webhook
   */
  registerWebhook(config: Omit<WebhookConfig, 'id'>): WebhookConfig {
    const webhook: WebhookConfig = {
      id: this.generateId(),
      ...config,
    };
    this.webhooks.push(webhook);
    console.log(`[EventLogger] Registered webhook: ${webhook.endpoint}`);
    return webhook;
  }

  /**
   * Unregister webhook
   */
  unregisterWebhook(webhookId: string): boolean {
    const index = this.webhooks.findIndex(w => w.id === webhookId);
    if (index === -1) return false;

    this.webhooks.splice(index, 1);
    console.log(`[EventLogger] Unregistered webhook: ${webhookId}`);
    return true;
  }

  /**
   * Get all webhooks
   */
  getWebhooks(): WebhookConfig[] {
    return [...this.webhooks];
  }

  /**
   * Send event to configured webhooks
   */
  private async sendToWebhooks(event: LifecycleEvent): Promise<void> {
    const relevantWebhooks = this.webhooks.filter(w => 
      w.enabled && w.eventTypes.includes(event.type)
    );

    for (const webhook of relevantWebhooks) {
      try {
        const response = await fetch(webhook.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: event.type,
            crawlerId: event.crawlerId,
            chain: event.chain,
            subnet: event.subnet,
            metadata: event.metadata,
            timestamp: event.timestamp.toISOString(),
          }),
        });

        if (response.ok) {
          webhook.lastSuccess = new Date();
        } else {
          webhook.lastFailure = new Date();
          console.error(`[EventLogger] Webhook ${webhook.id} failed: ${response.status}`);
        }
      } catch (error) {
        webhook.lastFailure = new Date();
        console.error(`[EventLogger] Webhook ${webhook.id} error:`, error);
      }
    }
  }

  /**
   * Log event to console with color coding
   */
  private logToConsole(event: LifecycleEvent): void {
    const colors: Record<LifecycleEvent['type'], string> = {
      'shadow-created': '🌱',
      'shadow-promoted': '⬆️',
      'shadow-swapped': '🔄',
      'shadow-obsolete': '💀',
      'snake-spawned': '🐍',
      'detection-event': '🚨',
      'failover': '🔁',
      'cooldown-triggered': '❄️',
      'urgency-override': '⚡',
    };

    const icon = colors[event.type] || '📝';
    console.log(
      `${icon} [${event.type}] Crawler ${event.crawlerId.substring(0, 12)}... ` +
      `Chain: ${event.chain || 'N/A'} | ${new Date(event.timestamp).toISOString()}`
    );
  }

  /**
   * Export events to JSON
   */
  exportEvents(filterType?: LifecycleEvent['type']): string {
    const eventsToExport = filterType
      ? this.events.filter(e => e.type === filterType)
      : this.events;

    return JSON.stringify(eventsToExport, null, 2);
  }

  /**
   * Export detection events to JSON
   */
  exportDetections(): string {
    return JSON.stringify(this.detectionEvents, null, 2);
  }

  /**
   * Clear all events
   */
  clearEvents(): void {
    this.events = [];
    this.detectionEvents = [];
    console.log('[EventLogger] Cleared all events');
  }

  /**
   * Get event statistics
   */
  getStatistics(): {
    totalEvents: number;
    totalDetections: number;
    eventsByType: Record<string, number>;
    detectionsByType: Record<string, number>;
  } {
    const eventsByType: Record<string, number> = {};
    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
    }

    const detectionsByType: Record<string, number> = {};
    for (const detection of this.detectionEvents) {
      detectionsByType[detection.type] = (detectionsByType[detection.type] || 0) + 1;
    }

    return {
      totalEvents: this.events.length,
      totalDetections: this.detectionEvents.length,
      eventsByType,
      detectionsByType,
    };
  }

  private generateId(): string {
    return `evt_${Date.now()}_${randomBytes(4).toString('hex')}`;
  }
}
