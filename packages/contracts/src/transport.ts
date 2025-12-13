/**
 * PANTHEON THREE-LAYER TRANSPORT SYSTEM
 * 
 * Layer 1: Pub/Sub - Durable replay log (source of truth)
 * Layer 2: NATS - Low-latency reflex coordination
 * Layer 3: Redis Streams - Short-lived working memory, de-dupe, rate control
 * 
 * INVARIANT: NATS messages are NOT the source of truth; they must be derivable from Pub/Sub.
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import type {
  ReactorEvent,
  Observation,
  GapDetected,
  SimRequest,
  SimResult,
  ActionIntent,
  ActionResult,
  Telemetry,
  Trip,
  PUBSUB_TOPICS,
  NATS_SUBJECTS,
  REDIS_KEYS,
} from './index';

// ============================================================================
// INTERFACES
// ============================================================================

export interface TransportConfig {
  /** Whether to use in-memory fallback when external services unavailable */
  useInMemoryFallback: boolean;
  /** Redis connection string */
  redisUrl?: string;
  /** NATS connection string */
  natsUrl?: string;
  /** Pub/Sub project ID */
  pubsubProjectId?: string;
  /** Working memory TTL (ms) */
  workingMemoryTtlMs: number;
  /** Dedup window (ms) */
  dedupWindowMs: number;
  /** Rate limit window (ms) */
  rateLimitWindowMs: number;
}

export interface Message<T = unknown> {
  id: string;
  topic: string;
  data: T;
  timestamp: number;
  attributes?: Record<string, string>;
}

export interface Subscription {
  topic: string;
  handler: (message: Message) => Promise<void>;
  unsubscribe: () => void;
}

// ============================================================================
// IN-MEMORY IMPLEMENTATIONS (for development/fallback)
// ============================================================================

/**
 * In-Memory Pub/Sub implementation
 * Provides durable storage with replay capability
 */
class InMemoryPubSub extends EventEmitter {
  private topics: Map<string, Message[]> = new Map();
  private subscriptions: Map<string, Set<(msg: Message) => Promise<void>>> = new Map();
  private maxMessagesPerTopic = 10000;

  async publish(topic: string, data: unknown, attributes?: Record<string, string>): Promise<string> {
    const message: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      topic,
      data,
      timestamp: Date.now(),
      attributes,
    };

    // Store message
    if (!this.topics.has(topic)) {
      this.topics.set(topic, []);
    }
    const messages = this.topics.get(topic)!;
    messages.push(message);

    // Trim old messages
    while (messages.length > this.maxMessagesPerTopic) {
      messages.shift();
    }

    // Deliver to subscribers
    const handlers = this.subscriptions.get(topic);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(message);
        } catch (err) {
          console.error(`[InMemoryPubSub] Handler error for topic ${topic}:`, err);
        }
      }
    }

    return message.id;
  }

  subscribe(topic: string, handler: (msg: Message) => Promise<void>): Subscription {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic)!.add(handler);

    return {
      topic,
      handler,
      unsubscribe: () => {
        this.subscriptions.get(topic)?.delete(handler);
      },
    };
  }

  /**
   * Replay messages from a topic starting at a specific timestamp
   */
  async replay(topic: string, fromTimestamp: number, handler: (msg: Message) => Promise<void>): Promise<number> {
    const messages = this.topics.get(topic) || [];
    let count = 0;

    for (const msg of messages) {
      if (msg.timestamp >= fromTimestamp) {
        await handler(msg);
        count++;
      }
    }

    return count;
  }

  getTopicStats(): Record<string, { messageCount: number; subscriberCount: number }> {
    const stats: Record<string, { messageCount: number; subscriberCount: number }> = {};
    
    for (const [topic, messages] of this.topics) {
      stats[topic] = {
        messageCount: messages.length,
        subscriberCount: this.subscriptions.get(topic)?.size || 0,
      };
    }

    return stats;
  }
}

/**
 * In-Memory NATS implementation
 * Provides low-latency pub/sub without persistence
 */
class InMemoryNATS extends EventEmitter {
  private subjects: Map<string, Set<(msg: unknown) => void>> = new Map();

  publish(subject: string, data: unknown): void {
    const handlers = this.getMatchingHandlers(subject);
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[InMemoryNATS] Handler error for subject ${subject}:`, err);
      }
    }
  }

  subscribe(pattern: string, handler: (msg: unknown) => void): () => void {
    if (!this.subjects.has(pattern)) {
      this.subjects.set(pattern, new Set());
    }
    this.subjects.get(pattern)!.add(handler);

    return () => {
      this.subjects.get(pattern)?.delete(handler);
    };
  }

  private getMatchingHandlers(subject: string): Set<(msg: unknown) => void> {
    const allHandlers = new Set<(msg: unknown) => void>();

    for (const [pattern, handlers] of this.subjects) {
      if (this.matchesPattern(subject, pattern)) {
        for (const handler of handlers) {
          allHandlers.add(handler);
        }
      }
    }

    return allHandlers;
  }

  private matchesPattern(subject: string, pattern: string): boolean {
    // Simple wildcard matching: * matches single token, > matches remainder
    const subjectParts = subject.split('.');
    const patternParts = pattern.split('.');

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '>') {
        return true; // Matches remainder
      }
      if (patternParts[i] === '*') {
        continue; // Matches any single token
      }
      if (subjectParts[i] !== patternParts[i]) {
        return false;
      }
    }

    return subjectParts.length === patternParts.length;
  }
}

/**
 * In-Memory Redis Streams implementation
 * Provides working memory, dedup, and rate limiting
 */
class InMemoryRedisStreams {
  private streams: Map<string, { id: string; data: unknown; timestamp: number }[]> = new Map();
  private hashes: Map<string, Map<string, unknown>> = new Map();
  private sets: Map<string, Set<string>> = new Map();
  private sortedSets: Map<string, { member: string; score: number }[]> = new Map();
  private ttls: Map<string, number> = new Map();
  private maxStreamLength = 1000;

  // Stream operations
  async xadd(stream: string, id: string, data: unknown): Promise<string> {
    if (!this.streams.has(stream)) {
      this.streams.set(stream, []);
    }
    const entries = this.streams.get(stream)!;
    const entryId = id === '*' ? `${Date.now()}-0` : id;
    entries.push({ id: entryId, data, timestamp: Date.now() });

    // Trim
    while (entries.length > this.maxStreamLength) {
      entries.shift();
    }

    return entryId;
  }

  async xrange(stream: string, start: string, end: string, count?: number): Promise<{ id: string; data: unknown }[]> {
    const entries = this.streams.get(stream) || [];
    const startTs = start === '-' ? 0 : parseInt(start.split('-')[0], 10);
    const endTs = end === '+' ? Infinity : parseInt(end.split('-')[0], 10);

    let result = entries.filter(e => {
      const ts = parseInt(e.id.split('-')[0], 10);
      return ts >= startTs && ts <= endTs;
    });

    if (count) {
      result = result.slice(0, count);
    }

    return result.map(e => ({ id: e.id, data: e.data }));
  }

  async xlen(stream: string): Promise<number> {
    return this.streams.get(stream)?.length || 0;
  }

  // Hash operations
  async hset(key: string, field: string, value: unknown): Promise<void> {
    if (!this.hashes.has(key)) {
      this.hashes.set(key, new Map());
    }
    this.hashes.get(key)!.set(field, value);
  }

  async hget(key: string, field: string): Promise<unknown> {
    return this.hashes.get(key)?.get(field);
  }

  async hgetall(key: string): Promise<Record<string, unknown>> {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash);
  }

  async hdel(key: string, field: string): Promise<void> {
    this.hashes.get(key)?.delete(field);
  }

  // Set operations
  async sadd(key: string, member: string): Promise<number> {
    if (!this.sets.has(key)) {
      this.sets.set(key, new Set());
    }
    const set = this.sets.get(key)!;
    const existed = set.has(member);
    set.add(member);
    return existed ? 0 : 1;
  }

  async sismember(key: string, member: string): Promise<boolean> {
    return this.sets.get(key)?.has(member) || false;
  }

  async srem(key: string, member: string): Promise<void> {
    this.sets.get(key)?.delete(member);
  }

  // Sorted set operations (for rate limiting)
  async zadd(key: string, score: number, member: string): Promise<void> {
    if (!this.sortedSets.has(key)) {
      this.sortedSets.set(key, []);
    }
    const zset = this.sortedSets.get(key)!;
    const existing = zset.findIndex(e => e.member === member);
    if (existing >= 0) {
      zset[existing].score = score;
    } else {
      zset.push({ member, score });
    }
    zset.sort((a, b) => a.score - b.score);
  }

  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    const zset = this.sortedSets.get(key) || [];
    return zset.filter(e => e.score >= min && e.score <= max).map(e => e.member);
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    const zset = this.sortedSets.get(key);
    if (!zset) return 0;
    const before = zset.length;
    const filtered = zset.filter(e => e.score < min || e.score > max);
    this.sortedSets.set(key, filtered);
    return before - filtered.length;
  }

  async zcard(key: string): Promise<number> {
    return this.sortedSets.get(key)?.length || 0;
  }

  // TTL operations
  async expire(key: string, seconds: number): Promise<void> {
    this.ttls.set(key, Date.now() + seconds * 1000);
    setTimeout(() => {
      if (this.ttls.get(key) && Date.now() >= (this.ttls.get(key) || 0)) {
        this.del(key);
      }
    }, seconds * 1000);
  }

  async del(key: string): Promise<void> {
    this.streams.delete(key);
    this.hashes.delete(key);
    this.sets.delete(key);
    this.sortedSets.delete(key);
    this.ttls.delete(key);
  }

  // Cleanup expired data
  cleanup(): void {
    const now = Date.now();
    for (const [key, expiry] of this.ttls) {
      if (now >= expiry) {
        this.del(key);
      }
    }
  }
}

// ============================================================================
// UNIFIED TRANSPORT
// ============================================================================

export class ReactorTransport extends EventEmitter {
  private config: TransportConfig;
  private pubsub: InMemoryPubSub;
  private nats: InMemoryNATS;
  private redis: InMemoryRedisStreams;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<TransportConfig> = {}) {
    super();
    this.config = {
      useInMemoryFallback: true,
      workingMemoryTtlMs: 60000,
      dedupWindowMs: 5000,
      rateLimitWindowMs: 1000,
      ...config,
    };

    // Initialize in-memory implementations (can be replaced with real clients)
    this.pubsub = new InMemoryPubSub();
    this.nats = new InMemoryNATS();
    this.redis = new InMemoryRedisStreams();

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.redis.cleanup();
    }, 10000);

    console.log('[ReactorTransport] Initialized with in-memory transport layers');
  }

  // ==================== PUB/SUB (DURABLE) ====================

  /**
   * Publish to durable Pub/Sub topic
   * This is the source of truth
   */
  async publishDurable(topic: string, event: ReactorEvent): Promise<string> {
    const messageId = await this.pubsub.publish(topic, event, {
      trace_id: event.trace_id,
      event_kind: event.kind,
    });

    // Also emit to NATS for low-latency consumers (if they're listening)
    this.publishFast(`${event.kind}.fast.${event.trace_id}`, event);

    // Store in working memory for feature extraction
    await this.storeInWorkingMemory(event);

    return messageId;
  }

  /**
   * Subscribe to durable Pub/Sub topic
   */
  subscribeDurable(topic: string, handler: (event: ReactorEvent) => Promise<void>): Subscription {
    return this.pubsub.subscribe(topic, async (msg) => {
      await handler(msg.data as ReactorEvent);
    });
  }

  /**
   * Replay messages from topic
   */
  async replayFromTopic(topic: string, fromTimestamp: number, handler: (event: ReactorEvent) => Promise<void>): Promise<number> {
    return this.pubsub.replay(topic, fromTimestamp, async (msg) => {
      await handler(msg.data as ReactorEvent);
    });
  }

  // ==================== NATS (LOW LATENCY) ====================

  /**
   * Publish to NATS for low-latency coordination
   * NOT the source of truth - must be derivable from Pub/Sub
   */
  publishFast(subject: string, data: unknown): void {
    this.nats.publish(subject, data);
  }

  /**
   * Subscribe to NATS subjects
   */
  subscribeFast(pattern: string, handler: (data: unknown) => void): () => void {
    return this.nats.subscribe(pattern, handler);
  }

  // ==================== REDIS (WORKING MEMORY) ====================

  /**
   * Store event in working memory for feature extraction
   */
  private async storeInWorkingMemory(event: ReactorEvent): Promise<void> {
    const streamKey = `wm:${event.kind}`;
    await this.redis.xadd(streamKey, '*', event);

    // Also update last-known-good for relevant entities
    if (event.kind === 'observation') {
      const obs = event as Observation;
      await this.redis.hset('wm:lastgood', `${obs.source}:${obs.type}`, {
        event,
        timestamp: event.ts,
      });
    }
  }

  /**
   * Get recent events from working memory
   */
  async getRecentEvents(kind: string, count: number = 100): Promise<ReactorEvent[]> {
    const entries = await this.redis.xrange(`wm:${kind}`, '-', '+', count);
    return entries.map(e => e.data as ReactorEvent);
  }

  /**
   * Get last known good observation for a source
   */
  async getLastGood(source: string, type: string): Promise<ReactorEvent | null> {
    const result = await this.redis.hget('wm:lastgood', `${source}:${type}`);
    return result ? (result as { event: ReactorEvent }).event : null;
  }

  /**
   * Check if event is duplicate (dedup)
   */
  async isDuplicate(event: ReactorEvent): Promise<boolean> {
    const hash = this.hashEvent(event);
    const key = `wm:dedupe:${event.kind}`;
    const exists = await this.redis.sismember(key, hash);
    
    if (!exists) {
      await this.redis.sadd(key, hash);
      await this.redis.expire(key, this.config.dedupWindowMs / 1000);
    }
    
    return exists;
  }

  /**
   * Check rate limit for a key
   */
  async checkRateLimit(key: string, maxRequests: number): Promise<{ allowed: boolean; remaining: number }> {
    const now = Date.now();
    const windowStart = now - this.config.rateLimitWindowMs;
    const rateLimitKey = `wm:ratelimit:${key}`;

    // Remove old entries
    await this.redis.zremrangebyscore(rateLimitKey, 0, windowStart);

    // Count current entries
    const count = await this.redis.zcard(rateLimitKey);

    if (count >= maxRequests) {
      return { allowed: false, remaining: 0 };
    }

    // Add new entry
    await this.redis.zadd(rateLimitKey, now, `${now}_${Math.random()}`);
    await this.redis.expire(rateLimitKey, Math.ceil(this.config.rateLimitWindowMs / 1000));

    return { allowed: true, remaining: maxRequests - count - 1 };
  }

  /**
   * Store extracted features
   */
  async storeFeatures(traceId: string, features: Record<string, unknown>): Promise<void> {
    await this.redis.hset('wm:features', traceId, features);
    await this.redis.expire('wm:features', this.config.workingMemoryTtlMs / 1000);
  }

  /**
   * Get extracted features
   */
  async getFeatures(traceId: string): Promise<Record<string, unknown> | null> {
    const result = await this.redis.hget('wm:features', traceId);
    return result as Record<string, unknown> | null;
  }

  // ==================== UTILITIES ====================

  private hashEvent(event: ReactorEvent): string {
    // Create deterministic hash excluding timestamp for dedup purposes
    const { ts, event_id, ...rest } = event;
    return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 16);
  }

  getStats(): {
    pubsub: Record<string, { messageCount: number; subscriberCount: number }>;
    workingMemory: { streamCounts: Record<string, number> };
  } {
    return {
      pubsub: this.pubsub.getTopicStats(),
      workingMemory: {
        streamCounts: {}, // Would need async iteration
      },
    };
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.removeAllListeners();
    console.log('[ReactorTransport] Shutdown complete');
  }
}

// Singleton factory
let transportInstance: ReactorTransport | null = null;

export function getTransport(config?: Partial<TransportConfig>): ReactorTransport {
  if (!transportInstance) {
    transportInstance = new ReactorTransport(config);
  }
  return transportInstance;
}

export default ReactorTransport;
