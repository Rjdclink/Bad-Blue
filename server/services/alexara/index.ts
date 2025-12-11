/**
 * LEXARA - Legal Expert eXamination And Resource Advisor
 * 
 * LEXARA is the primary persona; a unified legal brain that orchestrates:
 * - F.M.I. (Forensic Media Intelligence) - Internal evidence analysis engine
 * - C.A.D.E. (Case Adaptive Drafting Entity) - Internal legal drafting engine
 * - External Legal Knowledge Layer (statutes, case law, regulations)
 * 
 * Architecture:
 * - F.M.I. and C.A.D.E. are NOT standalone tools - they are internal subsystems
 * - LEXARA controls when to invoke them based on user needs
 * - All law and embeddings live in External Legal Knowledge Layer, NEVER in Supabase
 * - May store file references and draft pointers in Supabase
 * 
 * DOMAIN RESTRICTIONS:
 * - LEXARA cannot access crypto endpoints
 * - LEXARA cannot initiate blockchain transactions
 * - LEXARA is isolated to legal research and document generation only
 * 
 * Flow:
 * 1. User story/evidence comes in
 * 2. LEXARA interprets matter (jurisdiction, type, posture)
 * 3. LEXARA calls F.M.I. for evidence analysis
 * 4. LEXARA calls Legal Knowledge Layer for applicable law
 * 5. LEXARA calls C.A.D.E. for document drafting
 * 6. User sees unified LEXARA response
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import { FMI, getFMI, type EvidenceInput, type EvidenceAnalysisResult } from './fmi';
import { CADE, getCADE, type DraftRequest, type DraftResult } from './cade';
import { 
  InstantLegalCrawler, 
  getInstantLegalCrawler, 
  type LegalQuery, 
  type LegalResult,
  type LegalData 
} from './instantLegalCrawler';

const log = createLogger('LEXARA');

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
  source: 'lexara';
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

export interface LexaraStatus {
  isRunning: boolean;
  isResearching: boolean;
  lastCrawlTime: Date | null;
  totalResearchQueries: number;
  totalDocumentsGenerated: number;
  totalEvidenceAnalyses: number;
  errorCount: number;
  uptime: number;
  fmiStatus: {
    totalAnalyses: number;
    successfulAnalyses: number;
  };
  cadeStatus: {
    totalDrafts: number;
    successfulDrafts: number;
  };
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
// LEXARA CLASS - Unified Legal Brain
// ============================================================================

/**
 * LEXARA - Legal Expert eXamination And Resource Advisor
 * 
 * The primary persona that internally controls:
 * - F.M.I. (Forensic Media Intelligence) for evidence analysis
 * - C.A.D.E. (Case Adaptive Drafting Entity) for document drafting
 */
export class Lexara extends EventEmitter {
  private static instance: Lexara | null = null;
  private config: AlexaraConfig;
  private status: LexaraStatus;
  private crawlerSchedule: CrawlerSchedule;
  private crawlerInterval: NodeJS.Timeout | null = null;
  private startTime: Date | null = null;
  
  // Internal subsystems
  private fmi: FMI;
  private cade: CADE;
  private legalCrawler: InstantLegalCrawler;

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
      totalEvidenceAnalyses: 0,
      errorCount: 0,
      uptime: 0,
      fmiStatus: { totalAnalyses: 0, successfulAnalyses: 0 },
      cadeStatus: { totalDrafts: 0, successfulDrafts: 0 },
    };

    this.crawlerSchedule = {
      enabled: true,
      intervalMinutes: this.config.crawlerIntervalMinutes,
      durationMinutes: this.config.crawlerDurationMinutes,
      lastRun: null,
      nextRun: null,
    };

    // Initialize internal subsystems
    this.fmi = getFMI();
    this.cade = getCADE();
    this.legalCrawler = getInstantLegalCrawler();
  }

  /**
   * Get singleton instance of LEXARA
   */
  static getInstance(config?: Partial<AlexaraConfig>): Lexara {
    if (!Lexara.instance) {
      Lexara.instance = new Lexara(config);
    }
    return Lexara.instance;
  }

  /**
   * Initialize and start LEXARA
   */
  async initialize(): Promise<void> {
    if (this.status.isRunning) {
      log.warn('LEXARA is already running');
      return;
    }

    log.info('Initializing LEXARA - Legal Expert eXamination And Resource Advisor');
    log.info('Internal subsystems: F.M.I. (Forensic Media Intelligence), C.A.D.E. (Case Adaptive Drafting Entity)');
    
    this.startTime = new Date();
    this.status.isRunning = true;
    
    // Schedule legal OSINT crawlers
    if (this.config.enabled && this.crawlerSchedule.enabled) {
      this.scheduleCrawlers();
    }

    this.emit('initialized', { timestamp: new Date() });
    log.info('LEXARA initialized successfully', {
      legalDomains: this.config.legalDomains.length,
      blockedDomains: this.config.blockedDomains.length,
      fmiReady: this.fmi.getStatus().isReady,
      cadeReady: this.cade.getStatus().isReady,
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
      throw new Error('LEXARA is not running. Call initialize() first.');
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
        source: 'lexara',
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
   * Routes through C.A.D.E. internally
   */
  async generateDocument(request: DocumentGenerationRequest): Promise<DocumentGenerationResult> {
    if (!this.status.isRunning) {
      throw new Error('LEXARA is not running. Call initialize() first.');
    }

    log.info('Generating legal document via C.A.D.E.', { type: request.documentType });
    this.status.totalDocumentsGenerated++;

    try {
      // Route through C.A.D.E. for document drafting
      const draftRequest: DraftRequest = {
        jurisdiction: request.jurisdiction,
        matterType: request.context.matterType as string || 'general',
        proceduralStage: request.context.proceduralStage as any || 'pre_litigation',
        userGoal: request.context.userGoal as string || 'Generate document',
        factsSummary: request.context.factsSummary as string || '',
        tonePreference: request.context.tone as any || 'balanced',
        documentType: request.documentType as any,
        userName: request.context.userName as string,
      };

      const draftResult = await this.cade.draftDocument(draftRequest);
      
      // Update CADE status
      const cadeStatus = this.cade.getStatus();
      this.status.cadeStatus = {
        totalDrafts: cadeStatus.totalDrafts,
        successfulDrafts: cadeStatus.successfulDrafts,
      };

      const result: DocumentGenerationResult = {
        success: draftResult.success,
        documentType: request.documentType,
        content: draftResult.draftText,
        citations: draftResult.citationsUsed,
        metadata: {
          generatedAt: new Date().toISOString(),
          jurisdiction: request.jurisdiction,
          source: 'lexara-cade',
          draftId: draftResult.draftId,
          wordCount: draftResult.wordCount,
          confidence: draftResult.confidence,
          filingGuidance: draftResult.optionalFilingGuidance,
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
   * Analyze evidence (routes through F.M.I. internally)
   * This is the primary method for evidence upload/camera capture
   */
  async analyzeEvidence(input: EvidenceInput): Promise<EvidenceAnalysisResult> {
    if (!this.status.isRunning) {
      throw new Error('LEXARA is not running. Call initialize() first.');
    }

    log.info('Analyzing evidence via F.M.I.', { 
      hasFile: !!input.fileData, 
      hasCamera: !!(input.cameraCapture && input.cameraCapture.length > 0) 
    });
    this.status.totalEvidenceAnalyses++;

    try {
      // Route through F.M.I. for evidence analysis
      const result = await this.fmi.analyzeEvidence(input);

      // Update FMI status
      const fmiStatus = this.fmi.getStatus();
      this.status.fmiStatus = {
        totalAnalyses: fmiStatus.totalAnalyses,
        successfulAnalyses: fmiStatus.successfulAnalyses,
      };

      this.emit('evidence:analyzed', { input: { ...input, fileData: '[REDACTED]' }, result });
      return result;
    } catch (error) {
      this.status.errorCount++;
      log.error('Evidence analysis failed', { error });
      throw error;
    }
  }

  // ============================================================================
  // INSTANT LAW RETRIEVAL - "LEXARA drinks and regurgitates law on demand"
  // ============================================================================

  /**
   * Retrieve law instantly - primary method for on-demand legal knowledge
   * LEXARA doesn't store law; she retrieves it instantly from external sources
   */
  async retrieveLawInstantly(query: string, options?: {
    jurisdiction?: string;
    lawType?: 'statute' | 'case_law' | 'regulation' | 'constitution' | 'all';
    priority?: 'instant' | 'thorough';
  }): Promise<LegalResult> {
    if (!this.status.isRunning) {
      throw new Error('LEXARA is not running. Call initialize() first.');
    }

    log.info('Retrieving law instantly', { query: query.substring(0, 50), jurisdiction: options?.jurisdiction });

    const legalQuery: LegalQuery = {
      query,
      jurisdiction: options?.jurisdiction,
      lawType: options?.lawType || 'all',
      priority: options?.priority || 'instant',
    };

    try {
      const result = await this.legalCrawler.retrieveLaw(legalQuery);
      
      this.emit('law:retrieved', { 
        query: query.substring(0, 50), 
        resultsCount: result.data.length,
        timeMs: result.retrievalTimeMs 
      });

      return result;
    } catch (error) {
      this.status.errorCount++;
      log.error('Law retrieval failed', { error });
      throw error;
    }
  }

  /**
   * Retrieve specific statute by citation
   */
  async retrieveStatute(citation: string, jurisdiction?: string): Promise<LegalResult> {
    return this.legalCrawler.retrieveStatute(citation, jurisdiction);
  }

  /**
   * Retrieve case law by citation or name
   */
  async retrieveCaseLaw(citation: string, jurisdiction?: string): Promise<LegalResult> {
    return this.legalCrawler.retrieveCaseLaw(citation, jurisdiction);
  }

  /**
   * Retrieve regulations (CFR, state regs)
   */
  async retrieveRegulation(citation: string, jurisdiction?: string): Promise<LegalResult> {
    return this.legalCrawler.retrieveRegulation(citation, jurisdiction);
  }

  /**
   * Retrieve constitutional provisions
   */
  async retrieveConstitutional(query: string, jurisdiction?: string): Promise<LegalResult> {
    return this.legalCrawler.retrieveConstitutional(query, jurisdiction);
  }

  /**
   * Batch retrieve multiple legal queries (optimized parallel processing)
   */
  async batchRetrieveLaw(queries: Array<{
    query: string;
    jurisdiction?: string;
    lawType?: 'statute' | 'case_law' | 'regulation' | 'constitution' | 'all';
  }>): Promise<LegalResult[]> {
    const legalQueries: LegalQuery[] = queries.map(q => ({
      query: q.query,
      jurisdiction: q.jurisdiction,
      lawType: q.lawType || 'all',
      priority: 'instant' as const,
    }));

    return this.legalCrawler.batchRetrieve(legalQueries);
  }

  /**
   * Stealth law retrieval - low profile for sensitive queries
   */
  async stealthRetrieveLaw(query: string, options?: {
    jurisdiction?: string;
    lawType?: 'statute' | 'case_law' | 'regulation' | 'constitution' | 'all';
  }): Promise<LegalResult> {
    const legalQuery: LegalQuery = {
      query,
      jurisdiction: options?.jurisdiction,
      lawType: options?.lawType || 'all',
      priority: 'instant',
    };

    return this.legalCrawler.stealthRetrieveLaw(legalQuery);
  }

  /**
   * Get legal crawler status
   */
  getLegalCrawlerStatus() {
    return this.legalCrawler.getStatus();
  }

  // ============================================================================
  // ENHANCED ORCHESTRATION WITH INSTANT LAW
  // ============================================================================

  /**
   * Draft legal document with evidence analysis
   * Full LEXARA orchestration: F.M.I. → Legal Knowledge → C.A.D.E.
   */
  async processAndDraft(params: {
    evidence?: EvidenceInput[];
    situation: string;
    jurisdiction: string;
    matterType: string;
    userGoal: string;
    documentType: string;
    tone?: string;
    userName?: string;
    retrieveLaw?: boolean; // New: automatically retrieve relevant law
  }): Promise<{
    evidenceResults: EvidenceAnalysisResult[];
    legalResults?: LegalResult;
    draftResult: DraftResult;
  }> {
    if (!this.status.isRunning) {
      throw new Error('LEXARA is not running. Call initialize() first.');
    }

    log.info('Full LEXARA orchestration: F.M.I. → Legal Knowledge → C.A.D.E.', { matterType: params.matterType });

    // Step 1: Analyze all evidence through F.M.I.
    const evidenceResults: EvidenceAnalysisResult[] = [];
    if (params.evidence && params.evidence.length > 0) {
      for (const evidence of params.evidence) {
        const result = await this.analyzeEvidence({
          ...evidence,
          jurisdiction: params.jurisdiction,
          matterType: params.matterType,
        });
        evidenceResults.push(result);
      }
    }

    // Step 2: Retrieve relevant law instantly (LEXARA drinks law on demand)
    let legalResults: LegalResult | undefined;
    if (params.retrieveLaw !== false) {
      try {
        legalResults = await this.retrieveLawInstantly(
          `${params.matterType} ${params.userGoal} ${params.situation.substring(0, 100)}`,
          {
            jurisdiction: params.jurisdiction,
            lawType: 'all',
            priority: 'instant',
          }
        );
        log.info('Retrieved relevant law for draft', { 
          resultsCount: legalResults.data.length,
          timeMs: legalResults.retrievalTimeMs 
        });
      } catch (error) {
        log.warn('Law retrieval failed, continuing without', { error });
      }
    }

    // Step 3: Build draft request with evidence analysis and law snippets
    const lawSnippets = legalResults?.data.map(d => ({
      citation: d.citation,
      text: d.excerpt || d.content.substring(0, 500),
      relevance: d.relevanceScore,
      source: legalResults?.source || 'instant-legal-crawler',
    })) || [];

    const draftRequest: DraftRequest = {
      jurisdiction: params.jurisdiction,
      matterType: params.matterType,
      proceduralStage: 'pre_litigation',
      userGoal: params.userGoal,
      factsSummary: params.situation,
      evidenceAnalysis: evidenceResults,
      lawSnippets, // Include retrieved law
      tonePreference: (params.tone as any) || 'balanced',
      documentType: params.documentType as any,
      userName: params.userName,
    };

    // Step 4: Generate document through C.A.D.E.
    const draftResult = await this.cade.draftDocument(draftRequest);

    // Update status
    const fmiStatus = this.fmi.getStatus();
    const cadeStatus = this.cade.getStatus();
    this.status.fmiStatus = {
      totalAnalyses: fmiStatus.totalAnalyses,
      successfulAnalyses: fmiStatus.successfulAnalyses,
    };
    this.status.cadeStatus = {
      totalDrafts: cadeStatus.totalDrafts,
      successfulDrafts: cadeStatus.successfulDrafts,
    };

    this.emit('orchestration:completed', { 
      evidenceCount: evidenceResults.length, 
      lawCount: legalResults?.data.length || 0,
      draftId: draftResult.draftId 
    });
    
    return { evidenceResults, legalResults, draftResult };
  }

  /**
   * Get LEXARA status (includes F.M.I. and C.A.D.E. status)
   */
  getStatus(): LexaraStatus {
    const fmiStatus = this.fmi.getStatus();
    const cadeStatus = this.cade.getStatus();
    
    return {
      ...this.status,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      fmiStatus: {
        totalAnalyses: fmiStatus.totalAnalyses,
        successfulAnalyses: fmiStatus.successfulAnalyses,
      },
      cadeStatus: {
        totalDrafts: cadeStatus.totalDrafts,
        successfulDrafts: cadeStatus.successfulDrafts,
      },
    };
  }

  /**
   * Get crawler schedule
   */
  getCrawlerSchedule(): CrawlerSchedule {
    return { ...this.crawlerSchedule };
  }

  /**
   * Shutdown LEXARA
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down LEXARA and internal subsystems');
    
    if (this.crawlerInterval) {
      clearInterval(this.crawlerInterval);
      this.crawlerInterval = null;
    }

    this.status.isRunning = false;
    this.status.isResearching = false;
    this.emit('shutdown', { timestamp: new Date() });
    
    log.info('LEXARA shutdown complete');
  }

  /**
   * Reset singleton (for testing)
   */
  static async reset(): Promise<void> {
    if (Lexara.instance) {
      await Lexara.instance.shutdown();
      Lexara.instance = null;
    }
    FMI.reset();
    CADE.reset();
    InstantLegalCrawler.reset();
  }
}

// Export singleton getter
export const getLexara = (config?: Partial<AlexaraConfig>): Lexara => {
  return Lexara.getInstance(config);
};

// Backwards compatibility alias
export const getAlexara = getLexara;
export { Lexara as Alexara };

// Re-export F.M.I. and C.A.D.E. types (not instances - LEXARA controls them)
export type { EvidenceInput, EvidenceAnalysisResult } from './fmi';
export type { DraftRequest, DraftResult, DocumentDraftType, TonePreference } from './cade';

// Re-export Instant Legal Crawler types (LEXARA controls it)
export type { LegalQuery, LegalResult, LegalData } from './instantLegalCrawler';

export default Lexara;
