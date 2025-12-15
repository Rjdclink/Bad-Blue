/**
 * People Search Proxy Client
 * 
 * This module provides a proxy interface for the main app to communicate
 * with the People Search Worker service. It does NOT import Playwright
 * and handles worker unavailability gracefully.
 * 
 * KEY DESIGN PRINCIPLES:
 * - Main app startup MUST NOT depend on worker availability
 * - Worker health is validated at runtime, not startup
 * - Graceful degradation when worker is unavailable
 */

import type { SearchQuery, PersonRecord } from './peopleSearch/types';

interface WorkerHealth {
  status: 'healthy' | 'unhealthy';
  browserPoolSize: number;
  maxPoolSize: number;
  lastValidation: string | null;
  validationError: string | null;
  uptime: number;
}

interface SearchResponse {
  success: boolean;
  data?: PersonRecord;
  error?: string;
  cached?: boolean;
  durationMs?: number;
}

interface ValidateResponse {
  success: boolean;
  validationError: string | null;
  timestamp: string;
}

// Worker configuration - uses environment variable or defaults to localhost:5001
const WORKER_URL = process.env.PEOPLE_SEARCH_WORKER_URL || 'http://localhost:5001';
const WORKER_TIMEOUT = parseInt(process.env.PEOPLE_SEARCH_WORKER_TIMEOUT || '60000', 10);

// Cached worker health status
let cachedHealth: { health: WorkerHealth | null; timestamp: number } = {
  health: null,
  timestamp: 0,
};
const HEALTH_CACHE_TTL = 30000; // 30 seconds

/**
 * Check if the People Search Worker is available
 * This is called at runtime, NOT at startup
 */
export async function checkWorkerHealth(): Promise<WorkerHealth | null> {
  // Return cached health if still valid
  const now = Date.now();
  if (cachedHealth.health && now - cachedHealth.timestamp < HEALTH_CACHE_TTL) {
    return cachedHealth.health;
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${WORKER_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      console.warn('[PeopleSearchProxy] Worker health check returned non-OK:', response.status);
      cachedHealth = { health: null, timestamp: now };
      return null;
    }
    
    const health = await response.json() as WorkerHealth;
    cachedHealth = { health, timestamp: now };
    return health;
  } catch (error: any) {
    // Worker is not available - this is not a fatal error
    // The main app continues running, just reports this feature as unavailable
    console.warn('[PeopleSearchProxy] Worker health check failed:', error.message);
    cachedHealth = { health: null, timestamp: now };
    return null;
  }
}

/**
 * Check if the People Search Worker is initialized and ready
 * Returns true if worker is healthy, false otherwise
 * Main app startup does NOT depend on this returning true
 */
export async function isWorkerReady(): Promise<boolean> {
  const health = await checkWorkerHealth();
  return health?.status === 'healthy';
}

/**
 * Validate the worker's browser installation
 * This triggers a test crawl in the worker
 */
export async function validateWorkerBrowser(): Promise<ValidateResponse> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(`${WORKER_URL}/validate`, {
      method: 'POST',
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        validationError: `Worker validation failed: ${error}`,
        timestamp: new Date().toISOString(),
      };
    }
    
    return await response.json() as ValidateResponse;
  } catch (error: any) {
    return {
      success: false,
      validationError: `Worker validation request failed: ${error.message}`,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Execute a people search via the worker
 * Returns search results or an error if worker is unavailable
 */
export async function searchPerson(query: SearchQuery): Promise<SearchResponse> {
  // First check if worker is available
  const health = await checkWorkerHealth();
  
  if (!health || health.status !== 'healthy') {
    return {
      success: false,
      error: 'People Search Worker is not available. Browser-based search features are temporarily disabled.',
    };
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT);
    
    const response = await fetch(`${WORKER_URL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(query),
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorJson: any;
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        errorJson = { error: errorText };
      }
      
      return {
        success: false,
        error: errorJson.error || `Worker returned status ${response.status}`,
      };
    }
    
    return await response.json() as SearchResponse;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: 'Search request timed out. Please try again.',
      };
    }
    
    return {
      success: false,
      error: `Search request failed: ${error.message}`,
    };
  }
}

/**
 * Get the worker URL (for debugging/logging)
 */
export function getWorkerUrl(): string {
  return WORKER_URL;
}

/**
 * PeopleSearchProxyAggregator - Drop-in replacement for PeopleSearchAggregator
 * This class provides the same interface but proxies to the worker
 */
export class PeopleSearchProxyAggregator {
  private metrics = {
    totalSearches: 0,
    cacheHits: 0,
    avgResponseTimeMs: 0,
    successRate: 1,
  };
  
  private responseTimes: number[] = [];
  
  /**
   * Search for person - proxies to worker
   */
  async search(query: SearchQuery): Promise<PersonRecord> {
    const startTime = Date.now();
    this.metrics.totalSearches++;
    
    const result = await searchPerson(query);
    const duration = Date.now() - startTime;
    
    this.updateMetrics(duration, result.success);
    
    if (result.cached) {
      this.metrics.cacheHits++;
    }
    
    if (!result.success) {
      throw new Error(result.error || 'Search failed');
    }
    
    return result.data!;
  }
  
  /**
   * Batch search - executes multiple searches via worker
   */
  async batchSearch(queries: SearchQuery[]): Promise<PersonRecord[]> {
    const results: PersonRecord[] = [];
    
    // Process in batches of 3 for parallelism
    const batchSize = 3;
    for (let i = 0; i < queries.length; i += batchSize) {
      const batch = queries.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(q => this.search(q))
      );
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      }
    }
    
    return results;
  }
  
  /**
   * Initialize - no-op for proxy (worker manages browser pool)
   */
  async initializeBrowserPool(): Promise<void> {
    // Worker manages its own browser pool
    // This is a no-op for the proxy
    console.log('[PeopleSearchProxy] Browser pool managed by worker');
  }
  
  /**
   * Get performance metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }
  
  /**
   * Cleanup - no-op for proxy
   */
  async cleanup(): Promise<void> {
    // Worker manages its own cleanup
    console.log('[PeopleSearchProxy] Cleanup managed by worker');
  }
  
  private updateMetrics(responseTime: number, success: boolean): void {
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > 100) this.responseTimes.shift();
    
    this.metrics.avgResponseTimeMs = 
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
    
    if (!success) {
      this.metrics.successRate = Math.max(0, this.metrics.successRate - 0.01);
    } else {
      this.metrics.successRate = Math.min(1, this.metrics.successRate + 0.001);
    }
  }
}

// Export a singleton proxy aggregator instance
export const peopleSearchProxy = new PeopleSearchProxyAggregator();
