/**
 * NLP Text Processing Worker
 * 
 * Processes text using Node-native NLP libraries:
 * - compromise.js for entity extraction
 * - natural for tokenization and stemming
 * 
 * Extracts:
 * - Named entities (person, org, location)
 * - Keywords and topics
 * - Normalized text
 */

import compromise from 'compromise';
import natural from 'natural';
import { Worker, WorkerInput, WorkerOutput } from './workerOrchestrator';
import { logger } from '../../logger';

const { WordTokenizer, PorterStemmer } = natural;

export interface ExtractedEntity {
  type: 'person' | 'org' | 'location' | 'email' | 'phone' | 'date' | 'handle';
  value: string;
  normalizedValue: string;
  sourceText: string;
  confidence: number;
  position?: {
    start: number;
    end: number;
  };
}

export interface NLPResult {
  entities: ExtractedEntity[];
  keywords: string[];
  topics: string[];
  tokens: string[];
  normalizedText: string;
  language: string;
}

/**
 * NLP Text Processing Worker
 */
export class NLPTextWorker implements Worker {
  name = 'nlp_text_worker';
  private tokenizer = new WordTokenizer();

  async process(input: WorkerInput): Promise<WorkerOutput> {
    if (!input.text) {
      return {
        success: false,
        error: 'No text provided for NLP processing',
      };
    }

    try {
      const result = await this.processText(input.text, input.metadata);
      
      return {
        success: true,
        data: result,
        confidence: this.calculateOverallConfidence(result),
      };
    } catch (error) {
      logger.error('[NLP Text Worker] Processing error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Test basic NLP operations
      const testText = 'John Doe works at ABC Corporation in New York.';
      const doc = compromise(testText);
      const tokens = this.tokenizer.tokenize(testText);
      return doc !== null && tokens !== null && tokens.length > 0;
    } catch (error) {
      logger.error('[NLP Text Worker] Health check failed:', error);
      return false;
    }
  }

  /**
   * Process text and extract entities, keywords, and topics
   */
  private async processText(text: string, metadata?: Record<string, any>): Promise<NLPResult> {
    const doc = compromise(text);
    
    // Extract entities using compromise
    const entities: ExtractedEntity[] = [];

    // Extract people
    const people = doc.people().out('array') as string[];
    people.forEach((person) => {
      entities.push({
        type: 'person',
        value: person,
        normalizedValue: this.normalizeName(person),
        sourceText: person,
        confidence: 0.8,
      });
    });

    // Extract organizations
    const orgs = doc.organizations().out('array') as string[];
    orgs.forEach((org) => {
      entities.push({
        type: 'org',
        value: org,
        normalizedValue: this.normalizeOrg(org),
        sourceText: org,
        confidence: 0.75,
      });
    });

    // Extract places/locations
    const places = doc.places().out('array') as string[];
    places.forEach((place) => {
      entities.push({
        type: 'location',
        value: place,
        normalizedValue: this.normalizeLocation(place),
        sourceText: place,
        confidence: 0.7,
      });
    });

    // Extract dates using regex instead of compromise
    const dateRegex = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}\b/gi;
    const dates = text.match(dateRegex) || [];
    dates.forEach((date) => {
      entities.push({
        type: 'date',
        value: date,
        normalizedValue: date,
        sourceText: date,
        confidence: 0.85,
      });
    });

    // Extract emails using regex
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const emails = text.match(emailRegex) || [];
    emails.forEach((email) => {
      entities.push({
        type: 'email',
        value: email,
        normalizedValue: email.toLowerCase(),
        sourceText: email,
        confidence: 0.95,
      });
    });

    // Extract phone numbers using regex
    const phoneRegex = /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g;
    const phones = text.match(phoneRegex) || [];
    phones.forEach((phone) => {
      entities.push({
        type: 'phone',
        value: phone,
        normalizedValue: this.normalizePhone(phone),
        sourceText: phone,
        confidence: 0.9,
      });
    });

    // Extract social media handles
    const handleRegex = /@[A-Za-z0-9_]{1,15}\b/g;
    const handles = text.match(handleRegex) || [];
    handles.forEach((handle) => {
      entities.push({
        type: 'handle',
        value: handle,
        normalizedValue: handle.toLowerCase(),
        sourceText: handle,
        confidence: 0.85,
      });
    });

    // Tokenize for keyword extraction
    const tokens = this.tokenizer.tokenize(text) || [];
    const stemmedTokens = tokens.map(token => PorterStemmer.stem(token.toLowerCase()));

    // Extract keywords (nouns, adjectives, and proper nouns)
    const keywords = doc
      .match('#Noun|#Adjective|#ProperNoun')
      .not('#Pronoun')
      .out('array') as string[];

    // Extract topics (terms that appear multiple times)
    const topicCounts = new Map<string, number>();
    stemmedTokens.forEach(token => {
      if (token.length > 3) { // Ignore short words
        topicCounts.set(token, (topicCounts.get(token) || 0) + 1);
      }
    });

    const topics = Array.from(topicCounts.entries())
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, _]) => topic);

    // Normalize text
    const normalizedText = doc
      .normalize({
        whitespace: true,
        case: false,
        punctuation: true,
        acronyms: true,
      })
      .out('text');

    return {
      entities,
      keywords: keywords.slice(0, 20), // Top 20 keywords
      topics,
      tokens: tokens.slice(0, 100), // First 100 tokens
      normalizedText,
      language: 'en', // Assume English for now
    };
  }

  /**
   * Normalize person name
   */
  private normalizeName(name: string): string {
    return name
      .trim()
      .split(/\s+/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Normalize organization name
   */
  private normalizeOrg(org: string): string {
    return org.trim().replace(/\s+/g, ' ');
  }

  /**
   * Normalize location
   */
  private normalizeLocation(location: string): string {
    return location.trim().replace(/\s+/g, ' ');
  }

  /**
   * Normalize phone number
   */
  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  /**
   * Calculate overall confidence for NLP results
   */
  private calculateOverallConfidence(result: NLPResult): number {
    if (result.entities.length === 0) {
      return 0.3; // Low confidence if no entities found
    }

    const avgEntityConfidence = 
      result.entities.reduce((sum, entity) => sum + entity.confidence, 0) / 
      result.entities.length;

    // Weight by number of entities and keywords found
    const entityWeight = Math.min(result.entities.length / 10, 1) * 0.5;
    const keywordWeight = Math.min(result.keywords.length / 20, 1) * 0.3;
    const confidenceWeight = avgEntityConfidence * 0.2;

    return Math.min((entityWeight + keywordWeight + confidenceWeight) * 100, 100);
  }
}

// Singleton instance
export const nlpTextWorker = new NLPTextWorker();
