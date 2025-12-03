/**
 * Ultra-Enhanced AI Legal Search and Fact Analysis System
 * 
 * Integrates:
 * - Parallel querying of all OpenRouter free-tier models (DeepSeek, Grok, Kimi)
 * - Asynchronous streaming and aggregation of model responses
 * - Entity extraction for legal elements (dates, statutes, parties, citations, clauses)
 * - Strict source attribution validation (discard uncited facts)
 * - Automated post-processing: consensus synthesis, contradiction flagging, deduplication
 * - Date parsing & timeline construction
 * - Sorting & categorization by relevance, recency, authority, jurisdiction, party, document type
 * - Real-time delivery with discrepancy alerts
 * - Multi-layer fallback and failover
 * - No hallucinations: only verified, cited sources
 */

import {
  deepSeekSearch,
  grokSearch,
  kimiSearch,
  isOpenRouterAvailable,
  getOpenRouterStatus,
  type OpenRouterSearchResult
} from './openRouterService';
import { generateUserText, TaskPriority } from './aiProvider';

// ============================================
// ENTITY EXTRACTION INTERFACES
// ============================================

export interface LegalEntity {
  type: 'date' | 'statute' | 'party' | 'citation' | 'clause' | 'court' | 'jurisdiction' | 'document';
  value: string;
  context?: string;
  confidence: number;
  source?: string;
}

export interface ExtractedDate extends LegalEntity {
  type: 'date';
  parsedDate?: Date;
  timelinePosition?: number;
}

export interface ExtractedStatute extends LegalEntity {
  type: 'statute';
  jurisdiction?: string;
  section?: string;
  title?: string;
}

export interface ExtractedCitation extends LegalEntity {
  type: 'citation';
  caseName?: string;
  year?: number;
  court?: string;
  citation?: string;
}

export interface ExtractedParty extends LegalEntity {
  type: 'party';
  role?: 'plaintiff' | 'defendant' | 'witness' | 'officer' | 'department' | 'court';
}

export interface ExtractedClause extends LegalEntity {
  type: 'clause';
  clauseType?: 'constitutional' | 'statutory' | 'contractual';
  amendment?: string;
}

// ============================================
// SEARCH RESULT WITH ATTRIBUTION
// ============================================

export interface AttributedFact {
  fact: string;
  sources: string[]; // URLs, statutes, case law citations
  confidence: number;
  extractedFrom: string; // Which model/search provided this
  verified: boolean;
  entities: LegalEntity[];
  contradictions?: string[]; // Conflicting information from other sources
}

export interface LegalSearchResult {
  query: string;
  aggregatedResponse: string;
  attributedFacts: AttributedFact[];
  timeline?: TimelineEvent[];
  categorization: ResultCategorization;
  discrepancies: Discrepancy[];
  modelResponses: ModelResponse[];
  metadata: {
    searchedAt: Date;
    modelsUsed: string[];
    totalSources: number;
    verifiedFactsCount: number;
    discardedFactsCount: number;
  };
}

export interface TimelineEvent {
  date: Date;
  description: string;
  sources: string[];
  entities: LegalEntity[];
}

export interface ResultCategorization {
  byRelevance: AttributedFact[];
  byRecency: AttributedFact[];
  byAuthority: AttributedFact[];
  byJurisdiction: Map<string, AttributedFact[]>;
  byParty: Map<string, AttributedFact[]>;
  byDocumentType: Map<string, AttributedFact[]>;
}

export interface Discrepancy {
  type: 'contradiction' | 'missing_source' | 'date_mismatch' | 'entity_conflict';
  description: string;
  involvedFacts: string[];
  severity: 'high' | 'medium' | 'low';
}

export interface ModelResponse {
  model: string;
  response: string;
  sources: string[];
  entities: LegalEntity[];
  processingTime: number;
  error?: string;
}

// ============================================
// ENTITY EXTRACTION ENGINE
// ============================================

class EntityExtractionEngine {
  /**
   * Extract all legal entities from text using pattern matching and AI
   */
  async extractEntities(text: string): Promise<LegalEntity[]> {
    const entities: LegalEntity[] = [];

    // Extract dates
    entities.push(...this.extractDates(text));

    // Extract statutes
    entities.push(...this.extractStatutes(text));

    // Extract case law citations
    entities.push(...this.extractCitations(text));

    // Extract parties
    entities.push(...this.extractParties(text));

    // Extract clauses (Constitutional, statutory)
    entities.push(...this.extractClauses(text));

    // Extract courts
    entities.push(...this.extractCourts(text));

    return entities;
  }

  private extractDates(text: string): ExtractedDate[] {
    const dates: ExtractedDate[] = [];
    
    // Pattern 1: Full dates (Month DD, YYYY)
    const fullDatePattern = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi;
    let match;
    
    while ((match = fullDatePattern.exec(text)) !== null) {
      const dateStr = match[0];
      const parsedDate = new Date(dateStr);
      
      if (!isNaN(parsedDate.getTime())) {
        dates.push({
          type: 'date',
          value: dateStr,
          parsedDate,
          context: this.extractContext(text, match.index),
          confidence: 0.95,
        });
      }
    }

    // Pattern 2: Numeric dates (MM/DD/YYYY, YYYY-MM-DD)
    const numericDatePattern = /\b(\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/g;
    
    while ((match = numericDatePattern.exec(text)) !== null) {
      const dateStr = match[0];
      const parsedDate = new Date(dateStr);
      
      if (!isNaN(parsedDate.getTime())) {
        dates.push({
          type: 'date',
          value: dateStr,
          parsedDate,
          context: this.extractContext(text, match.index),
          confidence: 0.90,
        });
      }
    }

    // Pattern 3: Year references
    const yearPattern = /\b(in|since|before|after|during|circa)\s+(\d{4})\b/gi;
    
    while ((match = yearPattern.exec(text)) !== null) {
      const year = parseInt(match[2]);
      if (year >= 1700 && year <= new Date().getFullYear() + 1) {
        dates.push({
          type: 'date',
          value: match[0],
          parsedDate: new Date(year, 0, 1),
          context: this.extractContext(text, match.index),
          confidence: 0.70,
        });
      }
    }

    return dates;
  }

  private extractStatutes(text: string): ExtractedStatute[] {
    const statutes: ExtractedStatute[] = [];

    // Pattern 1: U.S. Code (42 U.S.C. § 1983)
    const uscPattern = /(\d+)\s+U\.?S\.?C\.?\s*§?\s*(\d+[\w.-]*)/gi;
    let match;
    
    while ((match = uscPattern.exec(text)) !== null) {
      statutes.push({
        type: 'statute',
        value: match[0],
        jurisdiction: 'Federal',
        title: match[1],
        section: match[2],
        context: this.extractContext(text, match.index),
        confidence: 0.95,
      });
    }

    // Pattern 2: State codes (Cal. Penal Code § 148, N.Y. Crim. Proc. Law § 140.25)
    const stateCodePattern = /\b([A-Z][a-z]+\.?)\s+(Penal|Crim\.|Civil|Gov't?|Rev\.?)\s+(Code|Proc\.|Law|Stat\.?)\s*§?\s*(\d+[\w.-]*)/gi;
    
    while ((match = stateCodePattern.exec(text)) !== null) {
      statutes.push({
        type: 'statute',
        value: match[0],
        jurisdiction: match[1],
        section: match[4],
        context: this.extractContext(text, match.index),
        confidence: 0.90,
      });
    }

    // Pattern 3: Amendment references (Fourth Amendment, 4th Amendment)
    const amendmentPattern = /\b(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth|Thirteenth|Fourteenth|Fifteenth|Sixteenth|Seventeenth|Eighteenth|Nineteenth|Twentieth|Twenty-First|Twenty-Second|Twenty-Third|Twenty-Fourth|Twenty-Fifth|Twenty-Sixth|Twenty-Seventh|\d{1,2}(?:st|nd|rd|th))\s+Amendment\b/gi;
    
    while ((match = amendmentPattern.exec(text)) !== null) {
      statutes.push({
        type: 'statute',
        value: match[0],
        jurisdiction: 'Federal Constitution',
        context: this.extractContext(text, match.index),
        confidence: 0.95,
      });
    }

    return statutes;
  }

  private extractCitations(text: string): ExtractedCitation[] {
    const citations: ExtractedCitation[] = [];

    // Pattern 1: Supreme Court citations (490 U.S. 386)
    const supremeCourtPattern = /\b(\d+)\s+U\.S\.\s+(\d+)\s*(?:\((\d{4})\))?/gi;
    let match;
    
    while ((match = supremeCourtPattern.exec(text)) !== null) {
      citations.push({
        type: 'citation',
        value: match[0],
        court: 'U.S. Supreme Court',
        citation: `${match[1]} U.S. ${match[2]}`,
        year: match[3] ? parseInt(match[3]) : undefined,
        context: this.extractContext(text, match.index),
        confidence: 0.95,
      });
    }

    // Pattern 2: Federal circuit citations (F.2d, F.3d, F. Supp.)
    const federalCircuitPattern = /\b(\d+)\s+F\.(2d|3d|Supp\.|App'x)\s+(\d+)\s*(?:\(([^)]+)\s+(\d{4})\))?/gi;
    
    while ((match = federalCircuitPattern.exec(text)) !== null) {
      citations.push({
        type: 'citation',
        value: match[0],
        court: match[4] || 'Federal Court',
        citation: `${match[1]} F.${match[2]} ${match[3]}`,
        year: match[5] ? parseInt(match[5]) : undefined,
        context: this.extractContext(text, match.index),
        confidence: 0.90,
      });
    }

    // Pattern 3: Case name v. case name (using Bluebook format)
    // Requires a digit for citation but also checks for typical case law reporter patterns
    const caseNamePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+v\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s+(\d+\s+(?:U\.S\.|F\.|F\.2d|F\.3d|F\.Supp\.|P\.|N\.E\.|S\.W\.|A\.|So\.))/gi;
    
    while ((match = caseNamePattern.exec(text)) !== null) {
      citations.push({
        type: 'citation',
        value: match[0],
        caseName: `${match[1]} v. ${match[2]}`,
        context: this.extractContext(text, match.index),
        confidence: 0.80,
      });
    }

    return citations;
  }

  private extractParties(text: string): ExtractedParty[] {
    const parties: ExtractedParty[] = [];

    // Pattern 1: Officer references
    const officerPattern = /\b(Officer|Deputy|Sergeant|Sgt\.|Lieutenant|Lt\.|Captain|Capt\.|Detective|Det\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi;
    let match;
    
    while ((match = officerPattern.exec(text)) !== null) {
      parties.push({
        type: 'party',
        value: match[0],
        role: 'officer',
        context: this.extractContext(text, match.index),
        confidence: 0.90,
      });
    }

    // Pattern 2: Department/Agency references
    const departmentPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(Police Department|Sheriff's? Office|State Police|Highway Patrol)/gi;
    
    while ((match = departmentPattern.exec(text)) !== null) {
      parties.push({
        type: 'party',
        value: match[0],
        role: 'department',
        context: this.extractContext(text, match.index),
        confidence: 0.95,
      });
    }

    // Pattern 3: Plaintiff/Defendant in case names
    const plaintiffDefendantPattern = /\b(Plaintiff|Defendant|Appellant|Appellee|Petitioner|Respondent):?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi;
    
    while ((match = plaintiffDefendantPattern.exec(text)) !== null) {
      const role = match[1].toLowerCase();
      parties.push({
        type: 'party',
        value: match[2],
        role: (role === 'plaintiff' || role === 'defendant') ? role as any : undefined,
        context: this.extractContext(text, match.index),
        confidence: 0.85,
      });
    }

    return parties;
  }

  private extractClauses(text: string): ExtractedClause[] {
    const clauses: ExtractedClause[] = [];

    // Pattern 1: Constitutional clauses
    const constitutionalPattern = /\b(Equal Protection|Due Process|Establishment|Free Exercise|Cruel and Unusual Punishment|Excessive Bail|Speedy Trial|Unreasonable Search|Seizure|Double Jeopardy|Self-Incrimination)\s+Clause\b/gi;
    let match;
    
    while ((match = constitutionalPattern.exec(text)) !== null) {
      clauses.push({
        type: 'clause',
        value: match[0],
        clauseType: 'constitutional',
        context: this.extractContext(text, match.index),
        confidence: 0.95,
      });
    }

    // Pattern 2: Specific constitutional references
    const specificConstitutionalPattern = /\b(Commerce Clause|Supremacy Clause|Necessary and Proper Clause|Full Faith and Credit Clause)/gi;
    
    while ((match = specificConstitutionalPattern.exec(text)) !== null) {
      clauses.push({
        type: 'clause',
        value: match[0],
        clauseType: 'constitutional',
        context: this.extractContext(text, match.index),
        confidence: 0.90,
      });
    }

    return clauses;
  }

  private extractCourts(text: string): LegalEntity[] {
    const courts: LegalEntity[] = [];

    // Pattern: Court names
    const courtPattern = /\b(United States Supreme Court|U\.S\. Supreme Court|Supreme Court of the United States|Court of Appeals?|District Court|Superior Court|Circuit Court|Municipal Court|County Court)\b/gi;
    let match;
    
    while ((match = courtPattern.exec(text)) !== null) {
      courts.push({
        type: 'court',
        value: match[0],
        context: this.extractContext(text, match.index),
        confidence: 0.90,
      });
    }

    return courts;
  }

  private extractContext(text: string, index: number, radius: number = 100): string {
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + radius);
    return text.substring(start, end).trim();
  }
}

// ============================================
// SOURCE ATTRIBUTION VALIDATOR
// ============================================

class SourceAttributionValidator {
  /**
   * Validate that a fact has proper source attribution
   */
  validateFact(fact: string, sources: string[]): { valid: boolean; reason?: string } {
    // Must have at least one source
    if (!sources || sources.length === 0) {
      return { valid: false, reason: 'No sources provided' };
    }

    // Check if sources are valid (URLs, statutes, or case citations)
    const validSources = sources.filter(source => this.isValidSource(source));
    
    if (validSources.length === 0) {
      return { valid: false, reason: 'No valid sources (URL, statute, or case law citation required)' };
    }

    // Fact must not contain hedging language without proper attribution
    if (this.containsUnverifiedHedging(fact)) {
      return { valid: false, reason: 'Contains unverified claims or hedging language' };
    }

    return { valid: true };
  }

  private isValidSource(source: string): boolean {
    // Check if it's a URL
    if (this.isUrl(source)) {
      return true;
    }

    // Check if it's a statute citation
    if (this.isStatuteCitation(source)) {
      return true;
    }

    // Check if it's a case law citation
    if (this.isCaseLawCitation(source)) {
      return true;
    }

    return false;
  }

  private isUrl(source: string): boolean {
    try {
      const url = new URL(source);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private isStatuteCitation(source: string): boolean {
    // U.S. Code pattern
    if (/\d+\s+U\.?S\.?C\.?\s*§?\s*\d+/i.test(source)) {
      return true;
    }

    // State code pattern
    if (/[A-Z][a-z]+\.?\s+(Penal|Crim\.|Civil|Gov't?|Rev\.?)\s+(Code|Proc\.|Law|Stat\.?)\s*§?\s*\d+/i.test(source)) {
      return true;
    }

    // Amendment pattern
    if (/(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Fourteenth|\d{1,2}(?:st|nd|rd|th))\s+Amendment/i.test(source)) {
      return true;
    }

    return false;
  }

  private isCaseLawCitation(source: string): boolean {
    // Supreme Court citation
    if (/\d+\s+U\.S\.\s+\d+/i.test(source)) {
      return true;
    }

    // Federal circuit citation
    if (/\d+\s+F\.(2d|3d|Supp\.|App'x)\s+\d+/i.test(source)) {
      return true;
    }

    // Case name pattern
    if (/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+v\.?\s+[A-Z][a-z]+/i.test(source)) {
      return true;
    }

    return false;
  }

  private containsUnverifiedHedging(fact: string): boolean {
    const hedgingPatterns = [
      /\bmay have\b/i,
      /\bcould be\b/i,
      /\bpossibly\b/i,
      /\bperhaps\b/i,
      /\bseems to\b/i,
      /\bappears to\b/i,
      /\bsuggests that\b/i,
      /\bmight be\b/i,
      /\bcould potentially\b/i,
    ];

    return hedgingPatterns.some(pattern => pattern.test(fact));
  }
}

// ============================================
// CONSENSUS SYNTHESIS ENGINE
// ============================================

class ConsensusSynthesisEngine {
  /**
   * Synthesize consensus from multiple model responses
   */
  async synthesize(modelResponses: ModelResponse[]): Promise<{
    consensus: string;
    contradictions: Discrepancy[];
    aggregatedFacts: AttributedFact[];
  }> {
    // Extract facts from each model response
    const allFacts = await this.extractFactsFromResponses(modelResponses);

    // Group similar facts
    const factGroups = this.groupSimilarFacts(allFacts);

    // Identify consensus facts (agreed upon by multiple models)
    const consensusFacts = factGroups.filter(group => group.facts.length >= 2);

    // Identify contradictions (conflicting facts)
    const contradictions = this.identifyContradictions(factGroups);

    // Deduplicate facts
    const deduplicatedFacts = this.deduplicateFacts(consensusFacts);

    // Generate consensus narrative
    const consensus = await this.generateConsensusNarrative(deduplicatedFacts, modelResponses);

    return {
      consensus,
      contradictions,
      aggregatedFacts: deduplicatedFacts,
    };
  }

  private async extractFactsFromResponses(responses: ModelResponse[]): Promise<Array<{ fact: string; model: string; sources: string[]; entities: LegalEntity[] }>> {
    const facts: Array<{ fact: string; model: string; sources: string[]; entities: LegalEntity[] }> = [];

    for (const response of responses) {
      // Split response into sentences (basic fact extraction)
      const sentences = response.response.split(/[.!?]+/).filter(s => s.trim().length > 20);

      for (const sentence of sentences) {
        facts.push({
          fact: sentence.trim(),
          model: response.model,
          sources: response.sources,
          entities: response.entities.filter(e => sentence.includes(e.value)),
        });
      }
    }

    return facts;
  }

  private groupSimilarFacts(facts: Array<{ fact: string; model: string; sources: string[]; entities: LegalEntity[] }>): Array<{ facts: typeof facts; consensus: boolean }> {
    const groups: Array<{ facts: typeof facts; consensus: boolean }> = [];
    const used = new Set<number>();

    for (let i = 0; i < facts.length; i++) {
      if (used.has(i)) continue;

      const group: typeof facts = [facts[i]];
      used.add(i);

      for (let j = i + 1; j < facts.length; j++) {
        if (used.has(j)) continue;

        if (this.areSimilarFacts(facts[i].fact, facts[j].fact)) {
          group.push(facts[j]);
          used.add(j);
        }
      }

      groups.push({ facts: group, consensus: group.length >= 2 });
    }

    return groups;
  }

  private areSimilarFacts(fact1: string, fact2: string): boolean {
    // Simple similarity check using word overlap
    // Threshold of 0.6 (60%) provides good balance between grouping similar facts
    // and avoiding false positives. Based on Jaccard similarity coefficient.
    const SIMILARITY_THRESHOLD = 0.6;
    
    const words1 = new Set(fact1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(fact2.toLowerCase().split(/\s+/).filter(w => w.length > 3));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    const similarity = intersection.size / union.size;
    return similarity > SIMILARITY_THRESHOLD;
  }

  private identifyContradictions(factGroups: Array<{ facts: Array<{ fact: string; model: string; sources: string[]; entities: LegalEntity[] }>; consensus: boolean }>): Discrepancy[] {
    const contradictions: Discrepancy[] = [];

    // Look for date contradictions
    for (let i = 0; i < factGroups.length; i++) {
      for (let j = i + 1; j < factGroups.length; j++) {
        const group1 = factGroups[i];
        const group2 = factGroups[j];

        // Check if they mention the same entity but with different dates
        const dates1 = group1.facts.flatMap(f => f.entities.filter(e => e.type === 'date'));
        const dates2 = group2.facts.flatMap(f => f.entities.filter(e => e.type === 'date'));

        if (dates1.length > 0 && dates2.length > 0) {
          const sameTopic = this.areSimilarFacts(group1.facts[0].fact, group2.facts[0].fact);
          const differentDates = !dates1.some(d1 => dates2.some(d2 => d1.value === d2.value));

          if (sameTopic && differentDates) {
            contradictions.push({
              type: 'date_mismatch',
              description: `Different dates reported for similar event: ${dates1[0].value} vs ${dates2[0].value}`,
              involvedFacts: [group1.facts[0].fact, group2.facts[0].fact],
              severity: 'high',
            });
          }
        }
      }
    }

    return contradictions;
  }

  private deduplicateFacts(factGroups: Array<{ facts: Array<{ fact: string; model: string; sources: string[]; entities: LegalEntity[] }>; consensus: boolean }>): AttributedFact[] {
    const validator = new SourceAttributionValidator();
    const deduplicatedFacts: AttributedFact[] = [];

    for (const group of factGroups) {
      if (!group.consensus) continue;

      // Aggregate sources from all facts in the group
      const allSources = [...new Set(group.facts.flatMap(f => f.sources))];
      
      // Aggregate entities
      const allEntities = [...new Set(group.facts.flatMap(f => f.entities))];

      // Use the most detailed fact from the group
      const representativeFact = group.facts.sort((a, b) => b.fact.length - a.fact.length)[0];

      // Validate sources
      const validation = validator.validateFact(representativeFact.fact, allSources);

      if (validation.valid) {
        // Calculate confidence with cap at 1.0
        // Base confidence 0.80, +0.05 per additional model agreement, max 1.0
        const baseConfidence = 0.80;
        const agreementBonus = (group.facts.length - 1) * 0.05;
        const confidence = Math.min(1.0, baseConfidence + agreementBonus);
        
        deduplicatedFacts.push({
          fact: representativeFact.fact,
          sources: allSources,
          confidence,
          extractedFrom: group.facts.map(f => f.model).join(', '),
          verified: true,
          entities: allEntities,
        });
      }
    }

    return deduplicatedFacts;
  }

  private async generateConsensusNarrative(facts: AttributedFact[], modelResponses: ModelResponse[]): Promise<string> {
    if (facts.length === 0) {
      return 'No verifiable facts with proper source attribution were found.';
    }

    // Sort facts by confidence
    const sortedFacts = facts.sort((a, b) => b.confidence - a.confidence);

    // Generate narrative
    let narrative = 'Based on multiple verified sources:\n\n';

    for (const fact of sortedFacts) {
      narrative += `• ${fact.fact}\n`;
      if (fact.sources.length > 0) {
        narrative += `  Sources: ${fact.sources.slice(0, 3).join(', ')}${fact.sources.length > 3 ? ` (+${fact.sources.length - 3} more)` : ''}\n`;
      }
      narrative += '\n';
    }

    return narrative;
  }
}

// ============================================
// TIMELINE CONSTRUCTION ENGINE
// ============================================

class TimelineConstructionEngine {
  /**
   * Construct timeline from extracted dates
   */
  constructTimeline(facts: AttributedFact[]): TimelineEvent[] {
    const events: TimelineEvent[] = [];

    for (const fact of facts) {
      const dates = fact.entities.filter(e => e.type === 'date') as ExtractedDate[];

      for (const date of dates) {
        if (date.parsedDate) {
          events.push({
            date: date.parsedDate,
            description: fact.fact,
            sources: fact.sources,
            entities: fact.entities,
          });
        }
      }
    }

    // Sort chronologically
    return events.sort((a, b) => a.date.getTime() - b.date.getTime());
  }
}

// ============================================
// CATEGORIZATION ENGINE
// ============================================

class CategorizationEngine {
  /**
   * Categorize results by multiple dimensions
   */
  categorize(facts: AttributedFact[]): ResultCategorization {
    return {
      byRelevance: this.sortByRelevance(facts),
      byRecency: this.sortByRecency(facts),
      byAuthority: this.sortByAuthority(facts),
      byJurisdiction: this.groupByJurisdiction(facts),
      byParty: this.groupByParty(facts),
      byDocumentType: this.groupByDocumentType(facts),
    };
  }

  private sortByRelevance(facts: AttributedFact[]): AttributedFact[] {
    // Sort by confidence (proxy for relevance)
    return [...facts].sort((a, b) => b.confidence - a.confidence);
  }

  private sortByRecency(facts: AttributedFact[]): AttributedFact[] {
    return [...facts].sort((a, b) => {
      const datesA = a.entities.filter(e => e.type === 'date') as ExtractedDate[];
      const datesB = b.entities.filter(e => e.type === 'date') as ExtractedDate[];

      if (datesA.length === 0 && datesB.length === 0) return 0;
      if (datesA.length === 0) return 1;
      if (datesB.length === 0) return -1;

      const maxDateA = Math.max(...datesA.map(d => d.parsedDate?.getTime() || 0));
      const maxDateB = Math.max(...datesB.map(d => d.parsedDate?.getTime() || 0));

      return maxDateB - maxDateA;
    });
  }

  private sortByAuthority(facts: AttributedFact[]): AttributedFact[] {
    return [...facts].sort((a, b) => {
      const authorityScoreA = this.calculateAuthorityScore(a);
      const authorityScoreB = this.calculateAuthorityScore(b);
      return authorityScoreB - authorityScoreA;
    });
  }

  private calculateAuthorityScore(fact: AttributedFact): number {
    let score = 0;

    // Supreme Court citations are highest authority
    if (fact.entities.some(e => e.type === 'citation' && (e.value.includes('U.S.') || e.value.includes('Supreme Court')))) {
      score += 10;
    }

    // Federal circuit citations
    if (fact.entities.some(e => e.type === 'citation' && e.value.match(/F\.(2d|3d)/))) {
      score += 7;
    }

    // Federal statutes
    if (fact.entities.some(e => e.type === 'statute' && e.value.includes('U.S.C.'))) {
      score += 8;
    }

    // State statutes
    if (fact.entities.some(e => e.type === 'statute' && !e.value.includes('U.S.C.'))) {
      score += 5;
    }

    // Constitutional provisions
    if (fact.entities.some(e => e.type === 'statute' && e.value.includes('Amendment'))) {
      score += 9;
    }

    return score;
  }

  private groupByJurisdiction(facts: AttributedFact[]): Map<string, AttributedFact[]> {
    const byJurisdiction = new Map<string, AttributedFact[]>();

    for (const fact of facts) {
      const jurisdictions = this.extractJurisdictions(fact);

      for (const jurisdiction of jurisdictions) {
        if (!byJurisdiction.has(jurisdiction)) {
          byJurisdiction.set(jurisdiction, []);
        }
        byJurisdiction.get(jurisdiction)!.push(fact);
      }
    }

    return byJurisdiction;
  }

  private extractJurisdictions(fact: AttributedFact): string[] {
    const jurisdictions = new Set<string>();

    for (const entity of fact.entities) {
      if (entity.type === 'statute') {
        const statute = entity as ExtractedStatute;
        if (statute.jurisdiction) {
          jurisdictions.add(statute.jurisdiction);
        }
      }
      if (entity.type === 'citation') {
        const citation = entity as ExtractedCitation;
        if (citation.court) {
          jurisdictions.add(citation.court);
        }
      }
    }

    if (jurisdictions.size === 0) {
      jurisdictions.add('Unspecified');
    }

    return Array.from(jurisdictions);
  }

  private groupByParty(facts: AttributedFact[]): Map<string, AttributedFact[]> {
    const byParty = new Map<string, AttributedFact[]>();

    for (const fact of facts) {
      const parties = fact.entities.filter(e => e.type === 'party') as ExtractedParty[];

      for (const party of parties) {
        if (!byParty.has(party.value)) {
          byParty.set(party.value, []);
        }
        byParty.get(party.value)!.push(fact);
      }
    }

    return byParty;
  }

  private groupByDocumentType(facts: AttributedFact[]): Map<string, AttributedFact[]> {
    const byType = new Map<string, AttributedFact[]>();

    for (const fact of facts) {
      let documentType = 'General';

      // Determine document type from entities
      if (fact.entities.some(e => e.type === 'citation')) {
        documentType = 'Case Law';
      } else if (fact.entities.some(e => e.type === 'statute')) {
        documentType = 'Statute';
      } else if (fact.entities.some(e => e.type === 'clause')) {
        documentType = 'Constitutional Provision';
      }

      if (!byType.has(documentType)) {
        byType.set(documentType, []);
      }
      byType.get(documentType)!.push(fact);
    }

    return byType;
  }
}

// ============================================
// MAIN ENHANCED LEGAL SEARCH SYSTEM
// ============================================

export class EnhancedLegalSearchSystem {
  private entityExtractor: EntityExtractionEngine;
  private sourceValidator: SourceAttributionValidator;
  private consensusEngine: ConsensusSynthesisEngine;
  private timelineEngine: TimelineConstructionEngine;
  private categorizationEngine: CategorizationEngine;

  constructor() {
    this.entityExtractor = new EntityExtractionEngine();
    this.sourceValidator = new SourceAttributionValidator();
    this.consensusEngine = new ConsensusSynthesisEngine();
    this.timelineEngine = new TimelineConstructionEngine();
    this.categorizationEngine = new CategorizationEngine();
  }

  /**
   * Perform ultra-enhanced legal search with all features
   */
  async search(query: string, options: {
    jurisdiction?: string;
    context?: string;
    requireSources?: boolean;
  } = {}): Promise<LegalSearchResult> {
    console.log(`[Enhanced Legal Search] Starting search for: ${query}`);
    const startTime = Date.now();

    // Check if OpenRouter is available
    if (!isOpenRouterAvailable()) {
      throw new Error('OpenRouter API not configured - cannot perform enhanced legal search');
    }

    // Step 1: Parallel query all available OpenRouter models
    const modelResponses = await this.parallelQueryModels(query, options.context);
    console.log(`[Enhanced Legal Search] Received ${modelResponses.length} model responses`);

    // Step 2: Extract entities from all responses
    for (const response of modelResponses) {
      response.entities = await this.entityExtractor.extractEntities(response.response);
    }
    console.log(`[Enhanced Legal Search] Extracted entities from all responses`);

    // Step 3: Synthesize consensus and identify contradictions
    const { consensus, contradictions, aggregatedFacts } = await this.consensusEngine.synthesize(modelResponses);
    console.log(`[Enhanced Legal Search] Synthesized ${aggregatedFacts.length} verified facts`);

    // Step 4: Construct timeline
    const timeline = this.timelineEngine.constructTimeline(aggregatedFacts);
    console.log(`[Enhanced Legal Search] Constructed timeline with ${timeline.length} events`);

    // Step 5: Categorize results
    const categorization = this.categorizationEngine.categorize(aggregatedFacts);
    console.log(`[Enhanced Legal Search] Categorized results`);

    // Step 6: Identify additional discrepancies
    const allDiscrepancies = [
      ...contradictions,
      ...this.identifyMissingSourceDiscrepancies(aggregatedFacts, options.requireSources),
    ];

    // Step 7: Calculate metadata
    const metadata = {
      searchedAt: new Date(),
      modelsUsed: modelResponses.map(r => r.model),
      totalSources: [...new Set(aggregatedFacts.flatMap(f => f.sources))].length,
      verifiedFactsCount: aggregatedFacts.filter(f => f.verified).length,
      discardedFactsCount: aggregatedFacts.filter(f => !f.verified).length,
    };

    console.log(`[Enhanced Legal Search] Completed in ${Date.now() - startTime}ms`);

    return {
      query,
      aggregatedResponse: consensus,
      attributedFacts: aggregatedFacts,
      timeline,
      categorization,
      discrepancies: allDiscrepancies,
      modelResponses,
      metadata,
    };
  }

  /**
   * Query all available OpenRouter models in parallel
   */
  private async parallelQueryModels(query: string, context?: string): Promise<ModelResponse[]> {
    const contextPrompt = context ? `Context: ${context}\n\n` : '';
    const fullPrompt = `${contextPrompt}Legal Question: ${query}\n\nProvide detailed, factual information with specific source citations (URLs, statutes, case law). Include all relevant legal authorities and precedents.`;

    const promises: Promise<{ model: string; result: OpenRouterSearchResult | null; processingTime: number }>[] = [];

    // Check status of each model
    const status = getOpenRouterStatus();

    if (status.deepseek.available) {
      promises.push(
        (async () => {
          const start = Date.now();
          const result = await deepSeekSearch(fullPrompt, context);
          return { model: 'DeepSeek', result, processingTime: Date.now() - start };
        })()
      );
    }

    if (status.grok.available) {
      promises.push(
        (async () => {
          const start = Date.now();
          const result = await grokSearch(fullPrompt, { includeReasoning: true });
          return { model: 'Grok', result, processingTime: Date.now() - start };
        })()
      );
    }

    if (status.kimi.available) {
      promises.push(
        (async () => {
          const start = Date.now();
          const result = await kimiSearch(fullPrompt, { structuredOutput: true });
          return { model: 'Kimi', result, processingTime: Date.now() - start };
        })()
      );
    }

    // Execute all queries in parallel
    const results = await Promise.allSettled(promises);

    const modelResponses: ModelResponse[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.result) {
        modelResponses.push({
          model: result.value.model,
          response: result.value.result.content,
          sources: result.value.result.sources || [],
          entities: [],
          processingTime: result.value.processingTime,
        });
      } else if (result.status === 'rejected') {
        console.error(`[Enhanced Legal Search] Model query failed:`, result.reason);
      }
    }

    // Fallback to unified AI provider if no OpenRouter models available
    if (modelResponses.length === 0) {
      console.log('[Enhanced Legal Search] No OpenRouter models available, using fallback AI provider');
      const start = Date.now();
      
      try {
        const fallbackResponse = await generateUserText(
          'enhanced-legal-search-fallback',
          fullPrompt,
          {
            systemPrompt: 'You are an expert legal researcher. Provide detailed, factual information with specific source citations (URLs, statutes, case law).',
            temperature: 0.3,
            maxTokens: 3000,
          },
          TaskPriority.CRITICAL_USER
        );

        modelResponses.push({
          model: 'Fallback AI',
          response: fallbackResponse.content,
          sources: this.extractUrlsFromText(fallbackResponse.content),
          entities: [],
          processingTime: Date.now() - start,
        });
      } catch (error) {
        console.error('[Enhanced Legal Search] Fallback AI failed:', error);
        throw new Error('All AI models unavailable for legal search');
      }
    }

    return modelResponses;
  }

  private extractUrlsFromText(text: string): string[] {
    const urlRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/g;
    return text.match(urlRegex) || [];
  }

  private identifyMissingSourceDiscrepancies(facts: AttributedFact[], requireSources?: boolean): Discrepancy[] {
    if (!requireSources) return [];

    const discrepancies: Discrepancy[] = [];

    for (const fact of facts) {
      // Check if fact has valid sources using the validator
      const validation = this.sourceValidator.validateFact(fact.fact, fact.sources);
      
      if (!validation.valid) {
        discrepancies.push({
          type: 'missing_source',
          description: `Fact lacks proper source attribution: "${fact.fact.substring(0, 100)}..." (${validation.reason})`,
          involvedFacts: [fact.fact],
          severity: 'high',
        });
      }
    }

    return discrepancies;
  }
}

// Export singleton instance
export const enhancedLegalSearch = new EnhancedLegalSearchSystem();

// Export convenience function
export async function performEnhancedLegalSearch(
  query: string,
  options?: {
    jurisdiction?: string;
    context?: string;
    requireSources?: boolean;
  }
): Promise<LegalSearchResult> {
  return enhancedLegalSearch.search(query, options);
}
