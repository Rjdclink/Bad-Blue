/**
 * ALEXARA - Legal Analysis Intelligence Module
 * 
 * The legal-analysis module that handles:
 * - All legal reasoning, document generation, statute/regulation synthesis
 * - Case-law analysis and legal research
 * - Controls OSINT crawlers exclusively for legal-domain information
 * - Operates within strict boundaries: NO crypto functions, NO blockchain access
 * 
 * DOMAIN RESTRICTIONS:
 * - ALEXARA cannot access crypto endpoints
 * - ALEXARA cannot initiate blockchain transactions
 * - ALEXARA is isolated to legal research and document generation only
 * - All legal OSINT data flows through ALEXARA exclusively
 * 
 * CRAWLERS:
 * - Daily research and internalization: 5 minutes per hour, 24 hours a day
 * - Collects accessible, available legal information
 * - NO access to anything involving crypto, finance, blockchain, or trading
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';

const log = createLogger('ALEXARA');

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface AlexaraConfig {
  enabled: boolean;
  crawlerIntervalMinutes: number;
  crawlerDurationMinutes: number;
  maxConcurrentResearch: number;
  legalDomains: string[];
  blockedDomains: string[];
}

export interface LegalResearchRequest {
  query: string;
  jurisdiction?: string;
  lawType?: string;
  userId?: string;
  sessionId?: string;
  context?: Record<string, unknown>;
}

export interface LegalResearchResult {
  success: boolean;
  query: string;
  findings: string;
  citations: string[];
  statutes: string[];
  precedents: string[];
  confidence: number;
  processingTimeMs: number;
  source: 'alexara';
}

export interface DocumentGenerationRequest {
  documentType: string;
  jurisdiction: string;
  context: Record<string, unknown>;
  userId?: string;
}

export interface DocumentGenerationResult {
  success: boolean;
  documentType: string;
  content: string;
  citations: string[];
  metadata: Record<string, unknown>;
}

export interface AlexaraStatus {
  isRunning: boolean;
  isResearching: boolean;
  lastCrawlTime: Date | null;
  totalResearchQueries: number;
  totalDocumentsGenerated: number;
  errorCount: number;
  uptime: number;
}

export interface CrawlerSchedule {
  enabled: boolean;
  intervalMinutes: number;
  durationMinutes: number;
  lastRun: Date | null;
  nextRun: Date | null;
}

// ============================================================================
// BLOCKED DOMAINS (Crypto, Finance, Blockchain)
// ============================================================================

const BLOCKED_DOMAINS = [
  // Crypto exchanges
  'binance.com', 'coinbase.com', 'kraken.com', 'kucoin.com', 'bybit.com',
  'okx.com', 'gate.io', 'huobi.com', 'bitfinex.com', 'gemini.com',
  // Blockchain explorers
  'etherscan.io', 'bscscan.com', 'polygonscan.com', 'arbiscan.io',
  'snowtrace.io', 'ftmscan.com', 'optimistic.etherscan.io',
  // DeFi protocols
  'uniswap.org', 'sushiswap.org', 'pancakeswap.finance', 'aave.com',
  'compound.finance', 'curve.fi', 'balancer.fi', '1inch.io',
  // Crypto data providers
  'coingecko.com', 'coinmarketcap.com', 'dextools.io', 'dexscreener.com',
  'messari.io', 'glassnode.com', 'nansen.ai', 'dune.com',
  // Blockchain networks
  'ethereum.org', 'polygon.technology', 'arbitrum.io', 'optimism.io',
  'solana.com', 'avalanche.com', 'fantom.foundation',
  // Trading platforms
  'tradingview.com', 'yahoo.com/finance', 'bloomberg.com/markets',
];

const LEGAL_DOMAINS = [
  // Legal research
  'law.justia.com', 'courtlistener.com', 'casetext.com', 'fastcase.com',
  'scholar.google.com', 'law.cornell.edu', 'oyez.org',
  // Government legal resources
  'congress.gov', 'govinfo.gov', 'ecfr.gov', 'regulations.gov',
  'supremecourt.gov', 'uscourts.gov', 'justice.gov',
  // State legal resources
  'law.com', 'findlaw.com', 'nolo.com', 'avvo.com',
  // Legal news
  'law360.com', 'lawfareblog.com', 'scotusblog.com',
];

// ============================================================================
// ALEXARA CLASS
// ============================================================================

export class Alexara extends EventEmitter {
  private static instance: Alexara | null = null;
  private config: AlexaraConfig;
  private status: AlexaraStatus;
  private crawlerSchedule: CrawlerSchedule;
  private crawlerInterval: NodeJS.Timeout | null = null;
  private startTime: Date | null = null;

  private constructor(config?: Partial<AlexaraConfig>) {
    super();
    
    this.config = {
      enabled: true,
      crawlerIntervalMinutes: 60, // Every hour
      crawlerDurationMinutes: 5, // 5 minutes per cycle
      maxConcurrentResearch: 5,
      legalDomains: LEGAL_DOMAINS,
      blockedDomains: BLOCKED_DOMAINS,
      ...config,
    };

    this.status = {
      isRunning: false,
      isResearching: false,
      lastCrawlTime: null,
      totalResearchQueries: 0,
      totalDocumentsGenerated: 0,
      errorCount: 0,
      uptime: 0,
    };

    this.crawlerSchedule = {
      enabled: true,
      intervalMinutes: this.config.crawlerIntervalMinutes,
      durationMinutes: this.config.crawlerDurationMinutes,
      lastRun: null,
      nextRun: null,
    };
  }

  /**
   * Get singleton instance of ALEXARA
   */
  static getInstance(config?: Partial<AlexaraConfig>): Alexara {
    if (!Alexara.instance) {
      Alexara.instance = new Alexara(config);
    }
    return Alexara.instance;
  }

  /**
   * Initialize and start ALEXARA
   */
  async initialize(): Promise<void> {
    if (this.status.isRunning) {
      log.warn('ALEXARA is already running');
      return;
    }

    log.info('Initializing ALEXARA - Legal Analysis Intelligence Module');
    
    this.startTime = new Date();
    this.status.isRunning = true;
    
    // Schedule legal OSINT crawlers
    if (this.config.enabled && this.crawlerSchedule.enabled) {
      this.scheduleCrawlers();
    }

    this.emit('initialized', { timestamp: new Date() });
    log.info('ALEXARA initialized successfully', {
      legalDomains: this.config.legalDomains.length,
      blockedDomains: this.config.blockedDomains.length,
    });
  }

  /**
   * Schedule legal OSINT crawlers (5 min/hour)
   */
  private scheduleCrawlers(): void {
    const intervalMs = this.config.crawlerIntervalMinutes * 60 * 1000;
    
    this.crawlerSchedule.nextRun = new Date(Date.now() + intervalMs);
    
    this.crawlerInterval = setInterval(async () => {
      await this.runCrawlerCycle();
    }, intervalMs);

    log.info('Legal OSINT crawlers scheduled', {
      intervalMinutes: this.config.crawlerIntervalMinutes,
      durationMinutes: this.config.crawlerDurationMinutes,
    });

    // Run initial crawler cycle after short delay
    setTimeout(async () => {
      await this.runCrawlerCycle();
    }, 10000);
  }

  /**
   * Run a single crawler cycle
   */
  private async runCrawlerCycle(): Promise<void> {
    if (this.status.isResearching) {
      log.debug('Crawler cycle already in progress, skipping');
      return;
    }

    this.status.isResearching = true;
    this.crawlerSchedule.lastRun = new Date();
    
    log.info('Starting legal OSINT crawler cycle');
    this.emit('crawler:started', { timestamp: new Date() });

    try {
      // Simulate legal research crawling
      // In production, this would call actual legal research APIs
      await this.performLegalCrawling();
      
      this.crawlerSchedule.nextRun = new Date(
        Date.now() + this.config.crawlerIntervalMinutes * 60 * 1000
      );
      
      log.info('Legal OSINT crawler cycle completed');
      this.emit('crawler:completed', { timestamp: new Date() });
    } catch (error) {
      this.status.errorCount++;
      log.error('Crawler cycle failed', { error });
      this.emit('crawler:error', { error, timestamp: new Date() });
    } finally {
      this.status.isResearching = false;
    }
  }

  /**
   * Perform legal crawling (internal method)
   */
  private async performLegalCrawling(): Promise<void> {
    // This method would integrate with the existing legalCrawler.ts
    // For now, it serves as a placeholder for the ALEXARA-controlled legal crawling
    
    const crawlDurationMs = this.config.crawlerDurationMinutes * 60 * 1000;
    const startTime = Date.now();
    
    // Simulate crawling for the configured duration
    while (Date.now() - startTime < crawlDurationMs) {
      // In production: crawl legal databases, case law, statutes
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    this.status.lastCrawlTime = new Date();
  }

  /**
   * Validate that a URL is not in blocked domains
   */
  validateUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.toLowerCase();
      
      // Check if domain is blocked (crypto, finance, blockchain)
      for (const blocked of this.config.blockedDomains) {
        if (domain.includes(blocked) || domain.endsWith(blocked)) {
          log.warn('ALEXARA blocked access to crypto/finance domain', { url, blocked });
          return false;
        }
      }
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Perform legal research (public API)
   */
  async performResearch(request: LegalResearchRequest): Promise<LegalResearchResult> {
    const startTime = Date.now();
    
    if (!this.status.isRunning) {
      throw new Error('ALEXARA is not running. Call initialize() first.');
    }

    log.info('Processing legal research request', { query: request.query.substring(0, 50) });
    this.status.totalResearchQueries++;

    try {
      // In production, this would call AI models and legal databases
      // For now, return a placeholder result
      const result: LegalResearchResult = {
        success: true,
        query: request.query,
        findings: `Legal analysis for: ${request.query}`,
        citations: [],
        statutes: [],
        precedents: [],
        confidence: 0.85,
        processingTimeMs: Date.now() - startTime,
        source: 'alexara',
      };

      this.emit('research:completed', { request, result });
      return result;
    } catch (error) {
      this.status.errorCount++;
      log.error('Legal research failed', { error });
      throw error;
    }
  }

  /**
   * Generate legal document (public API)
   */
  async generateDocument(request: DocumentGenerationRequest): Promise<DocumentGenerationResult> {
    if (!this.status.isRunning) {
      throw new Error('ALEXARA is not running. Call initialize() first.');
    }

    log.info('Generating legal document', { type: request.documentType });
    this.status.totalDocumentsGenerated++;

    try {
      // In production, this would use AI models for document generation
      const result: DocumentGenerationResult = {
        success: true,
        documentType: request.documentType,
        content: `Generated ${request.documentType} for ${request.jurisdiction}`,
        citations: [],
        metadata: {
          generatedAt: new Date().toISOString(),
          jurisdiction: request.jurisdiction,
          source: 'alexara',
        },
      };

      this.emit('document:generated', { request, result });
      return result;
    } catch (error) {
      this.status.errorCount++;
      log.error('Document generation failed', { error });
      throw error;
    }
  }

  /**
   * Get ALEXARA status
   */
  getStatus(): AlexaraStatus {
    return {
      ...this.status,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
    };
  }

  /**
   * Get crawler schedule
   */
  getCrawlerSchedule(): CrawlerSchedule {
    return { ...this.crawlerSchedule };
  }

  /**
   * Shutdown ALEXARA
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down ALEXARA');
    
    if (this.crawlerInterval) {
      clearInterval(this.crawlerInterval);
      this.crawlerInterval = null;
    }

    this.status.isRunning = false;
    this.status.isResearching = false;
    this.emit('shutdown', { timestamp: new Date() });
    
    log.info('ALEXARA shutdown complete');
  }

  /**
   * Reset singleton (for testing)
   */
  static reset(): void {
    if (Alexara.instance) {
      Alexara.instance.shutdown();
      Alexara.instance = null;
    }
  }
}

// Export singleton getter
export const getAlexara = (config?: Partial<AlexaraConfig>): Alexara => {
  return Alexara.getInstance(config);
};

export default Alexara;
