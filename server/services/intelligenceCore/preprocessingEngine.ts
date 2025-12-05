/**
 * Preprocessing Engine
 * Normalize and extract structured data from raw multimodal inputs
 * Phase 4A: Foundation Layer
 */

import { 
  RawInput, 
  NormalizedData, 
  ExtractedEntity, 
  MediaAnalysis,
  EntityLink 
} from './types';
import { mlnlpIntelligenceService } from '../mlnlp/intelligenceService';
import { createLogger } from '../../logger';

const logger = createLogger('PreprocessingEngine');

export class PreprocessingEngine {
  private initialized = false;

  /**
   * Initialize the preprocessing engine
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize ML/NLP service
      await mlnlpIntelligenceService.initialize();
      
      logger.info('Preprocessing Engine initialized successfully');
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize Preprocessing Engine:', error);
      throw error;
    }
  }

  // ==================== MAIN NORMALIZATION PIPELINE ====================

  /**
   * Main normalization pipeline
   * Processes raw input and returns normalized data
   */
  async normalize(input: RawInput): Promise<NormalizedData> {
    try {
      await this.initialize();

      let text = '';
      let entities: ExtractedEntity[] = [];
      let structured: any = null;
      let mediaAnalysis: MediaAnalysis | undefined = undefined;
      const provenance: string[] = [];

      // Add source to provenance
      if (input.sourceUrl) {
        provenance.push(input.sourceUrl);
      }

      // Process based on source type
      switch (input.sourceType) {
        case 'text':
          text = await this.extractText(input);
          break;

        case 'html':
          text = await this.extractText(input);
          structured = await this.extractStructuredData(input.data);
          break;

        case 'json':
          text = await this.extractText(input);
          structured = input.data;
          break;

        case 'image':
          // Placeholder for future OCR implementation
          logger.info('Image processing not yet implemented');
          mediaAnalysis = {
            type: 'image',
            metadata: input.metadata,
          };
          break;

        case 'audio':
        case 'video':
          // Placeholder for future transcription implementation
          logger.info(`${input.sourceType} processing not yet implemented`);
          mediaAnalysis = {
            type: input.sourceType,
            metadata: input.metadata,
          };
          break;

        case 'pdf':
          // Placeholder for future PDF extraction
          logger.info('PDF processing not yet implemented');
          break;

        default:
          logger.warn(`Unknown source type: ${input.sourceType}`);
      }

      // Clean and process text if available
      if (text) {
        text = await this.cleanText(text);
        entities = await this.extractEntities(text);
        entities = await this.deduplicateEntities(entities);
      }

      // Calculate confidence based on entity extraction success
      const confidence = this.calculateConfidence(text, entities);

      return {
        text,
        entities,
        structured,
        mediaAnalysis,
        confidence,
        provenance,
      };
    } catch (error) {
      logger.error('Normalization failed:', error);
      throw error;
    }
  }

  // ==================== TEXT PROCESSING ====================

  /**
   * Extract text from various input types
   */
  async extractText(input: RawInput): Promise<string> {
    try {
      switch (input.sourceType) {
        case 'text':
          return typeof input.data === 'string' ? input.data : String(input.data);

        case 'html':
          return this.extractTextFromHtml(input.data);

        case 'json':
          return this.extractTextFromJson(input.data);

        default:
          logger.warn(`Text extraction not implemented for ${input.sourceType}`);
          return '';
      }
    } catch (error) {
      logger.error('Text extraction failed:', error);
      return '';
    }
  }

  /**
   * Clean and normalize text
   */
  async cleanText(text: string): Promise<string> {
    try {
      // Remove excessive whitespace
      text = text.replace(/\s+/g, ' ');
      
      // Remove control characters
      text = text.replace(/[\x00-\x1F\x7F]/g, '');
      
      // Trim
      text = text.trim();

      return text;
    } catch (error) {
      logger.error('Text cleaning failed:', error);
      return text;
    }
  }

  // ==================== ENTITY EXTRACTION ====================

  /**
   * Extract entities from text using ML/NLP service
   */
  async extractEntities(text: string): Promise<ExtractedEntity[]> {
    try {
      const nlpResults = await mlnlpIntelligenceService.processFullPipeline(text, undefined, {
        enableNLP: true,
        enableEntityResolution: true,
      });

      if (!nlpResults.nlpResults) return [];

      return nlpResults.nlpResults.entities.map(e => ({
        type: this.mapEntityType(e.type),
        value: e.value,
        context: e.sourceText || '',
        confidence: e.confidence || 0.5,
        sourceReference: 'mlnlp',
        position: e.position,
      }));
    } catch (error) {
      logger.error('Entity extraction failed:', error);
      return [];
    }
  }

  /**
   * Deduplicate entities based on value and type
   */
  async deduplicateEntities(entities: ExtractedEntity[]): Promise<ExtractedEntity[]> {
    try {
      const seen = new Map<string, ExtractedEntity>();

      for (const entity of entities) {
        const key = `${entity.type}:${entity.value.toLowerCase()}`;
        
        if (!seen.has(key)) {
          seen.set(key, entity);
        } else {
          // Keep entity with higher confidence
          const existing = seen.get(key)!;
          if (entity.confidence > existing.confidence) {
            seen.set(key, entity);
          }
        }
      }

      return Array.from(seen.values());
    } catch (error) {
      logger.error('Entity deduplication failed:', error);
      return entities;
    }
  }

  /**
   * Find contextual relationships between entities
   */
  async contextualLinking(entities: ExtractedEntity[]): Promise<EntityLink[]> {
    try {
      const links: EntityLink[] = [];

      // Simple co-occurrence based linking
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const entity1 = entities[i];
          const entity2 = entities[j];

          // If entities appear in same context, create a link
          if (entity1.context === entity2.context && entity1.context) {
            const relationship = this.inferRelationship(entity1, entity2);
            
            links.push({
              entity1,
              entity2,
              relationship,
              confidence: Math.min(entity1.confidence, entity2.confidence) * 0.8,
            });
          }
        }
      }

      return links;
    } catch (error) {
      logger.error('Contextual linking failed:', error);
      return [];
    }
  }

  // ==================== STRUCTURED DATA EXTRACTION ====================

  /**
   * Extract structured data from HTML
   */
  async extractStructuredData(html: string): Promise<any> {
    try {
      const structured: any = {};

      // Extract JSON-LD
      const jsonld = await this.parseJSONLD(html);
      if (jsonld) {
        structured.jsonld = jsonld;
      }

      // Extract metadata
      const metadata = await this.extractMetadata(html);
      if (metadata) {
        structured.metadata = metadata;
      }

      return Object.keys(structured).length > 0 ? structured : null;
    } catch (error) {
      logger.error('Structured data extraction failed:', error);
      return null;
    }
  }

  /**
   * Parse JSON-LD from HTML
   */
  async parseJSONLD(html: string): Promise<any> {
    try {
      const jsonldPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
      const matches = html.matchAll(jsonldPattern);

      const jsonldData = [];
      for (const match of matches) {
        try {
          const data = JSON.parse(match[1]);
          jsonldData.push(data);
        } catch (e) {
          // Invalid JSON-LD, skip
        }
      }

      return jsonldData.length > 0 ? jsonldData : null;
    } catch (error) {
      logger.error('JSON-LD parsing failed:', error);
      return null;
    }
  }

  /**
   * Extract metadata from HTML
   */
  async extractMetadata(html: string): Promise<Record<string, any>> {
    try {
      const metadata: Record<string, any> = {};

      // Extract title
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      if (titleMatch) {
        metadata.title = titleMatch[1].trim();
      }

      // Extract meta tags
      const metaPattern = /<meta[^>]*name=["']([^"']*)["'][^>]*content=["']([^"']*)["'][^>]*>/gi;
      const metaMatches = html.matchAll(metaPattern);

      for (const match of metaMatches) {
        const name = match[1];
        const content = match[2];
        metadata[name] = content;
      }

      // Extract Open Graph tags
      const ogPattern = /<meta[^>]*property=["']og:([^"']*)["'][^>]*content=["']([^"']*)["'][^>]*>/gi;
      const ogMatches = html.matchAll(ogPattern);

      for (const match of ogMatches) {
        const property = match[1];
        const content = match[2];
        metadata[`og:${property}`] = content;
      }

      return metadata;
    } catch (error) {
      logger.error('Metadata extraction failed:', error);
      return {};
    }
  }

  // ==================== MEDIA PROCESSING (PLACEHOLDERS) ====================

  /**
   * Perform OCR on image (placeholder)
   */
  async performOCR(imageBuffer: Buffer): Promise<string> {
    logger.warn('OCR not implemented in Phase 4A');
    return '';
  }

  /**
   * Transcribe audio (placeholder)
   */
  async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    logger.warn('Audio transcription not implemented in Phase 4A');
    return '';
  }

  /**
   * Analyze image (placeholder)
   */
  async analyzeImage(imageBuffer: Buffer): Promise<MediaAnalysis> {
    logger.warn('Image analysis not implemented in Phase 4A');
    return {
      type: 'image',
    };
  }

  // ==================== NOISE FILTERING ====================

  /**
   * Filter noise from data
   */
  async filterNoise(data: any): Promise<any> {
    // Placeholder for noise filtering
    return data;
  }

  /**
   * Detect language of text
   * Note: Uses simple ASCII ratio heuristic for Phase 4A
   * Future phases should integrate proper language detection library
   */
  async detectLanguage(text: string): Promise<string> {
    try {
      // Simple ASCII-based heuristic for English detection
      // Threshold: 90% ASCII characters suggests English or similar Latin-script language
      const ASCII_THRESHOLD = 0.9;
      const asciiRatio = text.split('').filter(c => c.charCodeAt(0) < 128).length / text.length;
      
      // TODO: Replace with proper language detection library (e.g., franc, langdetect)
      // for accurate multi-language support
      return asciiRatio > ASCII_THRESHOLD ? 'en' : 'unknown';
    } catch (error) {
      logger.error('Language detection failed:', error);
      return 'unknown';
    }
  }

  // ==================== HELPER METHODS ====================

  /**
   * Map NLP entity type to our entity type
   */
  private mapEntityType(nlpType: string): ExtractedEntity['type'] {
    const typeMap: Record<string, ExtractedEntity['type']> = {
      'person': 'person',
      'org': 'organization',
      'organization': 'organization',
      'location': 'location',
      'email': 'email',
      'phone': 'phone',
      'date': 'date',
      'handle': 'url',
      'url': 'url',
    };

    return typeMap[nlpType] || 'person';
  }

  /**
   * Infer relationship between two entities
   */
  private inferRelationship(entity1: ExtractedEntity, entity2: ExtractedEntity): string {
    // Simple rule-based relationship inference
    if (entity1.type === 'person' && entity2.type === 'organization') {
      return 'works_at';
    } else if (entity1.type === 'person' && entity2.type === 'location') {
      return 'located_in';
    } else if (entity1.type === 'person' && entity2.type === 'person') {
      return 'associated_with';
    } else if (entity1.type === 'organization' && entity2.type === 'location') {
      return 'located_in';
    }

    return 'related_to';
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(text: string, entities: ExtractedEntity[]): number {
    if (!text) return 0;

    // Base confidence on entity extraction success
    const hasEntities = entities.length > 0;
    const avgEntityConfidence = entities.length > 0
      ? entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length
      : 0;

    return hasEntities ? avgEntityConfidence : 0.3;
  }

  /**
   * Extract text from HTML (strip tags)
   */
  private extractTextFromHtml(html: string): string {
    // Remove script and style tags
    let text = html.replace(/<script[^>]*>.*?<\/script>/gis, '');
    text = text.replace(/<style[^>]*>.*?<\/style>/gis, '');
    
    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');
    
    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    
    return text;
  }

  /**
   * Extract text from JSON
   */
  private extractTextFromJson(data: any): string {
    if (typeof data === 'string') {
      return data;
    }

    // Extract all string values from JSON
    const extractStrings = (obj: any): string[] => {
      const strings: string[] = [];

      if (typeof obj === 'string') {
        strings.push(obj);
      } else if (Array.isArray(obj)) {
        for (const item of obj) {
          strings.push(...extractStrings(item));
        }
      } else if (typeof obj === 'object' && obj !== null) {
        for (const value of Object.values(obj)) {
          strings.push(...extractStrings(value));
        }
      }

      return strings;
    };

    return extractStrings(data).join(' ');
  }
}
