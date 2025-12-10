/**
 * Alexara Console - Primary Interface for 4JI Brain System
 * 
 * The Alexara Console serves as the command center for interacting with
 * the 4JI dual-brain architecture (ALEXARA + CRYPTARA).
 * 
 * Features:
 * - Command-based interface with tags: [QUERY], [ANALYZE], [CRAWL], [SIMULATE], [OPTIMIZE]
 * - Brain interaction layer with context analysis, knowledge retrieval, output assembly
 * - Voice input support (speech-to-text)
 * - Crawler integration with authorization
 * - Error proofing and optimization for all outputs
 * - Comprehensive logging
 * - Access control with authentication
 */

import { EventEmitter } from 'events';
import { createLogger } from './logger';
import crypto from 'crypto';

const log = createLogger('AlexaraConsole');

// ============================================================================
// CONSTANTS
// ============================================================================

// Command tags
export const COMMAND_TAGS = {
  QUERY: '[QUERY]',
  ANALYZE: '[ANALYZE]',
  CRAWL: '[CRAWL]',
  SIMULATE: '[SIMULATE]',
  OPTIMIZE: '[OPTIMIZE]'
} as const;

export type CommandTag = typeof COMMAND_TAGS[keyof typeof COMMAND_TAGS];

// Output sources
export const OUTPUT_SOURCES = {
  LEFT_BRAIN: 'left_brain',
  RIGHT_BRAIN: 'right_brain',
  COMBINED: 'combined',
  SYSTEM: 'system'
} as const;

export type OutputSource = typeof OUTPUT_SOURCES[keyof typeof OUTPUT_SOURCES];

// Processing stages
const PROCESSING_STAGES = {
  CONTEXT_ANALYSIS: 'context_analysis',
  KNOWLEDGE_RETRIEVAL: 'knowledge_retrieval',
  LEFT_BRAIN_PROCESSING: 'left_brain_processing',
  RIGHT_BRAIN_PROCESSING: 'right_brain_processing',
  OUTPUT_ASSEMBLY: 'output_assembly',
  ERROR_PROOFING: 'error_proofing',
  OPTIMIZATION: 'optimization',
  ENHANCEMENT: 'enhancement'
} as const;

// Authentication constants
const AUTH_TOKEN_LENGTH = 64;
const SESSION_TIMEOUT_MS = 3600000; // 1 hour

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Console Command - Parsed user input
 */
export interface ConsoleCommand {
  id: string;
  tag: CommandTag;
  content: string;
  rawInput: string;
  timestamp: number;
  sessionId: string;
  source: 'text' | 'voice';
  metadata?: Record<string, unknown>;
}

/**
 * Console Output - Processed response
 */
export interface ConsoleOutput {
  id: string;
  commandId: string;
  content: string;
  source: OutputSource;
  timestamp: number;
  
  // Processing metadata
  processingStages: string[];
  processingTimeMs: number;
  
  // Quality metrics
  errorCheckStatus: 'passed' | 'warnings' | 'failed';
  optimizationApplied: boolean;
  enhancementApplied: boolean;
  
  // Brain outputs
  leftBrainOutput?: string;
  rightBrainOutput?: string;
  
  // Errors and warnings
  errors: string[];
  warnings: string[];
}

/**
 * Interaction Log Entry
 */
export interface InteractionLogEntry {
  id: string;
  timestamp: number;
  sessionId: string;
  userId: string;
  command: ConsoleCommand;
  output: ConsoleOutput;
  duration: number;
}

/**
 * Authentication Session
 */
export interface AuthSession {
  sessionId: string;
  userId: string;
  token: string;
  createdAt: number;
  expiresAt: number;
  permissions: string[];
  active: boolean;
}

/**
 * Context Analysis Result
 */
export interface ContextAnalysisResult {
  intent: string;
  entities: Array<{ type: string; value: string }>;
  constraints: string[];
  domain: 'legal' | 'crypto' | 'general' | 'mixed';
  urgency: 'low' | 'medium' | 'high';
  complexity: 'simple' | 'moderate' | 'complex';
}

/**
 * Knowledge Retrieval Result
 */
export interface KnowledgeRetrievalResult {
  relevantKnowledge: Array<{ source: string; content: string; relevance: number }>;
  suggestedCrawlers: string[];
  knowledgeGaps: string[];
  confidence: number;
}

/**
 * Output Assembly Result
 */
export interface OutputAssemblyResult {
  combinedOutput: string;
  leftBrainContribution: number;
  rightBrainContribution: number;
  confidenceScore: number;
  sources: string[];
}

/**
 * Error Proofing Result
 */
export interface ErrorProofingResult {
  passed: boolean;
  syntaxErrors: string[];
  logicErrors: string[];
  consistencyIssues: string[];
  corrections: string[];
  correctedOutput: string;
}

/**
 * Optimization Result
 */
export interface OptimizationResult {
  optimizedOutput: string;
  redundanciesRemoved: number;
  clarityScore: number;
  actionabilityScore: number;
  enhancements: string[];
}

/**
 * Crawler Request
 */
export interface CrawlerRequest {
  id: string;
  type: 'web' | 'legal_database' | 'structured_source';
  target: string;
  query: string;
  authorized: boolean;
  requestedBy: string;
  timestamp: number;
}

/**
 * Crawler Response
 */
export interface CrawlerResponse {
  requestId: string;
  success: boolean;
  data: any[];
  sanitized: boolean;
  storedInDatabase: boolean;
  errors: string[];
}

/**
 * Voice Input
 */
export interface VoiceInput {
  audioData: ArrayBuffer | null;
  transcribedText: string;
  confidence: number;
  language: string;
  duration: number;
}

/**
 * Console Configuration
 */
export interface ConsoleConfig {
  enableVoiceInput: boolean;
  enableVoiceOutput: boolean;
  maxLogEntries: number;
  sessionTimeoutMs: number;
  requireAuthentication: boolean;
  crawlerPermissions: string[];
}

// ============================================================================
// CONTEXT ANALYSIS MODULE
// ============================================================================

export class ContextAnalysisModule {
  /**
   * Analyze user input to understand intent and constraints
   */
  analyze(input: string, commandTag: CommandTag): ContextAnalysisResult {
    const lowerInput = input.toLowerCase();
    
    // Determine intent based on command tag and content
    let intent = this.determineIntent(commandTag, lowerInput);
    
    // Extract entities
    const entities = this.extractEntities(input);
    
    // Identify constraints
    const constraints = this.identifyConstraints(input);
    
    // Determine domain
    const domain = this.determineDomain(lowerInput, entities);
    
    // Assess urgency
    const urgency = this.assessUrgency(lowerInput);
    
    // Assess complexity
    const complexity = this.assessComplexity(input, entities);

    return {
      intent,
      entities,
      constraints,
      domain,
      urgency,
      complexity
    };
  }

  private determineIntent(tag: CommandTag, input: string): string {
    switch (tag) {
      case COMMAND_TAGS.QUERY:
        if (input.includes('draft')) return 'document_drafting';
        if (input.includes('explain')) return 'explanation';
        if (input.includes('find') || input.includes('search')) return 'information_retrieval';
        return 'general_query';
      
      case COMMAND_TAGS.ANALYZE:
        if (input.includes('case')) return 'case_analysis';
        if (input.includes('market')) return 'market_analysis';
        if (input.includes('risk')) return 'risk_analysis';
        return 'general_analysis';
      
      case COMMAND_TAGS.CRAWL:
        return 'data_collection';
      
      case COMMAND_TAGS.SIMULATE:
        return 'scenario_simulation';
      
      case COMMAND_TAGS.OPTIMIZE:
        return 'optimization_request';
      
      default:
        return 'unknown';
    }
  }

  private extractEntities(input: string): Array<{ type: string; value: string }> {
    const entities: Array<{ type: string; value: string }> = [];
    
    // Extract organization names (simple pattern)
    const orgPattern = /(?:against|for|with|at)\s+([A-Z][a-zA-Z\s]+(?:Inc|LLC|Corp|Ltd|Communities|Company)?)/g;
    let match;
    while ((match = orgPattern.exec(input)) !== null) {
      entities.push({ type: 'organization', value: match[1].trim() });
    }
    
    // Extract legal terms
    const legalTerms = ['complaint', 'lawsuit', 'motion', 'brief', 'petition', 'injunction'];
    for (const term of legalTerms) {
      if (input.toLowerCase().includes(term)) {
        entities.push({ type: 'legal_document', value: term });
      }
    }
    
    // Extract dates (simple pattern)
    const datePattern = /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\w+\s+\d{1,2},?\s+\d{4})\b/g;
    while ((match = datePattern.exec(input)) !== null) {
      entities.push({ type: 'date', value: match[1] });
    }
    
    return entities;
  }

  private identifyConstraints(input: string): string[] {
    const constraints: string[] = [];
    const lowerInput = input.toLowerCase();
    
    if (lowerInput.includes('urgent') || lowerInput.includes('asap')) {
      constraints.push('time_sensitive');
    }
    if (lowerInput.includes('confidential') || lowerInput.includes('private')) {
      constraints.push('confidential');
    }
    if (lowerInput.includes('formal')) {
      constraints.push('formal_tone');
    }
    if (lowerInput.includes('brief') || lowerInput.includes('concise')) {
      constraints.push('concise_output');
    }
    
    return constraints;
  }

  private determineDomain(input: string, entities: Array<{ type: string; value: string }>): 'legal' | 'crypto' | 'general' | 'mixed' {
    const hasLegalEntity = entities.some(e => e.type === 'legal_document');
    const legalKeywords = ['lawsuit', 'court', 'legal', 'attorney', 'complaint', 'defendant', 'plaintiff'];
    const cryptoKeywords = ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'token', 'defi', 'wallet'];
    
    const hasLegal = hasLegalEntity || legalKeywords.some(k => input.includes(k));
    const hasCrypto = cryptoKeywords.some(k => input.includes(k));
    
    if (hasLegal && hasCrypto) return 'mixed';
    if (hasLegal) return 'legal';
    if (hasCrypto) return 'crypto';
    return 'general';
  }

  private assessUrgency(input: string): 'low' | 'medium' | 'high' {
    if (input.includes('urgent') || input.includes('immediately') || input.includes('asap')) {
      return 'high';
    }
    if (input.includes('soon') || input.includes('today')) {
      return 'medium';
    }
    return 'low';
  }

  private assessComplexity(input: string, entities: Array<{ type: string; value: string }>): 'simple' | 'moderate' | 'complex' {
    const wordCount = input.split(/\s+/).length;
    const entityCount = entities.length;
    
    if (wordCount > 50 || entityCount > 5) return 'complex';
    if (wordCount > 20 || entityCount > 2) return 'moderate';
    return 'simple';
  }
}

// ============================================================================
// KNOWLEDGE RETRIEVAL MODULE
// ============================================================================

export class KnowledgeRetrievalModule {
  private knowledgeBase: Map<string, any> = new Map();

  /**
   * Retrieve relevant knowledge for the query
   */
  retrieve(
    context: ContextAnalysisResult,
    query: string
  ): KnowledgeRetrievalResult {
    const relevantKnowledge: Array<{ source: string; content: string; relevance: number }> = [];
    const suggestedCrawlers: string[] = [];
    const knowledgeGaps: string[] = [];
    
    // Search knowledge base based on domain
    const domainKnowledge = this.searchByDomain(context.domain);
    relevantKnowledge.push(...domainKnowledge);
    
    // Search by entities
    for (const entity of context.entities) {
      const entityKnowledge = this.searchByEntity(entity);
      relevantKnowledge.push(...entityKnowledge);
    }
    
    // Identify knowledge gaps
    if (relevantKnowledge.length === 0) {
      knowledgeGaps.push(`No existing knowledge for: ${context.intent}`);
      
      // Suggest crawlers based on domain
      if (context.domain === 'legal') {
        suggestedCrawlers.push('legal_database_crawler');
        suggestedCrawlers.push('case_law_crawler');
      } else if (context.domain === 'crypto') {
        suggestedCrawlers.push('blockchain_crawler');
        suggestedCrawlers.push('market_data_crawler');
      } else {
        suggestedCrawlers.push('web_crawler');
      }
    }
    
    // Calculate confidence
    const confidence = relevantKnowledge.length > 0
      ? Math.min(1.0, relevantKnowledge.reduce((sum, k) => sum + k.relevance, 0) / relevantKnowledge.length)
      : 0.3;

    return {
      relevantKnowledge,
      suggestedCrawlers,
      knowledgeGaps,
      confidence
    };
  }

  private searchByDomain(domain: string): Array<{ source: string; content: string; relevance: number }> {
    const results: Array<{ source: string; content: string; relevance: number }> = [];
    
    // Simulated knowledge retrieval
    if (domain === 'legal') {
      results.push({
        source: 'legal_knowledge_base',
        content: 'Legal procedures and complaint drafting guidelines available',
        relevance: 0.8
      });
    } else if (domain === 'crypto') {
      results.push({
        source: 'crypto_knowledge_base',
        content: 'Cryptocurrency market analysis tools and blockchain data available',
        relevance: 0.8
      });
    }
    
    return results;
  }

  private searchByEntity(entity: { type: string; value: string }): Array<{ source: string; content: string; relevance: number }> {
    const results: Array<{ source: string; content: string; relevance: number }> = [];
    
    // Check if we have stored knowledge about this entity
    const key = `${entity.type}:${entity.value.toLowerCase()}`;
    if (this.knowledgeBase.has(key)) {
      results.push({
        source: `entity_store:${entity.type}`,
        content: this.knowledgeBase.get(key),
        relevance: 0.9
      });
    }
    
    return results;
  }

  /**
   * Store new knowledge
   */
  storeKnowledge(key: string, content: any): void {
    this.knowledgeBase.set(key, content);
  }

  /**
   * Get knowledge base size
   */
  getKnowledgeBaseSize(): number {
    return this.knowledgeBase.size;
  }
}

// ============================================================================
// OUTPUT ASSEMBLY MODULE
// ============================================================================

export class OutputAssemblyModule {
  /**
   * Combine left brain and right brain outputs
   */
  assemble(
    leftBrainOutput: string,
    rightBrainOutput: string,
    context: ContextAnalysisResult,
    knowledge: KnowledgeRetrievalResult
  ): OutputAssemblyResult {
    // Determine contribution weights based on domain
    let leftWeight: number;
    let rightWeight: number;
    
    switch (context.domain) {
      case 'legal':
        leftWeight = 0.7;
        rightWeight = 0.3;
        break;
      case 'crypto':
        leftWeight = 0.3;
        rightWeight = 0.7;
        break;
      case 'mixed':
        leftWeight = 0.5;
        rightWeight = 0.5;
        break;
      default:
        leftWeight = 0.5;
        rightWeight = 0.5;
    }
    
    // Combine outputs
    const combinedOutput = this.combineOutputs(
      leftBrainOutput,
      rightBrainOutput,
      leftWeight,
      rightWeight,
      context
    );
    
    // Collect sources
    const sources = knowledge.relevantKnowledge.map(k => k.source);
    if (leftBrainOutput) sources.push('alexara_left_brain');
    if (rightBrainOutput) sources.push('cryptara_right_brain');
    
    // Calculate confidence
    const confidenceScore = this.calculateConfidence(
      leftBrainOutput,
      rightBrainOutput,
      knowledge.confidence
    );

    return {
      combinedOutput,
      leftBrainContribution: leftWeight,
      rightBrainContribution: rightWeight,
      confidenceScore,
      sources
    };
  }

  private combineOutputs(
    left: string,
    right: string,
    leftWeight: number,
    rightWeight: number,
    context: ContextAnalysisResult
  ): string {
    const parts: string[] = [];
    
    // Add context-appropriate header
    if (context.domain === 'legal') {
      parts.push('## Legal Analysis\n');
    } else if (context.domain === 'crypto') {
      parts.push('## Crypto Intelligence\n');
    } else {
      parts.push('## Analysis\n');
    }
    
    // Add primary output (higher weight)
    if (leftWeight >= rightWeight && left) {
      parts.push('### Primary Analysis (ALEXARA)\n');
      parts.push(left);
      parts.push('\n');
      
      if (right && rightWeight > 0.2) {
        parts.push('### Strategic Insights (CRYPTARA)\n');
        parts.push(right);
      }
    } else if (right) {
      parts.push('### Primary Analysis (CRYPTARA)\n');
      parts.push(right);
      parts.push('\n');
      
      if (left && leftWeight > 0.2) {
        parts.push('### Legal Considerations (ALEXARA)\n');
        parts.push(left);
      }
    }
    
    return parts.join('\n');
  }

  private calculateConfidence(
    left: string,
    right: string,
    knowledgeConfidence: number
  ): number {
    let confidence = knowledgeConfidence;
    
    if (left && left.length > 50) confidence += 0.1;
    if (right && right.length > 50) confidence += 0.1;
    if (left && right) confidence += 0.1;
    
    return Math.min(1.0, confidence);
  }
}

// ============================================================================
// ERROR PROOFING MODULE
// ============================================================================

export class ErrorProofingModule {
  /**
   * Check output for errors and inconsistencies
   */
  check(output: string, context: ContextAnalysisResult): ErrorProofingResult {
    const syntaxErrors: string[] = [];
    const logicErrors: string[] = [];
    const consistencyIssues: string[] = [];
    const corrections: string[] = [];
    
    let correctedOutput = output;
    
    // Syntax/grammar check
    const syntaxResult = this.checkSyntax(output);
    syntaxErrors.push(...syntaxResult.errors);
    if (syntaxResult.corrected !== output) {
      corrections.push('Syntax corrections applied');
      correctedOutput = syntaxResult.corrected;
    }
    
    // Logic consistency check
    const logicResult = this.checkLogicConsistency(correctedOutput);
    logicErrors.push(...logicResult.errors);
    
    // Cross-check with domain constraints
    const domainResult = this.checkDomainConsistency(correctedOutput, context);
    consistencyIssues.push(...domainResult.issues);
    
    // Apply any additional corrections
    if (domainResult.suggestions.length > 0) {
      corrections.push(...domainResult.suggestions);
    }
    
    const passed = syntaxErrors.length === 0 && 
                   logicErrors.length === 0 && 
                   consistencyIssues.length === 0;

    return {
      passed,
      syntaxErrors,
      logicErrors,
      consistencyIssues,
      corrections,
      correctedOutput
    };
  }

  private checkSyntax(output: string): { errors: string[]; corrected: string } {
    const errors: string[] = [];
    let corrected = output;
    
    // Check for unclosed brackets
    const brackets = { '(': ')', '[': ']', '{': '}' };
    for (const [open, close] of Object.entries(brackets)) {
      const openCount = (output.match(new RegExp('\\' + open, 'g')) || []).length;
      const closeCount = (output.match(new RegExp('\\' + close, 'g')) || []).length;
      if (openCount !== closeCount) {
        errors.push(`Unbalanced ${open}${close} brackets`);
      }
    }
    
    // Check for double spaces
    if (output.includes('  ')) {
      corrected = corrected.replace(/\s+/g, ' ');
      errors.push('Multiple consecutive spaces detected');
    }
    
    return { errors, corrected };
  }

  private checkLogicConsistency(output: string): { errors: string[] } {
    const errors: string[] = [];
    
    // Check for contradictory statements (simplified)
    if (output.includes('always') && output.includes('never')) {
      errors.push('Potential contradiction detected (always/never)');
    }
    
    return { errors };
  }

  private checkDomainConsistency(
    output: string,
    context: ContextAnalysisResult
  ): { issues: string[]; suggestions: string[] } {
    const issues: string[] = [];
    const suggestions: string[] = [];
    
    // Check domain-specific requirements
    if (context.domain === 'legal') {
      // Legal outputs should have formal language
      if (output.includes('gonna') || output.includes('wanna')) {
        issues.push('Informal language detected in legal context');
        suggestions.push('Replace informal language with formal alternatives');
      }
    }
    
    return { issues, suggestions };
  }
}

// ============================================================================
// OPTIMIZATION MODULE
// ============================================================================

export class OptimizationModule {
  /**
   * Optimize output for clarity, precision, and actionability
   */
  optimize(
    output: string,
    context: ContextAnalysisResult,
    constraints: string[]
  ): OptimizationResult {
    let optimizedOutput = output;
    const enhancements: string[] = [];
    let redundanciesRemoved = 0;
    
    // Remove redundant information
    const redundancyResult = this.removeRedundancies(optimizedOutput);
    optimizedOutput = redundancyResult.output;
    redundanciesRemoved = redundancyResult.count;
    if (redundanciesRemoved > 0) {
      enhancements.push(`Removed ${redundanciesRemoved} redundancies`);
    }
    
    // Apply conciseness if constrained
    if (constraints.includes('concise_output')) {
      optimizedOutput = this.makeConcise(optimizedOutput);
      enhancements.push('Applied conciseness optimization');
    }
    
    // Enhance readability
    optimizedOutput = this.enhanceReadability(optimizedOutput);
    enhancements.push('Enhanced readability');
    
    // Add actionable advice markers
    if (context.intent.includes('analysis') || context.intent.includes('query')) {
      optimizedOutput = this.addActionableMarkers(optimizedOutput);
      enhancements.push('Added actionable advice markers');
    }
    
    // Calculate scores
    const clarityScore = this.calculateClarityScore(optimizedOutput);
    const actionabilityScore = this.calculateActionabilityScore(optimizedOutput, context);

    return {
      optimizedOutput,
      redundanciesRemoved,
      clarityScore,
      actionabilityScore,
      enhancements
    };
  }

  private removeRedundancies(output: string): { output: string; count: number } {
    let count = 0;
    let result = output;
    
    // Remove repeated phrases
    const sentences = result.split(/[.!?]+/);
    const seen = new Set<string>();
    const unique: string[] = [];
    
    for (const sentence of sentences) {
      const normalized = sentence.trim().toLowerCase();
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        unique.push(sentence.trim());
      } else if (normalized) {
        count++;
      }
    }
    
    result = unique.join('. ');
    if (result && !result.endsWith('.')) {
      result += '.';
    }
    
    return { output: result, count };
  }

  private makeConcise(output: string): string {
    // Remove filler words
    const fillerWords = ['basically', 'actually', 'really', 'very', 'quite', 'somewhat'];
    let result = output;
    
    for (const filler of fillerWords) {
      result = result.replace(new RegExp(`\\b${filler}\\b\\s*`, 'gi'), '');
    }
    
    return result;
  }

  private enhanceReadability(output: string): string {
    let result = output;
    
    // Ensure proper capitalization after periods
    result = result.replace(/\.\s+([a-z])/g, (_, char) => `. ${char.toUpperCase()}`);
    
    // Add paragraph breaks for long content
    if (result.length > 500) {
      const sentences = result.split(/(?<=[.!?])\s+/);
      const paragraphs: string[] = [];
      let current: string[] = [];
      
      for (const sentence of sentences) {
        current.push(sentence);
        if (current.length >= 3) {
          paragraphs.push(current.join(' '));
          current = [];
        }
      }
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
      }
      
      result = paragraphs.join('\n\n');
    }
    
    return result;
  }

  private addActionableMarkers(output: string): string {
    // Add markers for actionable items
    const actionWords = ['should', 'must', 'need to', 'recommend', 'suggest'];
    let result = output;
    
    for (const word of actionWords) {
      result = result.replace(
        new RegExp(`\\b(${word})\\b`, 'gi'),
        '**$1**'
      );
    }
    
    return result;
  }

  private calculateClarityScore(output: string): number {
    const wordCount = output.split(/\s+/).length;
    const sentenceCount = (output.match(/[.!?]+/g) || []).length || 1;
    const avgSentenceLength = wordCount / sentenceCount;
    
    // Optimal sentence length is 15-20 words
    if (avgSentenceLength >= 15 && avgSentenceLength <= 20) {
      return 0.9;
    } else if (avgSentenceLength >= 10 && avgSentenceLength <= 25) {
      return 0.7;
    }
    return 0.5;
  }

  private calculateActionabilityScore(output: string, context: ContextAnalysisResult): number {
    let score = 0.5;
    
    // Check for actionable language
    const actionablePatterns = ['should', 'must', 'recommend', 'next step', 'action'];
    for (const pattern of actionablePatterns) {
      if (output.toLowerCase().includes(pattern)) {
        score += 0.1;
      }
    }
    
    return Math.min(1.0, score);
  }
}

// ============================================================================
// CRAWLER MANAGER
// ============================================================================

export class CrawlerManager {
  private authorizedUsers: Set<string> = new Set();
  private crawlerHistory: CrawlerRequest[] = [];
  private storedData: Map<string, any> = new Map();

  /**
   * Authorize a user for crawler access
   */
  authorizeUser(userId: string, permissions: string[]): void {
    if (permissions.includes('crawler_access')) {
      this.authorizedUsers.add(userId);
      log.info('User authorized for crawler access', { userId });
    }
  }

  /**
   * Check if a user is authorized
   */
  isAuthorized(userId: string): boolean {
    return this.authorizedUsers.has(userId);
  }

  /**
   * Execute a crawler request
   */
  async executeCrawl(request: CrawlerRequest): Promise<CrawlerResponse> {
    // Check authorization
    if (!this.isAuthorized(request.requestedBy)) {
      return {
        requestId: request.id,
        success: false,
        data: [],
        sanitized: false,
        storedInDatabase: false,
        errors: ['User not authorized for crawler access']
      };
    }

    this.crawlerHistory.push(request);

    try {
      // Simulate crawler execution based on type
      const data = await this.performCrawl(request);
      
      // Sanitize data
      const sanitizedData = this.sanitizeData(data);
      
      // Store in database
      const storageKey = `crawl:${request.id}:${request.type}`;
      this.storedData.set(storageKey, sanitizedData);

      log.info('Crawler execution successful', {
        requestId: request.id,
        type: request.type,
        dataCount: sanitizedData.length
      });

      return {
        requestId: request.id,
        success: true,
        data: sanitizedData,
        sanitized: true,
        storedInDatabase: true,
        errors: []
      };
    } catch (error: any) {
      log.error('Crawler execution failed', {
        requestId: request.id,
        error: error.message
      });

      return {
        requestId: request.id,
        success: false,
        data: [],
        sanitized: false,
        storedInDatabase: false,
        errors: [error.message]
      };
    }
  }

  private async performCrawl(request: CrawlerRequest): Promise<any[]> {
    // Simulated crawler - in production, this would connect to actual crawlers
    switch (request.type) {
      case 'legal_database':
        return this.simulateLegalCrawl(request.query);
      case 'web':
        return this.simulateWebCrawl(request.query);
      case 'structured_source':
        return this.simulateStructuredCrawl(request.query);
      default:
        return [];
    }
  }

  private simulateLegalCrawl(query: string): any[] {
    return [{
      source: 'legal_database',
      type: 'case_law',
      content: `Legal information related to: ${query}`,
      timestamp: Date.now()
    }];
  }

  private simulateWebCrawl(query: string): any[] {
    return [{
      source: 'web',
      type: 'webpage',
      content: `Web search results for: ${query}`,
      timestamp: Date.now()
    }];
  }

  private simulateStructuredCrawl(query: string): any[] {
    return [{
      source: 'structured',
      type: 'database',
      content: `Structured data for: ${query}`,
      timestamp: Date.now()
    }];
  }

  private sanitizeData(data: any[]): any[] {
    return data.map(item => {
      // Remove potentially harmful content
      if (typeof item.content === 'string') {
        item.content = item.content
          .replace(/<script[^>]*>.*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, '');
      }
      return item;
    });
  }

  /**
   * Get stored crawler data
   */
  getStoredData(key: string): any {
    return this.storedData.get(key);
  }

  /**
   * Get crawler history
   */
  getCrawlerHistory(): CrawlerRequest[] {
    return [...this.crawlerHistory];
  }
}

// ============================================================================
// VOICE INTERFACE
// ============================================================================

export class VoiceInterface {
  private enabled: boolean = false;

  /**
   * Initialize voice interface
   */
  initialize(): void {
    this.enabled = true;
    log.info('Voice interface initialized');
  }

  /**
   * Check if voice interface is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Process voice input (simulated - actual implementation would use Web Speech API)
   */
  async processVoiceInput(audioData: ArrayBuffer): Promise<VoiceInput> {
    // In production, this would use actual speech-to-text API
    // For now, we simulate the conversion
    
    return {
      audioData,
      transcribedText: '', // Would be populated by actual STT
      confidence: 0.0,
      language: 'en-US',
      duration: 0
    };
  }

  /**
   * Generate voice output (simulated - actual implementation would use TTS)
   */
  async generateVoiceOutput(text: string): Promise<ArrayBuffer | null> {
    // In production, this would use actual text-to-speech API
    log.debug('Voice output generated', { textLength: text.length });
    return null; // Would return audio data
  }

  /**
   * Process text from voice with appropriate command tag
   */
  processVoiceText(text: string): { tag: CommandTag; content: string } {
    const lowerText = text.toLowerCase();
    
    // Determine appropriate tag based on voice input
    if (lowerText.startsWith('analyze') || lowerText.includes('analysis')) {
      return { tag: COMMAND_TAGS.ANALYZE, content: text };
    }
    if (lowerText.startsWith('crawl') || lowerText.startsWith('search for')) {
      return { tag: COMMAND_TAGS.CRAWL, content: text };
    }
    if (lowerText.startsWith('simulate') || lowerText.includes('scenario')) {
      return { tag: COMMAND_TAGS.SIMULATE, content: text };
    }
    if (lowerText.startsWith('optimize')) {
      return { tag: COMMAND_TAGS.OPTIMIZE, content: text };
    }
    
    // Default to QUERY
    return { tag: COMMAND_TAGS.QUERY, content: text };
  }
}

// ============================================================================
// AUTHENTICATION MANAGER
// ============================================================================

export class AuthenticationManager {
  private sessions: Map<string, AuthSession> = new Map();
  private userPasswords: Map<string, string> = new Map(); // In production, use proper hashing

  /**
   * Register a user (for development/testing)
   * WARNING: Uses SHA-256 for simplicity. In production, use bcrypt/scrypt/Argon2
   */
  registerUser(userId: string, password: string): void {
    // In production: use bcrypt, scrypt, or Argon2 instead of SHA-256
    // SHA-256 is used here only for development/testing without external dependencies
    const salt = crypto.randomBytes(16).toString('hex');
    const hashedPassword = crypto.createHash('sha256').update(salt + password).digest('hex');
    this.userPasswords.set(userId, `${salt}:${hashedPassword}`);
    log.info('User registered', { userId });
  }

  /**
   * Authenticate user and create session
   */
  authenticate(userId: string, password: string, permissions: string[] = []): AuthSession | null {
    const storedValue = this.userPasswords.get(userId);
    if (!storedValue) {
      log.warn('Authentication failed - user not found', { userId });
      return null;
    }
    
    const [salt, storedHash] = storedValue.split(':');
    const hashedPassword = crypto.createHash('sha256').update(salt + password).digest('hex');
    
    if (storedHash !== hashedPassword) {
      log.warn('Authentication failed - invalid password', { userId });
      return null;
    }
    
    // Create session
    const session: AuthSession = {
      sessionId: crypto.randomBytes(16).toString('hex'),
      userId,
      token: crypto.randomBytes(AUTH_TOKEN_LENGTH / 2).toString('hex'),
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TIMEOUT_MS,
      permissions,
      active: true
    };
    
    this.sessions.set(session.sessionId, session);
    log.info('User authenticated', { userId, sessionId: session.sessionId });
    
    return session;
  }

  /**
   * Validate session token
   */
  validateSession(sessionId: string, token: string): boolean {
    const session = this.sessions.get(sessionId);
    
    if (!session) return false;
    if (!session.active) return false;
    if (session.token !== token) return false;
    if (Date.now() > session.expiresAt) {
      session.active = false;
      return false;
    }
    
    return true;
  }

  /**
   * Get session
   */
  getSession(sessionId: string): AuthSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Invalidate session
   */
  invalidateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.active = false;
      log.info('Session invalidated', { sessionId });
    }
  }

  /**
   * Check permission
   */
  hasPermission(sessionId: string, permission: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) return false;
    return session.permissions.includes(permission);
  }
}

// ============================================================================
// ALEXARA CONSOLE - MAIN CLASS
// ============================================================================

export class AlexaraConsole extends EventEmitter {
  private config: ConsoleConfig;
  private initialized: boolean = false;
  
  // Modules
  private contextAnalysis: ContextAnalysisModule;
  private knowledgeRetrieval: KnowledgeRetrievalModule;
  private outputAssembly: OutputAssemblyModule;
  private errorProofing: ErrorProofingModule;
  private optimization: OptimizationModule;
  private crawlerManager: CrawlerManager;
  private voiceInterface: VoiceInterface;
  private authManager: AuthenticationManager;
  
  // Logging
  private interactionLog: InteractionLogEntry[] = [];
  
  // Brain connections (would be connected to actual brain modules)
  private leftBrainConnected: boolean = false;
  private rightBrainConnected: boolean = false;

  constructor(config?: Partial<ConsoleConfig>) {
    super();
    
    this.config = {
      enableVoiceInput: false,
      enableVoiceOutput: false,
      maxLogEntries: 10000,
      sessionTimeoutMs: SESSION_TIMEOUT_MS,
      requireAuthentication: true,
      crawlerPermissions: ['web', 'legal_database', 'structured_source'],
      ...config
    };
    
    // Initialize modules
    this.contextAnalysis = new ContextAnalysisModule();
    this.knowledgeRetrieval = new KnowledgeRetrievalModule();
    this.outputAssembly = new OutputAssemblyModule();
    this.errorProofing = new ErrorProofingModule();
    this.optimization = new OptimizationModule();
    this.crawlerManager = new CrawlerManager();
    this.voiceInterface = new VoiceInterface();
    this.authManager = new AuthenticationManager();
  }

  /**
   * Initialize the console
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    log.info('Initializing Alexara Console...');
    
    // Initialize voice interface if enabled
    if (this.config.enableVoiceInput || this.config.enableVoiceOutput) {
      this.voiceInterface.initialize();
    }
    
    // Register default admin user for development only
    // In production, use environment variables or disable this
    if (process.env.NODE_ENV !== 'production') {
      const devPassword = process.env.ALEXARA_DEV_PASSWORD || 'admin123';
      this.authManager.registerUser('admin', devPassword);
      log.warn('Development admin user registered - disable in production');
    }
    
    this.initialized = true;
    this.emit('initialized');
    log.info('Alexara Console initialized');
  }

  /**
   * Connect to brain modules
   */
  connectBrains(leftBrain: boolean, rightBrain: boolean): void {
    this.leftBrainConnected = leftBrain;
    this.rightBrainConnected = rightBrain;
    
    log.info('Brain connections updated', {
      leftBrain: this.leftBrainConnected,
      rightBrain: this.rightBrainConnected
    });
  }

  /**
   * Parse input to extract command tag and content
   */
  parseInput(input: string): { tag: CommandTag; content: string } | null {
    const trimmedInput = input.trim();
    
    for (const [, tag] of Object.entries(COMMAND_TAGS)) {
      if (trimmedInput.startsWith(tag)) {
        return {
          tag: tag as CommandTag,
          content: trimmedInput.substring(tag.length).trim()
        };
      }
    }
    
    // No tag found - treat as QUERY by default
    return {
      tag: COMMAND_TAGS.QUERY,
      content: trimmedInput
    };
  }

  /**
   * Execute a command
   */
  async executeCommand(
    rawInput: string,
    sessionId: string,
    source: 'text' | 'voice' = 'text'
  ): Promise<ConsoleOutput> {
    const startTime = Date.now();
    const commandId = crypto.randomBytes(8).toString('hex');
    const processingStages: string[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Validate session if authentication required
    if (this.config.requireAuthentication) {
      const session = this.authManager.getSession(sessionId);
      if (!session || !session.active) {
        return this.createErrorOutput(commandId, 'Authentication required', startTime);
      }
    }
    
    // Parse input
    const parsed = this.parseInput(rawInput);
    if (!parsed) {
      return this.createErrorOutput(commandId, 'Invalid command format', startTime);
    }
    
    const command: ConsoleCommand = {
      id: commandId,
      tag: parsed.tag,
      content: parsed.content,
      rawInput,
      timestamp: Date.now(),
      sessionId,
      source
    };
    
    // Step 1: Context Analysis
    processingStages.push(PROCESSING_STAGES.CONTEXT_ANALYSIS);
    const context = this.contextAnalysis.analyze(parsed.content, parsed.tag);
    
    // Step 2: Knowledge Retrieval
    processingStages.push(PROCESSING_STAGES.KNOWLEDGE_RETRIEVAL);
    const knowledge = this.knowledgeRetrieval.retrieve(context, parsed.content);
    
    // Route based on command tag
    let leftBrainOutput = '';
    let rightBrainOutput = '';
    
    switch (parsed.tag) {
      case COMMAND_TAGS.QUERY:
      case COMMAND_TAGS.ANALYZE:
        // Route to both brains
        processingStages.push(PROCESSING_STAGES.LEFT_BRAIN_PROCESSING);
        leftBrainOutput = await this.processLeftBrain(command, context);
        
        processingStages.push(PROCESSING_STAGES.RIGHT_BRAIN_PROCESSING);
        rightBrainOutput = await this.processRightBrain(command, context);
        break;
        
      case COMMAND_TAGS.CRAWL:
        // Validate permissions and execute crawler
        const session = this.authManager.getSession(sessionId);
        if (!session || !session.permissions.includes('crawler_access')) {
          errors.push('Crawler access not authorized');
        } else {
          const crawlerResult = await this.executeCrawler(command, session.userId);
          leftBrainOutput = crawlerResult;
        }
        break;
        
      case COMMAND_TAGS.SIMULATE:
        // Run simulation
        processingStages.push(PROCESSING_STAGES.LEFT_BRAIN_PROCESSING);
        leftBrainOutput = await this.runSimulation(command, context);
        break;
        
      case COMMAND_TAGS.OPTIMIZE:
        // Run enhancement and optimization
        processingStages.push(PROCESSING_STAGES.ENHANCEMENT);
        leftBrainOutput = await this.runEnhancement(command, context);
        break;
    }
    
    // Step 3: Output Assembly
    processingStages.push(PROCESSING_STAGES.OUTPUT_ASSEMBLY);
    const assembled = this.outputAssembly.assemble(
      leftBrainOutput,
      rightBrainOutput,
      context,
      knowledge
    );
    
    // Step 4: Error Proofing
    processingStages.push(PROCESSING_STAGES.ERROR_PROOFING);
    const errorChecked = this.errorProofing.check(assembled.combinedOutput, context);
    if (!errorChecked.passed) {
      warnings.push(...errorChecked.syntaxErrors);
      warnings.push(...errorChecked.logicErrors);
      warnings.push(...errorChecked.consistencyIssues);
    }
    
    // Step 5: Optimization
    processingStages.push(PROCESSING_STAGES.OPTIMIZATION);
    const optimized = this.optimization.optimize(
      errorChecked.correctedOutput,
      context,
      context.constraints
    );
    
    // Create output
    const output: ConsoleOutput = {
      id: crypto.randomBytes(8).toString('hex'),
      commandId,
      content: optimized.optimizedOutput,
      source: leftBrainOutput && rightBrainOutput ? OUTPUT_SOURCES.COMBINED
           : leftBrainOutput ? OUTPUT_SOURCES.LEFT_BRAIN
           : rightBrainOutput ? OUTPUT_SOURCES.RIGHT_BRAIN
           : OUTPUT_SOURCES.SYSTEM,
      timestamp: Date.now(),
      processingStages,
      processingTimeMs: Date.now() - startTime,
      errorCheckStatus: errorChecked.passed ? 'passed' : warnings.length > 0 ? 'warnings' : 'failed',
      optimizationApplied: true,
      enhancementApplied: optimized.enhancements.length > 0,
      leftBrainOutput: leftBrainOutput || undefined,
      rightBrainOutput: rightBrainOutput || undefined,
      errors,
      warnings
    };
    
    // Log interaction
    this.logInteraction(command, output, sessionId);
    
    // Emit event
    this.emit('command-executed', { command, output });
    
    return output;
  }

  /**
   * Process command through left brain (ALEXARA - Legal)
   */
  private async processLeftBrain(
    command: ConsoleCommand,
    context: ContextAnalysisResult
  ): Promise<string> {
    if (!this.leftBrainConnected) {
      return 'Left brain (ALEXARA) not connected. Legal analysis unavailable.';
    }
    
    // Simulated left brain processing
    // In production, this would call the actual ALEXARA module
    if (context.domain === 'legal' || context.domain === 'mixed') {
      return `Legal Analysis for: "${command.content}"\n\n` +
             `Intent: ${context.intent}\n` +
             `Entities: ${context.entities.map(e => e.value).join(', ') || 'None identified'}\n` +
             `Recommendation: Proceed with formal legal review.`;
    }
    
    return 'No legal analysis required for this query.';
  }

  /**
   * Process command through right brain (CRYPTARA - Crypto/Pattern)
   */
  private async processRightBrain(
    command: ConsoleCommand,
    context: ContextAnalysisResult
  ): Promise<string> {
    if (!this.rightBrainConnected) {
      return 'Right brain (CRYPTARA) not connected. Pattern analysis unavailable.';
    }
    
    // Simulated right brain processing
    // In production, this would call the actual CRYPTARA module
    if (context.domain === 'crypto' || context.domain === 'mixed') {
      return `Strategic Analysis for: "${command.content}"\n\n` +
             `Pattern Recognition: Active\n` +
             `Market Relevance: ${context.urgency === 'high' ? 'High priority' : 'Standard priority'}\n` +
             `Insight: Consider broader strategic implications.`;
    }
    
    return 'Strategic pattern analysis complete.';
  }

  /**
   * Execute crawler
   */
  private async executeCrawler(
    command: ConsoleCommand,
    userId: string
  ): Promise<string> {
    const request: CrawlerRequest = {
      id: crypto.randomBytes(8).toString('hex'),
      type: 'web', // Determine from command content
      target: command.content,
      query: command.content,
      authorized: true,
      requestedBy: userId,
      timestamp: Date.now()
    };
    
    const response = await this.crawlerManager.executeCrawl(request);
    
    if (response.success) {
      return `Crawler executed successfully.\n` +
             `Data collected: ${response.data.length} items\n` +
             `Stored in database: ${response.storedInDatabase}`;
    } else {
      return `Crawler execution failed: ${response.errors.join(', ')}`;
    }
  }

  /**
   * Run simulation
   */
  private async runSimulation(
    command: ConsoleCommand,
    context: ContextAnalysisResult
  ): Promise<string> {
    return `Simulation Results for: "${command.content}"\n\n` +
           `Scenario: ${context.intent}\n` +
           `Complexity: ${context.complexity}\n` +
           `Outcome Probability: Requires detailed analysis\n` +
           `Recommendation: Review multiple scenarios before proceeding.`;
  }

  /**
   * Run enhancement
   */
  private async runEnhancement(
    command: ConsoleCommand,
    context: ContextAnalysisResult
  ): Promise<string> {
    return `Enhancement Applied to: "${command.content}"\n\n` +
           `Error-proofing: Complete\n` +
           `Precision: Optimized\n` +
           `Clarity: Enhanced\n` +
           `Ready for final review.`;
  }

  /**
   * Create error output
   */
  private createErrorOutput(
    commandId: string,
    error: string,
    startTime: number
  ): ConsoleOutput {
    return {
      id: crypto.randomBytes(8).toString('hex'),
      commandId,
      content: `Error: ${error}`,
      source: OUTPUT_SOURCES.SYSTEM,
      timestamp: Date.now(),
      processingStages: [],
      processingTimeMs: Date.now() - startTime,
      errorCheckStatus: 'failed',
      optimizationApplied: false,
      enhancementApplied: false,
      errors: [error],
      warnings: []
    };
  }

  /**
   * Log interaction
   */
  private logInteraction(
    command: ConsoleCommand,
    output: ConsoleOutput,
    sessionId: string
  ): void {
    const session = this.authManager.getSession(sessionId);
    
    const entry: InteractionLogEntry = {
      id: crypto.randomBytes(8).toString('hex'),
      timestamp: Date.now(),
      sessionId,
      userId: session?.userId || 'anonymous',
      command,
      output,
      duration: output.processingTimeMs
    };
    
    this.interactionLog.push(entry);
    
    // Maintain log size limit
    while (this.interactionLog.length > this.config.maxLogEntries) {
      this.interactionLog.shift();
    }
    
    log.debug('Interaction logged', {
      commandId: command.id,
      tag: command.tag,
      duration: output.processingTimeMs
    });
  }

  /**
   * Process voice input
   */
  async processVoiceInput(audioData: ArrayBuffer, sessionId: string): Promise<ConsoleOutput> {
    if (!this.config.enableVoiceInput) {
      return this.createErrorOutput(
        crypto.randomBytes(8).toString('hex'),
        'Voice input not enabled',
        Date.now()
      );
    }
    
    // Process voice to text
    const voiceInput = await this.voiceInterface.processVoiceInput(audioData);
    
    if (!voiceInput.transcribedText) {
      return this.createErrorOutput(
        crypto.randomBytes(8).toString('hex'),
        'Could not transcribe voice input',
        Date.now()
      );
    }
    
    // Determine command tag from voice
    const processed = this.voiceInterface.processVoiceText(voiceInput.transcribedText);
    
    // Execute as command
    const rawInput = `${processed.tag} ${processed.content}`;
    return this.executeCommand(rawInput, sessionId, 'voice');
  }

  /**
   * Get interaction log
   */
  getInteractionLog(): InteractionLogEntry[] {
    return [...this.interactionLog];
  }

  /**
   * Get authentication manager
   */
  getAuthManager(): AuthenticationManager {
    return this.authManager;
  }

  /**
   * Get crawler manager
   */
  getCrawlerManager(): CrawlerManager {
    return this.crawlerManager;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Shutdown console
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Alexara Console...');
    this.initialized = false;
    log.info('Alexara Console shutdown complete');
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: AlexaraConsole | null = null;

export function getAlexaraConsole(config?: Partial<ConsoleConfig>): AlexaraConsole {
  if (!instance) {
    instance = new AlexaraConsole(config);
  }
  return instance;
}

export async function initializeAlexaraConsole(config?: Partial<ConsoleConfig>): Promise<AlexaraConsole> {
  const console = getAlexaraConsole(config);
  await console.initialize();
  return console;
}

export async function shutdownAlexaraConsole(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}

export default {
  AlexaraConsole,
  getAlexaraConsole,
  initializeAlexaraConsole,
  shutdownAlexaraConsole,
  COMMAND_TAGS,
  OUTPUT_SOURCES
};
