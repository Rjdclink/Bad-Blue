/**
 * Web Search Crawler Integration
 * 
 * Purpose: Integrate all web search functions with crawler systems for optimization
 * ONE FILE AT A TIME approach
 * 
 * Features:
 * 1. Route all web searches through crawler infrastructure
 * 2. Cache search results
 * 3. Parallel search execution across multiple sources
 * 4. Result aggregation and deduplication
 */

import { createLogger } from '../../logger';
import { enforceStoragySafety } from './safetyRules';
import { computationalBeam } from './index';
import { CrawlerStrategy, Task, TaskPriority, TaskType, TaskIntensity } from './types';

const log = createLogger('WebSearchCrawlerIntegration');

/**
 * Search result from a source
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  timestamp: number;
  relevance: number; // 0-1
}

/**
 * Aggregated search results
 */
export interface AggregatedSearchResults {
  query: string;
  results: SearchResult[];
  totalResults: number;
  searchTime: number;
  sources: string[];
  cached: boolean;
}

/**
 * Web Search Crawler Integration
 * 
 * Optimizes web searches by:
 * 1. Using crawler system infrastructure
 * 2. Parallel searches across multiple sources
 * 3. Result caching and deduplication
 * 4. Relevance scoring and ranking
 */
export class WebSearchCrawlerIntegration {
  private static instance: WebSearchCrawlerIntegration;
  private searchCache: Map<string, { results: SearchResult[]; timestamp: number }> = new Map();
  private beam: typeof computationalBeam;
  
  // Optimization settings
  private readonly CACHE_TTL_MS = 300000; // 5 minutes
  private readonly MAX_PARALLEL_SOURCES = 5;
  private readonly RELEVANCE_THRESHOLD = 0.3; // Filter low relevance results
  
  private constructor() {
    // Enforce safety rules
    enforceStoragySafety('web-search-crawler-integration');
    
    this.beam = computationalBeam;
    
    log.info('✅ Web Search Crawler Integration initialized');
    log.info('   Purpose: Optimize web search using crawler infrastructure');
    log.info('   Features: Parallel search, Caching, Deduplication');
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): WebSearchCrawlerIntegration {
    if (!WebSearchCrawlerIntegration.instance) {
      WebSearchCrawlerIntegration.instance = new WebSearchCrawlerIntegration();
    }
    return WebSearchCrawlerIntegration.instance;
  }
  
  /**
   * Execute web search using crawler infrastructure
   * 
   * This routes all web searches through the crawler system for:
   * - Parallel execution
   * - Result caching
   * - Computational beam power
   */
  async search(
    query: string,
    sources: string[] = ['google', 'bing', 'duckduckgo']
  ): Promise<AggregatedSearchResults> {
    const startTime = Date.now();
    const cacheKey = `${query}-${sources.join(',')}`;
    
    // Check cache first
    const cached = this.searchCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS) {
      log.info('📦 Search results served from cache', {
        query,
        results: cached.results.length,
      });
      
      return {
        query,
        results: cached.results,
        totalResults: cached.results.length,
        searchTime: Date.now() - startTime,
        sources,
        cached: true,
      };
    }
    
    log.info('🔍 Executing web search via crawler system', {
      query,
      sources: sources.length,
    });
    
    try {
      // Execute searches in parallel across all sources
      const searchPromises = sources.map(source =>
        this.searchSource(query, source)
      );
      
      const sourceResults = await Promise.all(searchPromises);
      
      // Aggregate and deduplicate results
      const aggregatedResults = this.aggregateResults(sourceResults);
      
      // Filter by relevance
      const filteredResults = aggregatedResults.filter(
        r => r.relevance >= this.RELEVANCE_THRESHOLD
      );
      
      // Sort by relevance (descending)
      filteredResults.sort((a, b) => b.relevance - a.relevance);
      
      // Cache results
      this.searchCache.set(cacheKey, {
        results: filteredResults,
        timestamp: Date.now(),
      });
      
      const searchTime = Date.now() - startTime;
      
      log.info('✅ Web search completed', {
        query,
        results: filteredResults.length,
        searchTime: searchTime + 'ms',
        sources: sources.length,
      });
      
      return {
        query,
        results: filteredResults,
        totalResults: filteredResults.length,
        searchTime,
        sources,
        cached: false,
      };
      
    } catch (error) {
      log.error('❌ Web search failed', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        query,
        results: [],
        totalResults: 0,
        searchTime: Date.now() - startTime,
        sources,
        cached: false,
      };
    }
  }
  
  /**
   * Search a specific source using crawler infrastructure
   */
  private async searchSource(
    query: string,
    source: string
  ): Promise<SearchResult[]> {
    log.debug('🌐 Searching source via crawler', { query, source });
    
    try {
      // Create crawler task for search
      const task: Task = {
        id: `search-${source}-${Date.now()}`,
        type: TaskType.BASIC_PARSING, // Use basic parsing for searches
        intensity: TaskIntensity.LIGHTWEIGHT,
        payload: {
          searchQuery: query,
          source,
          maxResults: 10,
        },
        metadata: {
          created: new Date(),
          priority: TaskPriority.MEDIUM,
          retries: 0,
          maxRetries: 2,
        },
      };
      
      // Execute via computational beam
      await this.beam.executeCrawlerTask(
        CrawlerStrategy.MOMENTUM,
        task.payload,
        { timeout: 10000 }
      );
      
      // Simulate search results (in production, would parse actual results)
      return this.generateMockResults(query, source);
      
    } catch (error) {
      log.error('❌ Source search failed', {
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      
      return [];
    }
  }
  
  /**
   * Generate mock search results (for development)
   */
  private generateMockResults(query: string, source: string): SearchResult[] {
    const results: SearchResult[] = [];
    const numResults = Math.floor(Math.random() * 5) + 3; // 3-7 results
    
    for (let i = 0; i < numResults; i++) {
      results.push({
        title: `${query} - Result ${i + 1} from ${source}`,
        url: `https://${source}.com/result/${i + 1}`,
        snippet: `This is a search result snippet for "${query}" from ${source}. It contains relevant information about the query.`,
        source,
        timestamp: Date.now(),
        relevance: Math.random() * 0.7 + 0.3, // 0.3-1.0
      });
    }
    
    return results;
  }
  
  /**
   * Aggregate results from multiple sources
   */
  private aggregateResults(sourceResults: SearchResult[][]): SearchResult[] {
    const allResults: SearchResult[] = [];
    const seenUrls = new Set<string>();
    
    // Flatten results and deduplicate by URL
    for (const results of sourceResults) {
      for (const result of results) {
        if (!seenUrls.has(result.url)) {
          allResults.push(result);
          seenUrls.add(result.url);
        } else {
          // If duplicate, boost relevance score (multiple sources found it)
          const existing = allResults.find(r => r.url === result.url);
          if (existing) {
            existing.relevance = Math.min(1.0, existing.relevance * 1.2);
          }
        }
      }
    }
    
    return allResults;
  }
  
  /**
   * Invalidate search cache
   */
  invalidateCache(query?: string): void {
    if (query) {
      // Invalidate specific query
      for (const key of this.searchCache.keys()) {
        if (key.startsWith(query)) {
          this.searchCache.delete(key);
        }
      }
      log.debug('🗑️ Search cache invalidated', { query });
    } else {
      // Clear all cache
      this.searchCache.clear();
      log.debug('🗑️ All search cache cleared');
    }
  }
  
  /**
   * Get optimization statistics
   */
  getStats(): {
    cachedQueries: number;
    cacheHitRate: number;
    avgSearchTime: number;
  } {
    return {
      cachedQueries: this.searchCache.size,
      cacheHitRate: 0, // Would need to track cache hits/misses
      avgSearchTime: 0, // Would need to track search times
    };
  }
  
  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    this.searchCache.clear();
    
    log.info('🛑 Web Search Crawler Integration shutdown complete');
  }
}

/**
 * Export singleton instance
 */
export const webSearchCrawlerIntegration = WebSearchCrawlerIntegration.getInstance();
