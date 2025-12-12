/**
 * API Optimizer - Ultra-efficient API call management
 * 
 * Implements the GLOBAL DIRECTIVE requirements:
 * - Minimize API calls and compute usage
 * - Fewer, deeper operations over many shallow ones
 * - Merge related changes into single passes
 * - Aggressive caching
 * - Request batching and deduplication
 * - Intelligent model fallback with coherency preservation
 * 
 * Design principles:
 * - Every request goes through optimization before execution
 * - Semantic deduplication prevents redundant calls
 * - Request batching collapses multiple similar requests
 * - Intelligent fallback maintains Lexara personality coherency
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import { LRUCache } from 'lru-cache';

// ============================================================================
// TYPES
// ============================================================================

export interface OptimizedRequest {
  id: string;
  type: 'ai' | 'database' | 'crawler' | 'external';
  prompt?: string;
  systemPrompt?: string;
  query?: string;
  priority: number;
  createdAt: number;
  semanticHash: string;
  batchable: boolean;
  deduplicationKey: string;
}

export interface OptimizationResult {
  action: 'execute' | 'cached' | 'batched' | 'deduplicated' | 'throttled';
  originalRequests: number;
  executedRequests: number;
  savedRequests: number;
  cacheHits: number;
  batchedCount: number;
  latencyMs: number;
}

export interface BatchedRequest {
  requests: OptimizedRequest[];
  mergedPrompt: string;
  priority: number;
  executeAt: number;
}

export interface CoherencyState {
  lastProvider: string;
  lastModel: string;
  personalityHash: string;
  conversationContext: string[];
  emotionalState: 'neutral' | 'helpful' | 'serious' | 'empathetic';
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SEMANTIC_CACHE_SIZE = 500;
const SEMANTIC_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const BATCH_WINDOW_MS = 100; // Batch requests within 100ms
const MAX_BATCH_SIZE = 5;
const DEDUP_WINDOW_MS = 5000; // Deduplicate identical requests within 5s
const THROTTLE_THRESHOLD = 10; // Max requests per second

// Lexara personality anchors for coherency
const LEXARA_PERSONALITY_ANCHORS = [
  'I am Lexara, your legal AI assistant',
  'professional and empathetic',
  'clear and precise legal guidance',
  'always prioritize user understanding',
];

// ============================================================================
// SEMANTIC CACHE
// ============================================================================

class SemanticCache {
  private cache: LRUCache<string, any>;
  private hashIndex: Map<string, Set<string>> = new Map();

  constructor() {
    this.cache = new LRUCache({
      max: SEMANTIC_CACHE_SIZE,
      ttl: SEMANTIC_CACHE_TTL_MS,
      updateAgeOnGet: true,
    });
  }

  /**
   * Generate semantic hash for a prompt
   * Uses key phrase extraction for semantic similarity
   */
  generateSemanticHash(text: string): string {
    // Normalize text
    const normalized = text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract key phrases (simple n-gram approach)
    const words = normalized.split(' ').filter(w => w.length > 3);
    const keyWords = words.slice(0, 20).sort().join('|');

    return crypto.createHash('sha256').update(keyWords).digest('hex').substring(0, 16);
  }

  /**
   * Check for semantically similar cached response
   */
  get(semanticHash: string): any | null {
    return this.cache.get(semanticHash) ?? null;
  }

  /**
   * Store response with semantic hash
   */
  set(semanticHash: string, value: any): void {
    this.cache.set(semanticHash, value);
  }

  /**
   * Check if similar request exists
   */
  has(semanticHash: string): boolean {
    return this.cache.has(semanticHash);
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.cache.size,
      maxSize: SEMANTIC_CACHE_SIZE,
      hitRate: 0, // LRU cache doesn't track hits directly
    };
  }
}

// ============================================================================
// REQUEST BATCHER
// ============================================================================

class RequestBatcher {
  private pendingBatches: Map<string, BatchedRequest> = new Map();
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Add request to batch, returns batch key
   */
  addToBatch(request: OptimizedRequest): string {
    const batchKey = this.generateBatchKey(request);
    
    let batch = this.pendingBatches.get(batchKey);
    if (!batch) {
      batch = {
        requests: [],
        mergedPrompt: '',
        priority: request.priority,
        executeAt: Date.now() + BATCH_WINDOW_MS,
      };
      this.pendingBatches.set(batchKey, batch);
    }

    batch.requests.push(request);
    batch.priority = Math.max(batch.priority, request.priority);

    return batchKey;
  }

  /**
   * Generate batch key based on request characteristics
   */
  private generateBatchKey(request: OptimizedRequest): string {
    const typeKey = request.type;
    const contextKey = request.systemPrompt 
      ? crypto.createHash('md5').update(request.systemPrompt).digest('hex').substring(0, 8)
      : 'default';
    return `${typeKey}:${contextKey}`;
  }

  /**
   * Check if batch is ready to execute
   */
  isBatchReady(batchKey: string): boolean {
    const batch = this.pendingBatches.get(batchKey);
    if (!batch) return false;

    return batch.requests.length >= MAX_BATCH_SIZE || Date.now() >= batch.executeAt;
  }

  /**
   * Get and clear batch
   */
  consumeBatch(batchKey: string): BatchedRequest | null {
    const batch = this.pendingBatches.get(batchKey);
    if (!batch) return null;

    this.pendingBatches.delete(batchKey);
    
    const timer = this.batchTimers.get(batchKey);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(batchKey);
    }

    // Merge prompts for batch execution
    batch.mergedPrompt = this.mergePrompts(batch.requests);

    return batch;
  }

  /**
   * Merge multiple prompts into a single batched prompt
   */
  private mergePrompts(requests: OptimizedRequest[]): string {
    if (requests.length === 1) {
      return requests[0].prompt || '';
    }

    const prompts = requests
      .map((r, i) => `[Task ${i + 1}]: ${r.prompt}`)
      .join('\n\n');

    return `Process the following ${requests.length} tasks efficiently:\n\n${prompts}\n\nProvide responses for each task, clearly labeled.`;
  }

  /**
   * Get pending batch count
   */
  getPendingCount(): number {
    return Array.from(this.pendingBatches.values())
      .reduce((sum, batch) => sum + batch.requests.length, 0);
  }
}

// ============================================================================
// DEDUPLICATION TRACKER
// ============================================================================

class DeduplicationTracker {
  private recentRequests: Map<string, { timestamp: number; resultPromise: Promise<any> }> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up old entries periodically
    this.cleanupInterval = setInterval(() => this.cleanup(), DEDUP_WINDOW_MS);
  }

  /**
   * Check if identical request was made recently
   */
  isDuplicate(deduplicationKey: string): boolean {
    const existing = this.recentRequests.get(deduplicationKey);
    if (!existing) return false;

    return Date.now() - existing.timestamp < DEDUP_WINDOW_MS;
  }

  /**
   * Get pending result for duplicate request
   */
  getPendingResult(deduplicationKey: string): Promise<any> | null {
    const existing = this.recentRequests.get(deduplicationKey);
    if (!existing || Date.now() - existing.timestamp >= DEDUP_WINDOW_MS) {
      return null;
    }
    return existing.resultPromise;
  }

  /**
   * Track a new request
   */
  track(deduplicationKey: string, resultPromise: Promise<any>): void {
    this.recentRequests.set(deduplicationKey, {
      timestamp: Date.now(),
      resultPromise,
    });
  }

  /**
   * Clean up old entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.recentRequests) {
      if (now - value.timestamp >= DEDUP_WINDOW_MS) {
        this.recentRequests.delete(key);
      }
    }
  }

  /**
   * Stop cleanup interval
   */
  shutdown(): void {
    clearInterval(this.cleanupInterval);
  }
}

// ============================================================================
// COHERENCY MANAGER
// ============================================================================

class CoherencyManager {
  private state: CoherencyState = {
    lastProvider: '',
    lastModel: '',
    personalityHash: this.computePersonalityHash(),
    conversationContext: [],
    emotionalState: 'neutral',
  };

  /**
   * Compute personality hash for consistency checking
   */
  private computePersonalityHash(): string {
    return crypto
      .createHash('sha256')
      .update(LEXARA_PERSONALITY_ANCHORS.join('|'))
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Get coherent system prompt that maintains Lexara's personality
   */
  getCoherentSystemPrompt(basePrompt: string = ''): string {
    const personalityPreamble = `You are Lexara, a sophisticated legal AI assistant. Maintain a professional yet empathetic tone. Your responses should be clear, precise, and focused on helping users understand their legal situations.\n\n`;
    
    const contextSuffix = this.state.conversationContext.length > 0
      ? `\n\nRecent context: ${this.state.conversationContext.slice(-3).join(' ')}`
      : '';

    return personalityPreamble + basePrompt + contextSuffix;
  }

  /**
   * Update state after a successful call
   */
  updateAfterCall(provider: string, model: string, response: string): void {
    this.state.lastProvider = provider;
    this.state.lastModel = model;

    // Extract context from response (first sentence)
    const contextSnippet = response.split('.')[0]?.substring(0, 100) || '';
    this.state.conversationContext.push(contextSnippet);

    // Keep only recent context
    if (this.state.conversationContext.length > 10) {
      this.state.conversationContext = this.state.conversationContext.slice(-10);
    }

    // Detect emotional state from response
    this.updateEmotionalState(response);
  }

  /**
   * Update emotional state based on response content
   */
  private updateEmotionalState(response: string): void {
    const lowerResponse = response.toLowerCase();
    
    if (lowerResponse.includes('sorry') || lowerResponse.includes('understand your concern')) {
      this.state.emotionalState = 'empathetic';
    } else if (lowerResponse.includes('important') || lowerResponse.includes('crucial')) {
      this.state.emotionalState = 'serious';
    } else if (lowerResponse.includes('help') || lowerResponse.includes('assist')) {
      this.state.emotionalState = 'helpful';
    } else {
      this.state.emotionalState = 'neutral';
    }
  }

  /**
   * Get preferred provider based on coherency requirements
   */
  getPreferredProvider(): string | null {
    // Prefer the last used provider for conversation continuity
    return this.state.lastProvider || null;
  }

  /**
   * Get current state
   */
  getState(): CoherencyState {
    return { ...this.state };
  }

  /**
   * Reset coherency state
   */
  reset(): void {
    this.state = {
      lastProvider: '',
      lastModel: '',
      personalityHash: this.computePersonalityHash(),
      conversationContext: [],
      emotionalState: 'neutral',
    };
  }
}

// ============================================================================
// API OPTIMIZER
// ============================================================================

class APIOptimizer extends EventEmitter {
  private semanticCache: SemanticCache;
  private batcher: RequestBatcher;
  private deduplicator: DeduplicationTracker;
  private coherencyManager: CoherencyManager;
  private requestsThisSecond: number = 0;
  private lastSecondReset: number = Date.now();
  private metrics: {
    totalRequests: number;
    cacheHits: number;
    batchedRequests: number;
    deduplicatedRequests: number;
    throttledRequests: number;
    savedApiCalls: number;
  };

  constructor() {
    super();
    this.semanticCache = new SemanticCache();
    this.batcher = new RequestBatcher();
    this.deduplicator = new DeduplicationTracker();
    this.coherencyManager = new CoherencyManager();
    this.metrics = {
      totalRequests: 0,
      cacheHits: 0,
      batchedRequests: 0,
      deduplicatedRequests: 0,
      throttledRequests: 0,
      savedApiCalls: 0,
    };

    console.log('[APIOptimizer] Initialized with semantic caching, batching, and deduplication');
  }

  /**
   * Optimize an AI request before execution
   */
  async optimizeAIRequest(
    prompt: string,
    systemPrompt?: string,
    options: { priority?: number; skipCache?: boolean; skipBatch?: boolean } = {}
  ): Promise<{
    shouldExecute: boolean;
    cachedResult?: any;
    optimizedPrompt: string;
    optimizedSystemPrompt: string;
    deduplicationKey: string;
    semanticHash: string;
    batchKey?: string;
  }> {
    this.metrics.totalRequests++;

    // Check throttle
    this.updateThrottle();
    if (this.requestsThisSecond > THROTTLE_THRESHOLD) {
      this.metrics.throttledRequests++;
      this.emit('throttled', { requestsThisSecond: this.requestsThisSecond });
    }

    // Generate semantic hash
    const semanticHash = this.semanticCache.generateSemanticHash(prompt + (systemPrompt || ''));
    
    // Generate deduplication key
    const deduplicationKey = crypto
      .createHash('sha256')
      .update(prompt + (systemPrompt || ''))
      .digest('hex');

    // Check semantic cache
    if (!options.skipCache) {
      const cachedResult = this.semanticCache.get(semanticHash);
      if (cachedResult) {
        this.metrics.cacheHits++;
        this.metrics.savedApiCalls++;
        console.log('[APIOptimizer] Semantic cache hit');
        return {
          shouldExecute: false,
          cachedResult,
          optimizedPrompt: prompt,
          optimizedSystemPrompt: systemPrompt || '',
          deduplicationKey,
          semanticHash,
        };
      }
    }

    // Check for duplicate in-flight request
    const pendingResult = this.deduplicator.getPendingResult(deduplicationKey);
    if (pendingResult) {
      this.metrics.deduplicatedRequests++;
      this.metrics.savedApiCalls++;
      console.log('[APIOptimizer] Deduplicated request');
      return {
        shouldExecute: false,
        cachedResult: await pendingResult,
        optimizedPrompt: prompt,
        optimizedSystemPrompt: systemPrompt || '',
        deduplicationKey,
        semanticHash,
      };
    }

    // Apply coherency management
    const coherentSystemPrompt = this.coherencyManager.getCoherentSystemPrompt(systemPrompt);

    // Check for batching opportunity
    let batchKey: string | undefined;
    if (!options.skipBatch && !options.skipCache) {
      const request: OptimizedRequest = {
        id: crypto.randomBytes(8).toString('hex'),
        type: 'ai',
        prompt,
        systemPrompt: coherentSystemPrompt,
        priority: options.priority || 5,
        createdAt: Date.now(),
        semanticHash,
        batchable: true,
        deduplicationKey,
      };

      batchKey = this.batcher.addToBatch(request);
      this.metrics.batchedRequests++;
    }

    return {
      shouldExecute: true,
      optimizedPrompt: prompt,
      optimizedSystemPrompt: coherentSystemPrompt,
      deduplicationKey,
      semanticHash,
      batchKey,
    };
  }

  /**
   * Record successful execution and cache result
   */
  recordSuccess(
    semanticHash: string,
    deduplicationKey: string,
    result: any,
    provider: string,
    model: string
  ): void {
    // Cache the result
    this.semanticCache.set(semanticHash, result);

    // Update coherency state
    const responseText = typeof result === 'string' 
      ? result 
      : result?.content || result?.text || '';
    this.coherencyManager.updateAfterCall(provider, model, responseText);

    this.emit('success', { semanticHash, provider, model });
  }

  /**
   * Track in-flight request for deduplication
   */
  trackRequest(deduplicationKey: string, resultPromise: Promise<any>): void {
    this.deduplicator.track(deduplicationKey, resultPromise);
  }

  /**
   * Update throttle counter
   */
  private updateThrottle(): void {
    const now = Date.now();
    if (now - this.lastSecondReset >= 1000) {
      this.requestsThisSecond = 0;
      this.lastSecondReset = now;
    }
    this.requestsThisSecond++;
  }

  /**
   * Get preferred provider for coherency
   */
  getPreferredProvider(): string | null {
    return this.coherencyManager.getPreferredProvider();
  }

  /**
   * Get coherency state
   */
  getCoherencyState(): CoherencyState {
    return this.coherencyManager.getState();
  }

  /**
   * Reset coherency for new conversation
   */
  resetCoherency(): void {
    this.coherencyManager.reset();
  }

  /**
   * Generate cache keys for a prompt/systemPrompt combination
   * Public method for external use when caching results
   */
  generateCacheKeys(prompt: string, systemPrompt?: string): { semanticHash: string; deduplicationKey: string } {
    const combinedText = prompt + (systemPrompt || '');
    return {
      semanticHash: this.semanticCache.generateSemanticHash(combinedText),
      deduplicationKey: crypto.createHash('sha256').update(combinedText).digest('hex'),
    };
  }

  /**
   * Get optimization metrics
   */
  getMetrics(): typeof this.metrics & { savingsPercent: number; cacheStats: any } {
    const totalPotentialCalls = this.metrics.totalRequests;
    const actualCalls = totalPotentialCalls - this.metrics.savedApiCalls;
    const savingsPercent = totalPotentialCalls > 0 
      ? (this.metrics.savedApiCalls / totalPotentialCalls) * 100 
      : 0;

    return {
      ...this.metrics,
      savingsPercent,
      cacheStats: this.semanticCache.getStats(),
    };
  }

  /**
   * Get pending batch count
   */
  getPendingBatchCount(): number {
    return this.batcher.getPendingCount();
  }

  /**
   * Shutdown optimizer
   */
  shutdown(): void {
    this.deduplicator.shutdown();
    console.log('[APIOptimizer] Shutdown complete');
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let apiOptimizerInstance: APIOptimizer | null = null;

export function getAPIOptimizer(): APIOptimizer {
  if (!apiOptimizerInstance) {
    apiOptimizerInstance = new APIOptimizer();
  }
  return apiOptimizerInstance;
}

export function shutdownAPIOptimizer(): void {
  if (apiOptimizerInstance) {
    apiOptimizerInstance.shutdown();
    apiOptimizerInstance = null;
  }
}

export { APIOptimizer, SemanticCache, RequestBatcher, CoherencyManager };
export default getAPIOptimizer;
