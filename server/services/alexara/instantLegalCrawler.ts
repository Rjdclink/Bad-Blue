/**
 * INSTANT LEGAL CRAWLER - LEXARA's External Legal Knowledge Layer
 * 
 * "LEXARA doesn't store law - she drinks and regurgitates it on demand, instantly"
 * 
 * This crawler retrieves law at instant speed from:
 * - Government sites (congress.gov, ecfr.gov, supremecourt.gov)
 * - Legal APIs (CourtListener, Casetext, FastCase)
 * - Legal databases (Cornell LII, Justia, FindLaw)
 * - State repositories (state legislature sites)
 * 
 * Architecture: No storage - pure RAM retrieval and immediate response
 * Attributes borrowed from existing crawlers:
 * - StarTrekCrawler: Warp speed jumps for vast territory coverage
 * - BirdOfPreyCrawler: Stealth cloaking for undetected retrieval
 * - AdaptiveCrawler: Intelligent stopping and extraction
 * 
 * PASS 1: Core implementation with instant retrieval
 * PASS 2: Performance optimization with parallel fetching
 * PASS 3: Enhancement with fallback sources and caching layer (RAM-only)
 */

import { EventEmitter } from 'events';

// ============================================================================
// TYPES - RAM-only, no persistence
// ============================================================================

export interface LegalQuery {
  query: string;
  jurisdiction?: string; // federal, state (CA, NY, etc.)
  lawType?: 'statute' | 'case_law' | 'regulation' | 'constitution' | 'all';
  dateRange?: { start?: string; end?: string };
  maxResults?: number;
  priority?: 'instant' | 'thorough'; // instant = fastest, thorough = comprehensive
}

export interface LegalSource {
  id: string;
  name: string;
  type: 'government' | 'api' | 'database' | 'repository';
  baseUrl: string;
  endpoints: LegalEndpoint[];
  responseTime: number; // avg ms
  reliability: number; // 0-1
  priority: number; // 1-10, higher = try first
}

export interface LegalEndpoint {
  path: string;
  method: 'GET' | 'POST';
  queryParam?: string;
  headers?: Record<string, string>;
  rateLimit?: number; // requests per minute
}

export interface LegalResult {
  success: boolean;
  source: string;
  sourceType: 'government' | 'api' | 'database' | 'repository';
  retrievalTimeMs: number;
  data: LegalData[];
  rawText?: string;
  metadata: LegalMetadata;
}

export interface LegalData {
  type: 'statute' | 'case' | 'regulation' | 'constitutional' | 'citation';
  title: string;
  citation: string;
  content: string;
  excerpt?: string;
  jurisdiction: string;
  date?: string;
  relevanceScore: number; // 0-1
  url?: string;
}

export interface LegalMetadata {
  query: string;
  jurisdiction: string;
  totalResults: number;
  sourcesQueried: string[];
  sourcesResponded: string[];
  fastestSource: string;
  averageRelevance: number;
  timestamp: number;
}

export interface CrawlerStatus {
  isActive: boolean;
  totalQueries: number;
  totalResults: number;
  averageResponseTimeMs: number;
  sourceHealth: Record<string, { healthy: boolean; lastCheck: number; avgResponseMs: number }>;
  cacheSize: number; // RAM cache entries
}

// ============================================================================
// CONSTANTS - Legal Sources Configuration
// ============================================================================

const LEGAL_SOURCES: LegalSource[] = [
  // TIER 1: Government Sources (highest priority)
  {
    id: 'congress_gov',
    name: 'Congress.gov',
    type: 'government',
    baseUrl: 'https://api.congress.gov/v3',
    endpoints: [
      { path: '/bill', method: 'GET', queryParam: 'query' },
      { path: '/law', method: 'GET', queryParam: 'query' },
    ],
    responseTime: 200,
    reliability: 0.99,
    priority: 10,
  },
  {
    id: 'ecfr_gov',
    name: 'Electronic Code of Federal Regulations',
    type: 'government',
    baseUrl: 'https://www.ecfr.gov/api/versioner/v1',
    endpoints: [
      { path: '/full', method: 'GET', queryParam: 'title' },
      { path: '/titles', method: 'GET' },
    ],
    responseTime: 150,
    reliability: 0.98,
    priority: 10,
  },
  {
    id: 'supremecourt_gov',
    name: 'Supreme Court',
    type: 'government',
    baseUrl: 'https://www.supremecourt.gov',
    endpoints: [
      { path: '/opinions/opinions.aspx', method: 'GET' },
      { path: '/oral_arguments/argument_transcript', method: 'GET' },
    ],
    responseTime: 300,
    reliability: 0.97,
    priority: 9,
  },
  {
    id: 'uscourts_gov',
    name: 'US Courts',
    type: 'government',
    baseUrl: 'https://www.uscourts.gov',
    endpoints: [
      { path: '/courts/court-records', method: 'GET' },
    ],
    responseTime: 250,
    reliability: 0.96,
    priority: 9,
  },
  {
    id: 'govinfo',
    name: 'GovInfo',
    type: 'government',
    baseUrl: 'https://api.govinfo.gov',
    endpoints: [
      { path: '/collections', method: 'GET' },
      { path: '/packages', method: 'GET' },
    ],
    responseTime: 180,
    reliability: 0.98,
    priority: 10,
  },

  // TIER 2: Legal APIs (high priority)
  {
    id: 'courtlistener',
    name: 'CourtListener',
    type: 'api',
    baseUrl: 'https://www.courtlistener.com/api/rest/v3',
    endpoints: [
      { path: '/search/', method: 'GET', queryParam: 'q' },
      { path: '/opinions/', method: 'GET' },
      { path: '/dockets/', method: 'GET' },
    ],
    responseTime: 150,
    reliability: 0.95,
    priority: 8,
  },
  {
    id: 'case_law_access',
    name: 'Case Law Access Project',
    type: 'api',
    baseUrl: 'https://api.case.law/v1',
    endpoints: [
      { path: '/cases/', method: 'GET', queryParam: 'search' },
      { path: '/courts/', method: 'GET' },
    ],
    responseTime: 200,
    reliability: 0.94,
    priority: 8,
  },

  // TIER 3: Legal Databases (medium priority)
  {
    id: 'cornell_lii',
    name: 'Cornell Legal Information Institute',
    type: 'database',
    baseUrl: 'https://www.law.cornell.edu',
    endpoints: [
      { path: '/uscode/text', method: 'GET' },
      { path: '/cfr', method: 'GET' },
      { path: '/supremecourt/text', method: 'GET' },
    ],
    responseTime: 250,
    reliability: 0.96,
    priority: 7,
  },
  {
    id: 'justia',
    name: 'Justia',
    type: 'database',
    baseUrl: 'https://law.justia.com',
    endpoints: [
      { path: '/cases', method: 'GET' },
      { path: '/codes', method: 'GET' },
    ],
    responseTime: 200,
    reliability: 0.93,
    priority: 7,
  },
  {
    id: 'findlaw',
    name: 'FindLaw',
    type: 'database',
    baseUrl: 'https://caselaw.findlaw.com',
    endpoints: [
      { path: '/court', method: 'GET' },
      { path: '/summary', method: 'GET' },
    ],
    responseTime: 220,
    reliability: 0.92,
    priority: 6,
  },

  // TIER 4: Repositories (fallback)
  {
    id: 'oyez',
    name: 'Oyez',
    type: 'repository',
    baseUrl: 'https://api.oyez.org',
    endpoints: [
      { path: '/cases', method: 'GET' },
      { path: '/advocates', method: 'GET' },
    ],
    responseTime: 180,
    reliability: 0.91,
    priority: 5,
  },
  {
    id: 'free_law_project',
    name: 'Free Law Project',
    type: 'repository',
    baseUrl: 'https://free.law',
    endpoints: [
      { path: '/recap', method: 'GET' },
    ],
    responseTime: 250,
    reliability: 0.90,
    priority: 5,
  },
];

// State-specific sources map
const STATE_SOURCES: Record<string, LegalSource[]> = {
  CA: [
    {
      id: 'ca_legislature',
      name: 'California Legislature',
      type: 'government',
      baseUrl: 'https://leginfo.legislature.ca.gov',
      endpoints: [{ path: '/faces/codes.xhtml', method: 'GET' }],
      responseTime: 200,
      reliability: 0.95,
      priority: 10,
    },
  ],
  NY: [
    {
      id: 'ny_legislature',
      name: 'New York Legislature',
      type: 'government',
      baseUrl: 'https://www.nysenate.gov',
      endpoints: [{ path: '/legislation', method: 'GET' }],
      responseTime: 200,
      reliability: 0.95,
      priority: 10,
    },
  ],
  TX: [
    {
      id: 'tx_legislature',
      name: 'Texas Legislature',
      type: 'government',
      baseUrl: 'https://capitol.texas.gov',
      endpoints: [{ path: '/BillLookup/History.aspx', method: 'GET' }],
      responseTime: 220,
      reliability: 0.94,
      priority: 10,
    },
  ],
  FL: [
    {
      id: 'fl_legislature',
      name: 'Florida Legislature',
      type: 'government',
      baseUrl: 'https://www.flsenate.gov',
      endpoints: [{ path: '/Laws/Statutes', method: 'GET' }],
      responseTime: 210,
      reliability: 0.94,
      priority: 10,
    },
  ],
};

// ============================================================================
// RAM CACHE - Volatile, never persisted (optimized for repeated queries)
// ============================================================================

interface CacheEntry {
  query: string;
  result: LegalResult;
  timestamp: number;
  ttl: number; // milliseconds
  hits: number;
}

class RAMCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number = 1000;
  private defaultTTL: number = 5 * 60 * 1000; // 5 minutes

  private generateKey(query: LegalQuery): string {
    return `${query.query}|${query.jurisdiction || 'all'}|${query.lawType || 'all'}`;
  }

  get(query: LegalQuery): LegalResult | null {
    const key = this.generateKey(query);
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    // Check TTL
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    // Increment hits and return
    entry.hits++;
    return entry.result;
  }

  set(query: LegalQuery, result: LegalResult, ttl?: number): void {
    const key = this.generateKey(query);
    
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, {
      query: query.query,
      result,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
      hits: 0,
    });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  stats(): { size: number; hits: number; avgAge: number } {
    let totalHits = 0;
    let totalAge = 0;
    const now = Date.now();
    
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
      totalAge += now - entry.timestamp;
    }
    
    return {
      size: this.cache.size,
      hits: totalHits,
      avgAge: this.cache.size > 0 ? totalAge / this.cache.size : 0,
    };
  }
}

// ============================================================================
// INSTANT LEGAL CRAWLER CLASS
// ============================================================================

export class InstantLegalCrawler extends EventEmitter {
  private static instance: InstantLegalCrawler | null = null;
  private ramCache: RAMCache;
  private status: CrawlerStatus;
  private activeRequests: Map<string, AbortController> = new Map();
  private sourceHealthCache: Map<string, { healthy: boolean; lastCheck: number; avgResponseMs: number }> = new Map();

  // Performance tracking
  private totalQueries: number = 0;
  private totalResults: number = 0;
  private responseTimes: number[] = [];

  private constructor() {
    super();
    this.ramCache = new RAMCache();
    this.status = {
      isActive: true,
      totalQueries: 0,
      totalResults: 0,
      averageResponseTimeMs: 0,
      sourceHealth: {},
      cacheSize: 0,
    };

    // Initialize source health tracking
    for (const source of LEGAL_SOURCES) {
      this.sourceHealthCache.set(source.id, {
        healthy: true,
        lastCheck: Date.now(),
        avgResponseMs: source.responseTime,
      });
    }
  }

  static getInstance(): InstantLegalCrawler {
    if (!InstantLegalCrawler.instance) {
      InstantLegalCrawler.instance = new InstantLegalCrawler();
    }
    return InstantLegalCrawler.instance;
  }

  // ============================================================================
  // CORE RETRIEVAL - Instant law on demand
  // ============================================================================

  /**
   * WARP SPEED RETRIEVAL - Primary instant retrieval method
   * Retrieves law instantly from multiple sources in parallel
   */
  async retrieveLaw(query: LegalQuery): Promise<LegalResult> {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Check RAM cache first (PASS 3 optimization)
    const cached = this.ramCache.get(query);
    if (cached) {
      this.emit('cache:hit', { query: query.query, requestId });
      return {
        ...cached,
        retrievalTimeMs: Date.now() - startTime,
        metadata: {
          ...cached.metadata,
          fromCache: true,
        } as any,
      };
    }

    // Determine sources based on jurisdiction
    const sources = this.selectSources(query);
    
    // WARP SPEED: Parallel fetching from all sources simultaneously (PASS 2)
    const controller = new AbortController();
    this.activeRequests.set(requestId, controller);

    try {
      const results = await this.parallelFetch(sources, query, controller.signal);
      const combinedResult = this.combineResults(results, query, startTime);
      
      // Cache in RAM (never persisted)
      this.ramCache.set(query, combinedResult);
      
      // Update stats
      this.totalQueries++;
      this.totalResults += combinedResult.data.length;
      this.responseTimes.push(combinedResult.retrievalTimeMs);
      if (this.responseTimes.length > 1000) this.responseTimes.shift();

      this.emit('retrieval:complete', {
        requestId,
        query: query.query,
        resultCount: combinedResult.data.length,
        timeMs: combinedResult.retrievalTimeMs,
      });

      return combinedResult;
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * STEALTH RETRIEVAL - Uses cloaking patterns from BirdOfPreyCrawler
   * For sensitive queries that need low profile
   */
  async stealthRetrieveLaw(query: LegalQuery): Promise<LegalResult> {
    const startTime = Date.now();
    
    // Stealth pattern: Sequential with random delays (like BirdOfPreyCrawler cloaking)
    const sources = this.selectSources(query);
    const results: LegalResult[] = [];

    for (const source of sources.slice(0, 3)) { // Limit to reduce fingerprint
      await this.randomDelay(100, 500); // Random timing like BirdOfPreyCrawler
      
      try {
        const result = await this.fetchFromSource(source, query);
        if (result.success) {
          results.push(result);
          if (results.length >= 2) break; // Minimal footprint
        }
      } catch {
        // Silent failure - stealth mode
      }
    }

    return this.combineResults(results, query, startTime);
  }

  /**
   * THOROUGH RETRIEVAL - Comprehensive search across all sources
   * Takes longer but ensures maximum coverage
   */
  async thoroughRetrieveLaw(query: LegalQuery): Promise<LegalResult> {
    const startTime = Date.now();
    const sources = this.selectSources(query);
    
    // Sequential through all sources for completeness
    const results: LegalResult[] = [];
    
    for (const source of sources) {
      try {
        const result = await this.fetchFromSource(source, query);
        results.push(result);
      } catch (error) {
        this.emit('source:error', { sourceId: source.id, error });
      }
    }

    return this.combineResults(results, query, startTime);
  }

  // ============================================================================
  // SPECIALIZED RETRIEVERS
  // ============================================================================

  /**
   * Retrieve specific statute by citation
   */
  async retrieveStatute(citation: string, jurisdiction?: string): Promise<LegalResult> {
    return this.retrieveLaw({
      query: citation,
      jurisdiction: jurisdiction || 'federal',
      lawType: 'statute',
      priority: 'instant',
    });
  }

  /**
   * Retrieve case law by citation or name
   */
  async retrieveCaseLaw(citation: string, jurisdiction?: string): Promise<LegalResult> {
    return this.retrieveLaw({
      query: citation,
      jurisdiction: jurisdiction || 'federal',
      lawType: 'case_law',
      priority: 'instant',
    });
  }

  /**
   * Retrieve regulations (CFR, state regs)
   */
  async retrieveRegulation(citation: string, jurisdiction?: string): Promise<LegalResult> {
    return this.retrieveLaw({
      query: citation,
      jurisdiction: jurisdiction || 'federal',
      lawType: 'regulation',
      priority: 'instant',
    });
  }

  /**
   * Retrieve constitutional provisions
   */
  async retrieveConstitutional(query: string, jurisdiction?: string): Promise<LegalResult> {
    return this.retrieveLaw({
      query,
      jurisdiction: jurisdiction || 'federal',
      lawType: 'constitution',
      priority: 'instant',
    });
  }

  /**
   * Batch retrieval for multiple queries (optimized)
   */
  async batchRetrieve(queries: LegalQuery[]): Promise<LegalResult[]> {
    // PASS 2 optimization: Parallel batch processing
    const promises = queries.map(q => this.retrieveLaw(q));
    return Promise.all(promises);
  }

  // ============================================================================
  // INTERNAL METHODS
  // ============================================================================

  private selectSources(query: LegalQuery): LegalSource[] {
    let sources = [...LEGAL_SOURCES];

    // Add state-specific sources if applicable
    if (query.jurisdiction && STATE_SOURCES[query.jurisdiction]) {
      sources = [...STATE_SOURCES[query.jurisdiction], ...sources];
    }

    // Filter by law type if specified
    if (query.lawType && query.lawType !== 'all') {
      // Prioritize sources that specialize in the requested type
      sources = sources.sort((a, b) => {
        const aSpecialized = this.sourceSpecializesIn(a, query.lawType!);
        const bSpecialized = this.sourceSpecializesIn(b, query.lawType!);
        if (aSpecialized && !bSpecialized) return -1;
        if (!aSpecialized && bSpecialized) return 1;
        return b.priority - a.priority;
      });
    } else {
      // Sort by priority
      sources = sources.sort((a, b) => b.priority - a.priority);
    }

    // Filter out unhealthy sources
    sources = sources.filter(s => {
      const health = this.sourceHealthCache.get(s.id);
      return !health || health.healthy;
    });

    return sources;
  }

  private sourceSpecializesIn(source: LegalSource, lawType: string): boolean {
    switch (lawType) {
      case 'statute':
        return ['congress_gov', 'ecfr_gov', 'cornell_lii', 'govinfo'].includes(source.id);
      case 'case_law':
        return ['courtlistener', 'case_law_access', 'justia', 'oyez'].includes(source.id);
      case 'regulation':
        return ['ecfr_gov', 'govinfo', 'cornell_lii'].includes(source.id);
      case 'constitution':
        return ['cornell_lii', 'supremecourt_gov', 'justia'].includes(source.id);
      default:
        return false;
    }
  }

  private async parallelFetch(
    sources: LegalSource[],
    query: LegalQuery,
    signal: AbortSignal
  ): Promise<LegalResult[]> {
    // PASS 2: Parallel fetching with timeout
    const timeout = query.priority === 'instant' ? 3000 : 10000;
    const maxConcurrent = query.priority === 'instant' ? 5 : sources.length;

    const fetchPromises = sources.slice(0, maxConcurrent).map(async source => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        signal.addEventListener('abort', () => controller.abort());
        return await this.fetchFromSource(source, query, controller.signal);
      } catch {
        return this.createEmptyResult(source.id, source.type);
      } finally {
        clearTimeout(timeoutId);
      }
    });

    // Race against timeout for instant priority
    if (query.priority === 'instant') {
      const racePromise = new Promise<LegalResult[]>(resolve => {
        setTimeout(() => resolve([]), timeout);
      });
      
      return Promise.race([
        Promise.all(fetchPromises),
        racePromise.then(() => []),
      ]) as Promise<LegalResult[]>;
    }

    return Promise.all(fetchPromises);
  }

  private async fetchFromSource(
    source: LegalSource,
    query: LegalQuery,
    signal?: AbortSignal
  ): Promise<LegalResult> {
    const startTime = Date.now();
    const endpoint = source.endpoints[0];
    
    // Build URL with query
    let url = source.baseUrl + endpoint.path;
    if (endpoint.queryParam) {
      url += `?${endpoint.queryParam}=${encodeURIComponent(query.query)}`;
    }

    try {
      const response = await fetch(url, {
        method: endpoint.method,
        headers: {
          'User-Agent': 'LEXARA-Legal-Research/1.0',
          'Accept': 'application/json, text/html',
          ...endpoint.headers,
        },
        signal,
      });

      const responseTime = Date.now() - startTime;
      
      // Update source health
      this.updateSourceHealth(source.id, true, responseTime);

      if (!response.ok) {
        return this.createEmptyResult(source.id, source.type);
      }

      const contentType = response.headers.get('content-type') || '';
      let rawText: string;
      let data: LegalData[] = [];

      if (contentType.includes('application/json')) {
        const json = await response.json();
        rawText = JSON.stringify(json);
        data = this.parseJsonResponse(json, source, query);
      } else {
        rawText = await response.text();
        data = this.parseHtmlResponse(rawText, source, query);
      }

      return {
        success: data.length > 0,
        source: source.name,
        sourceType: source.type,
        retrievalTimeMs: responseTime,
        data,
        rawText: rawText.substring(0, 5000), // Limit for memory
        metadata: {
          query: query.query,
          jurisdiction: query.jurisdiction || 'federal',
          totalResults: data.length,
          sourcesQueried: [source.id],
          sourcesResponded: [source.id],
          fastestSource: source.id,
          averageRelevance: this.calculateAverageRelevance(data),
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      this.updateSourceHealth(source.id, false, Date.now() - startTime);
      return this.createEmptyResult(source.id, source.type);
    }
  }

  private parseJsonResponse(json: any, source: LegalSource, query: LegalQuery): LegalData[] {
    const data: LegalData[] = [];
    
    // Generic JSON parsing - adapt based on source
    const results = json.results || json.data || json.items || (Array.isArray(json) ? json : [json]);
    
    for (const item of results.slice(0, 50)) {
      const legalData: LegalData = {
        type: this.inferType(item, source),
        title: item.title || item.name || item.case_name || 'Untitled',
        citation: item.citation || item.cite || item.id || '',
        content: item.content || item.text || item.body || item.snippet || '',
        excerpt: (item.snippet || item.excerpt || item.summary || '').substring(0, 500),
        jurisdiction: query.jurisdiction || 'federal',
        date: item.date || item.date_filed || item.created_at,
        relevanceScore: this.calculateRelevance(item, query),
        url: item.url || item.resource_uri || item.link,
      };
      
      if (legalData.citation || legalData.content) {
        data.push(legalData);
      }
    }

    return data;
  }

  private parseHtmlResponse(html: string, source: LegalSource, query: LegalQuery): LegalData[] {
    const data: LegalData[] = [];
    
    // Extract text content from HTML
    const textContent = html.replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Look for legal citations in the text
    const citations = this.extractCitations(textContent);
    
    for (const citation of citations.slice(0, 20)) {
      data.push({
        type: this.inferTypeFromCitation(citation),
        title: citation.title || citation.raw,
        citation: citation.raw,
        content: this.extractContextAroundCitation(textContent, citation.raw),
        jurisdiction: query.jurisdiction || 'federal',
        relevanceScore: this.calculateTextRelevance(citation.raw, query.query),
      });
    }

    // If no citations found, create a general result
    if (data.length === 0 && textContent.length > 100) {
      data.push({
        type: 'citation',
        title: `Search result from ${source.name}`,
        citation: '',
        content: textContent.substring(0, 2000),
        jurisdiction: query.jurisdiction || 'federal',
        relevanceScore: 0.5,
        url: source.baseUrl,
      });
    }

    return data;
  }

  private extractCitations(text: string): Array<{ raw: string; title?: string; type?: string }> {
    const citations: Array<{ raw: string; title?: string; type?: string }> = [];
    
    // US Code: X U.S.C. § Y
    const uscPattern = /\d+\s+U\.?S\.?C\.?\s+§?\s*\d+/gi;
    let match;
    while ((match = uscPattern.exec(text)) !== null) {
      citations.push({ raw: match[0], type: 'statute' });
    }

    // Case citations: X v. Y, XXX U.S. XXX or XXX F.3d XXX
    const casePattern = /\w+\s+v\.\s+\w+,?\s*\d+\s+(U\.?S\.?|F\.\d+d?|S\.?\s*Ct\.?)\s+\d+/gi;
    while ((match = casePattern.exec(text)) !== null) {
      citations.push({ raw: match[0], type: 'case' });
    }

    // CFR: X C.F.R. § Y
    const cfrPattern = /\d+\s+C\.?F\.?R\.?\s+§?\s*[\d.]+/gi;
    while ((match = cfrPattern.exec(text)) !== null) {
      citations.push({ raw: match[0], type: 'regulation' });
    }

    return citations;
  }

  private extractContextAroundCitation(text: string, citation: string): string {
    const index = text.indexOf(citation);
    if (index === -1) return '';
    
    const start = Math.max(0, index - 200);
    const end = Math.min(text.length, index + citation.length + 200);
    return text.substring(start, end);
  }

  private inferType(item: any, source: LegalSource): LegalData['type'] {
    if (item.type) return item.type;
    if (source.id.includes('court') || item.case_name) return 'case';
    if (source.id.includes('cfr') || source.id.includes('ecfr')) return 'regulation';
    if (source.id.includes('code') || source.id.includes('statute')) return 'statute';
    return 'citation';
  }

  private inferTypeFromCitation(citation: { raw: string; type?: string }): LegalData['type'] {
    if (citation.type === 'statute') return 'statute';
    if (citation.type === 'case') return 'case';
    if (citation.type === 'regulation') return 'regulation';
    
    const raw = citation.raw.toLowerCase();
    if (raw.includes('u.s.c')) return 'statute';
    if (raw.includes(' v. ') || raw.includes(' v ')) return 'case';
    if (raw.includes('c.f.r')) return 'regulation';
    return 'citation';
  }

  private calculateRelevance(item: any, query: LegalQuery): number {
    const queryLower = query.query.toLowerCase();
    const titleScore = item.title?.toLowerCase().includes(queryLower) ? 0.3 : 0;
    const contentScore = item.content?.toLowerCase().includes(queryLower) ? 0.3 : 0;
    const citationScore = item.citation?.toLowerCase().includes(queryLower) ? 0.2 : 0;
    const baseScore = 0.2;
    return Math.min(1, baseScore + titleScore + contentScore + citationScore);
  }

  private calculateTextRelevance(citation: string, query: string): number {
    const citLower = citation.toLowerCase();
    const queryLower = query.toLowerCase();
    
    if (citLower.includes(queryLower)) return 0.9;
    
    // Calculate word overlap
    const citWords = new Set(citLower.split(/\s+/));
    const queryWords = queryLower.split(/\s+/);
    const overlap = queryWords.filter(w => citWords.has(w)).length;
    return Math.min(0.8, 0.3 + (overlap / queryWords.length) * 0.5);
  }

  private calculateAverageRelevance(data: LegalData[]): number {
    if (data.length === 0) return 0;
    const sum = data.reduce((acc, d) => acc + d.relevanceScore, 0);
    return sum / data.length;
  }

  private combineResults(
    results: LegalResult[],
    query: LegalQuery,
    startTime: number
  ): LegalResult {
    // Combine all data, sort by relevance
    const allData: LegalData[] = [];
    const sourcesQueried: string[] = [];
    const sourcesResponded: string[] = [];
    let fastestSource = '';
    let fastestTime = Infinity;

    for (const result of results) {
      sourcesQueried.push(result.source);
      
      if (result.success) {
        sourcesResponded.push(result.source);
        allData.push(...result.data);
        
        if (result.retrievalTimeMs < fastestTime) {
          fastestTime = result.retrievalTimeMs;
          fastestSource = result.source;
        }
      }
    }

    // Sort by relevance and deduplicate
    const sortedData = allData
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .filter((item, index, self) => 
        index === self.findIndex(t => t.citation === item.citation && item.citation !== '')
      )
      .slice(0, query.maxResults || 50);

    return {
      success: sortedData.length > 0,
      source: 'combined',
      sourceType: 'api',
      retrievalTimeMs: Date.now() - startTime,
      data: sortedData,
      metadata: {
        query: query.query,
        jurisdiction: query.jurisdiction || 'federal',
        totalResults: sortedData.length,
        sourcesQueried,
        sourcesResponded,
        fastestSource,
        averageRelevance: this.calculateAverageRelevance(sortedData),
        timestamp: Date.now(),
      },
    };
  }

  private createEmptyResult(sourceId: string, sourceType: LegalSource['type']): LegalResult {
    return {
      success: false,
      source: sourceId,
      sourceType,
      retrievalTimeMs: 0,
      data: [],
      metadata: {
        query: '',
        jurisdiction: 'federal',
        totalResults: 0,
        sourcesQueried: [sourceId],
        sourcesResponded: [],
        fastestSource: '',
        averageRelevance: 0,
        timestamp: Date.now(),
      },
    };
  }

  private updateSourceHealth(sourceId: string, success: boolean, responseMs: number): void {
    const current = this.sourceHealthCache.get(sourceId) || {
      healthy: true,
      lastCheck: Date.now(),
      avgResponseMs: responseMs,
    };

    // Rolling average for response time
    current.avgResponseMs = (current.avgResponseMs * 0.8) + (responseMs * 0.2);
    current.lastCheck = Date.now();
    
    // Mark unhealthy if response time is too high or failed
    if (!success || responseMs > 10000) {
      current.healthy = false;
    } else {
      current.healthy = true;
    }

    this.sourceHealthCache.set(sourceId, current);
  }

  private async randomDelay(min: number, max: number): Promise<void> {
    const delay = min + Math.random() * (max - min);
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  // ============================================================================
  // PUBLIC STATUS & CONTROL
  // ============================================================================

  getStatus(): CrawlerStatus {
    const avgResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0;

    const sourceHealth: Record<string, { healthy: boolean; lastCheck: number; avgResponseMs: number }> = {};
    for (const [id, health] of this.sourceHealthCache) {
      sourceHealth[id] = health;
    }

    return {
      isActive: true,
      totalQueries: this.totalQueries,
      totalResults: this.totalResults,
      averageResponseTimeMs: avgResponseTime,
      sourceHealth,
      cacheSize: this.ramCache.size(),
    };
  }

  clearCache(): void {
    this.ramCache.clear();
    this.emit('cache:cleared', { timestamp: Date.now() });
  }

  cancelAllRequests(): void {
    for (const [requestId, controller] of this.activeRequests) {
      controller.abort();
      this.activeRequests.delete(requestId);
    }
    this.emit('requests:cancelled', { timestamp: Date.now() });
  }

  static reset(): void {
    if (InstantLegalCrawler.instance) {
      InstantLegalCrawler.instance.cancelAllRequests();
      InstantLegalCrawler.instance.clearCache();
      InstantLegalCrawler.instance = null;
    }
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const getInstantLegalCrawler = (): InstantLegalCrawler => {
  return InstantLegalCrawler.getInstance();
};

export default InstantLegalCrawler;
