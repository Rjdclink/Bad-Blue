/**
 * Correlation Engine
 * Event-driven correlation engine with SpiderFoot plugin architecture
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import type { IntelligenceEvent, EventHandler, LegalIntelligenceModule, ModuleTask } from './types';
import { correlationDatabase } from './correlationDB';
import { AsyncMutex, generateEventId } from './utils';

const logger = createLogger('CorrelationEngine');

/**
 * Event Bus for inter-module communication
 * SpiderFoot's event registration pattern
 */
export class IntelligenceEventBus extends EventEmitter {
  private subscribers: Map<string, Set<EventHandler>> = new Map();
  private eventLog: IntelligenceEvent[] = [];
  private maxLogSize = 1000;

  /**
   * Subscribe to event type
   */
  subscribe(eventType: string, handler: EventHandler): void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType)!.add(handler);
    logger.debug(`Handler subscribed to event type: ${eventType}`);
  }

  /**
   * Unsubscribe from event type
   */
  unsubscribe(eventType: string, handler: EventHandler): void {
    const handlers = this.subscribers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscribers.delete(eventType);
      }
    }
  }

  /**
   * Publish event to all subscribers
   * SpiderFoot's event publishing pattern with parallel execution
   */
  async publish(event: IntelligenceEvent): Promise<void> {
    const handlers = this.subscribers.get(event.type) || new Set();
    
    if (handlers.size === 0) {
      logger.debug(`No handlers for event type: ${event.type}`);
      return;
    }

    // Log event
    this.logEvent(event);

    // Parallel execution (SpiderFoot thread pool pattern)
    const promises = Array.from(handlers).map(handler => 
      handler(event).catch(error => {
        logger.error(`Handler error for event ${event.id}:`, error);
      })
    );
    
    await Promise.allSettled(promises);
    event.processed = true;
  }

  /**
   * Log event to database
   */
  private logEvent(event: IntelligenceEvent): void {
    this.eventLog.push(event);
    
    // Trim log if too large
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }

    // Persist to database
    try {
      correlationDatabase.logEvent(event);
    } catch (error) {
      logger.error('Failed to log event to database:', error);
    }
  }

  /**
   * Get recent events
   */
  getRecentEvents(count: number = 50): IntelligenceEvent[] {
    return this.eventLog.slice(-count);
  }

  /**
   * Clear all subscribers
   */
  clear(): void {
    this.subscribers.clear();
    logger.info('Event bus cleared');
  }
}

/**
 * Module Thread Pool
 * Manages concurrent module execution
 */
export class ModuleThreadPool {
  private maxConcurrent: number;
  private queue: ModuleTask[] = [];
  private active: Set<Promise<any>> = new Set();
  private processing = false;

  constructor(maxConcurrent: number = 10) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Execute module with concurrency control
   */
  async execute(module: LegalIntelligenceModule, event: IntelligenceEvent, priority: number = 0): Promise<void> {
    const task: ModuleTask = { module, event, priority };
    
    // Add to queue
    this.queue.push(task);
    this.queue.sort((a, b) => b.priority - a.priority); // Higher priority first

    // Start processing if not already running
    if (!this.processing) {
      await this.processQueue();
    }
  }

  /**
   * Process task queue with concurrency limit
   */
  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.queue.length > 0) {
      // Wait if at max concurrency
      while (this.active.size >= this.maxConcurrent) {
        await Promise.race(this.active);
      }

      const task = this.queue.shift();
      if (!task) break;

      // Execute module (SpiderFoot pattern)
      const promise = this.executeModule(task)
        .finally(() => this.active.delete(promise));
      
      this.active.add(promise);
    }

    // Wait for all active tasks to complete
    if (this.active.size > 0) {
      await Promise.allSettled(this.active);
    }

    this.processing = false;
  }

  /**
   * Execute individual module task
   */
  private async executeModule(task: ModuleTask): Promise<void> {
    try {
      logger.debug(`Executing module: ${task.module.name} for event: ${task.event.id}`);
      const startTime = Date.now();
      
      const resultEvents = await task.module.handleEvent(task.event);
      
      const duration = Date.now() - startTime;
      logger.info(`Module ${task.module.name} completed in ${duration}ms, produced ${resultEvents.length} events`);
      
      // Publish result events if any
      // Note: This would require a reference to the event bus
      // For now, we just return them
      return;
    } catch (error) {
      logger.error(`Module ${task.module.name} failed:`, error);
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): { queued: number; active: number; maxConcurrent: number } {
    return {
      queued: this.queue.length,
      active: this.active.size,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /**
   * Clear queue
   */
  clear(): void {
    this.queue = [];
    logger.info('Thread pool queue cleared');
  }
}

/**
 * Correlation Engine
 * Main orchestrator for entity correlation
 */
export class CorrelationEngine {
  private eventBus: IntelligenceEventBus;
  private threadPool: ModuleThreadPool;
  private modules: Map<string, LegalIntelligenceModule> = new Map();
  private initialized = false;
  private initMutex = new AsyncMutex();

  constructor(maxConcurrent: number = 10) {
    this.eventBus = new IntelligenceEventBus();
    this.threadPool = new ModuleThreadPool(maxConcurrent);
  }

  /**
   * Initialize engine (thread-safe)
   */
  async initialize(): Promise<void> {
    return this.initMutex.runExclusive(async () => {
      if (this.initialized) return;

      try {
        // Initialize database
        await correlationDatabase.initialize();
        
        this.initialized = true;
        logger.info('Correlation engine initialized');
      } catch (error) {
        logger.error('Failed to initialize correlation engine:', error);
        throw error;
      }
    });
  }

  /**
   * Check if engine is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Register module
   */
  registerModule(module: LegalIntelligenceModule): void {
    if (this.modules.has(module.name)) {
      logger.warn(`Module ${module.name} already registered, replacing`);
    }

    // Subscribe to input event types
    for (const inputType of module.inputTypes) {
      this.eventBus.subscribe(inputType, async (event) => {
        await this.threadPool.execute(module, event);
      });
    }

    this.modules.set(module.name, module);
    logger.info(`Module registered: ${module.name}`);
  }

  /**
   * Unregister module
   */
  unregisterModule(moduleName: string): void {
    const module = this.modules.get(moduleName);
    if (!module) return;

    // Unsubscribe from all event types
    // Note: EventBus doesn't track which handler belongs to which module
    // So we can't cleanly unsubscribe. This is a limitation we accept for simplicity.
    
    this.modules.delete(moduleName);
    logger.info(`Module unregistered: ${moduleName}`);
  }

  /**
   * Publish event to the event bus
   */
  async publishEvent(event: IntelligenceEvent): Promise<void> {
    if (!this.initialized) {
      throw new Error('Correlation engine not initialized');
    }

    await this.eventBus.publish(event);
  }

  /**
   * Create and publish a new event
   */
  async emit(type: string, data: any, sourceModule: string, entityId?: string): Promise<string> {
    const event: IntelligenceEvent = {
      id: generateEventId(),
      type,
      entityId,
      data,
      sourceModule,
      timestamp: new Date(),
      processed: false,
    };

    await this.publishEvent(event);
    return event.id;
  }

  /**
   * Get registered modules
   */
  getModules(): LegalIntelligenceModule[] {
    return Array.from(this.modules.values());
  }

  /**
   * Get module by name
   */
  getModule(name: string): LegalIntelligenceModule | undefined {
    return this.modules.get(name);
  }

  /**
   * Get engine statistics
   */
  getStats(): {
    modules: number;
    events: number;
    threadPool: { queued: number; active: number; maxConcurrent: number };
    database: { entities: number; relationships: number; events: number };
  } {
    return {
      modules: this.modules.size,
      events: this.eventBus.getRecentEvents().length,
      threadPool: this.threadPool.getStats(),
      database: correlationDatabase.getStats(),
    };
  }

  /**
   * Shutdown engine
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down correlation engine');

    // Shutdown all modules
    for (const module of this.modules.values()) {
      try {
        await module.shutdown();
      } catch (error) {
        logger.error(`Error shutting down module ${module.name}:`, error);
      }
    }

    // Clear event bus and thread pool
    this.eventBus.clear();
    this.threadPool.clear();

    // Close database
    correlationDatabase.close();

    this.initialized = false;
    logger.info('Correlation engine shutdown complete');
  }
}

// Singleton instance
export const correlationEngine = new CorrelationEngine();
