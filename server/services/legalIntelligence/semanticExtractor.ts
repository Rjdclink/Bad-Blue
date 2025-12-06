/**
 * Semantic Legal Document Extractor
 * Extract structured data from legal documents using LLM + schema definitions
 * Integrates with Shadow Retrieval, Content Filter, and Markdown Converter
 */

import { ShadowRetrievalEngine } from '../shadowRetrieval';
import { contentFilter } from './contentFilter';
import { markdownConverter } from './markdownConverter';
import { extractionCache } from './extractionCache';
import { type ExtractionSchema, validateExtraction } from './schemas';
import { generateUserText, TaskPriority } from '../../aiProvider';
import { safeJsonParse } from '../../jsonParser';
import { logger } from '../../logger';

const log = logger.child({ component: 'legalIntelligence:semanticExtractor' });

export interface ExtractionResult {
  success: boolean;
  data?: any;
  confidence?: number;
  errors?: string[];
  cached?: boolean;
  metadata?: {
    url: string;
    schemaName: string;
    timestamp: number;
    processingTime: number;
  };
}

export interface ExtractionOptions {
  useCache?: boolean;
  cacheTTL?: number;
  skipFiltering?: boolean;
  temperature?: number;
  retries?: number;
}

/**
 * Semantic Legal Extractor
 */
export class SemanticLegalExtractor {
  private shadowRetrieval: ShadowRetrievalEngine;

  constructor() {
    this.shadowRetrieval = new ShadowRetrievalEngine({
      enabled: true,
      maxConcurrent: 5,
    });

    log.info('Semantic Legal Extractor initialized');
  }

  /**
   * Extract structured data from URL using schema
   */
  async extract(
    url: string,
    schema: ExtractionSchema,
    options: ExtractionOptions = {}
  ): Promise<ExtractionResult> {
    const startTime = Date.now();
    const {
      useCache = true,
      cacheTTL,
      skipFiltering = false,
      temperature = 0.3,
      retries = 2,
    } = options;

    try {
      // Check cache first
      if (useCache) {
        const cached = extractionCache.get(schema.name, url);
        if (cached) {
          log.info('Using cached extraction', { schemaName: schema.name, url });
          return {
            success: true,
            data: cached.data,
            confidence: cached.confidence,
            cached: true,
            metadata: {
              url,
              schemaName: schema.name,
              timestamp: cached.timestamp || Date.now(),
              processingTime: 0,
            },
          };
        }
      }

      // Step 1: Retrieve HTML using Shadow Retrieval
      log.debug('Retrieving HTML', { url });
      const retrievalResult = await this.shadowRetrieval.smartRetrieve(url, {
        waitForContent: true,
        extractLinks: false,
      });

      if (!retrievalResult.success || !retrievalResult.html) {
        throw new Error(`Failed to retrieve content: ${retrievalResult.error}`);
      }

      // Step 2: Filter content (remove noise)
      let processedHtml = retrievalResult.html;
      if (!skipFiltering) {
        log.debug('Filtering content', { schemaName: schema.name });
        processedHtml = await contentFilter.filterContent(retrievalResult.html);
      }

      // Step 3: Convert to markdown
      log.debug('Converting to markdown', { schemaName: schema.name });
      const markdown = markdownConverter.convert(processedHtml);

      // Step 4: Extract with schema using LLM
      log.debug('Extracting with LLM', { schemaName: schema.name });
      const extractedData = await this.extractWithSchema(
        markdown,
        schema,
        temperature,
        retries
      );

      // Step 5: Validate extraction
      const validation = validateExtraction(schema.name, extractedData.data);
      if (!validation.success) {
        log.warn('Extraction validation failed', {
          schemaName: schema.name,
          errors: validation.errors,
        });
      }

      const result: ExtractionResult = {
        success: validation.success,
        data: validation.data || extractedData.data,
        confidence: extractedData.confidence,
        errors: validation.errors,
        cached: false,
        metadata: {
          url,
          schemaName: schema.name,
          timestamp: Date.now(),
          processingTime: Date.now() - startTime,
        },
      };

      // Cache successful extraction
      if (result.success && useCache) {
        extractionCache.set(schema.name, url, {
          data: result.data,
          confidence: result.confidence,
          timestamp: Date.now(),
        }, cacheTTL);
      }

      log.info('Extraction completed', {
        schemaName: schema.name,
        success: result.success,
        confidence: result.confidence,
        processingTime: result.metadata.processingTime,
      });

      return result;

    } catch (error: any) {
      log.error('Extraction failed', {
        schemaName: schema.name,
        url,
        error: error.message,
      });

      return {
        success: false,
        errors: [error.message],
        metadata: {
          url,
          schemaName: schema.name,
          timestamp: Date.now(),
          processingTime: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Extract data using LLM with schema guidance
   */
  private async extractWithSchema(
    markdown: string,
    schema: ExtractionSchema,
    temperature: number,
    retries: number
  ): Promise<{ data: any; confidence: number }> {
    const systemPrompt = `You are a legal document extraction specialist. Extract structured information from legal documents according to the provided schema.

Schema: ${schema.name}
Description: ${schema.description}

${schema.extractionPrompt}

CRITICAL INSTRUCTIONS:
1. Extract ONLY information explicitly stated in the document
2. Do not infer or assume information not present
3. Return valid JSON matching the schema structure
4. Use null for missing optional fields
5. Include a "confidence" field (0-1) indicating extraction certainty
6. If a field cannot be extracted, omit it or set to null

Return JSON format:
{
  "confidence": <number 0-1>,
  "data": { <extracted fields matching schema> }
}`;

    const userPrompt = `Extract structured data from this legal document:\n\n${markdown}`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await generateUserText(
          `legal-extraction-${schema.name}`,
          userPrompt,
          {
            systemPrompt,
            temperature,
            useJSON: true,
          },
          TaskPriority.CRITICAL_USER
        );

        // Parse JSON response
        const parsed = safeJsonParse(response.content);
        
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Invalid JSON response from LLM');
        }

        // Extract confidence and data
        const confidence = typeof parsed.confidence === 'number' 
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.7;

        const data = parsed.data || parsed;

        return { data, confidence };

      } catch (error: any) {
        lastError = error;
        log.warn(`Extraction attempt ${attempt + 1} failed`, {
          schemaName: schema.name,
          error: error.message,
        });

        if (attempt < retries) {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    // All retries failed
    throw new Error(`Extraction failed after ${retries + 1} attempts: ${lastError?.message}`);
  }

  /**
   * Extract from HTML directly (bypass retrieval)
   */
  async extractFromHTML(
    html: string,
    schema: ExtractionSchema,
    options: ExtractionOptions = {}
  ): Promise<ExtractionResult> {
    const startTime = Date.now();
    const {
      skipFiltering = false,
      temperature = 0.3,
      retries = 2,
    } = options;

    try {
      // Filter content
      let processedHtml = html;
      if (!skipFiltering) {
        processedHtml = await contentFilter.filterContent(html);
      }

      // Convert to markdown
      const markdown = markdownConverter.convert(processedHtml);

      // Extract with schema
      const extractedData = await this.extractWithSchema(
        markdown,
        schema,
        temperature,
        retries
      );

      // Validate
      const validation = validateExtraction(schema.name, extractedData.data);

      return {
        success: validation.success,
        data: validation.data || extractedData.data,
        confidence: extractedData.confidence,
        errors: validation.errors,
        cached: false,
        metadata: {
          url: 'direct-html',
          schemaName: schema.name,
          timestamp: Date.now(),
          processingTime: Date.now() - startTime,
        },
      };

    } catch (error: any) {
      return {
        success: false,
        errors: [error.message],
        metadata: {
          url: 'direct-html',
          schemaName: schema.name,
          timestamp: Date.now(),
          processingTime: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Batch extract from multiple URLs
   */
  async extractBatch(
    urls: string[],
    schema: ExtractionSchema,
    options: ExtractionOptions = {}
  ): Promise<ExtractionResult[]> {
    const results = await Promise.allSettled(
      urls.map(url => this.extract(url, schema, options))
    );

    return results.map((r, idx) => {
      if (r.status === 'fulfilled') {
        return r.value;
      } else {
        return {
          success: false,
          errors: [r.reason?.message || 'Unknown error'],
          metadata: {
            url: urls[idx],
            schemaName: schema.name,
            timestamp: Date.now(),
            processingTime: 0,
          },
        };
      }
    });
  }
}

// Singleton instance
export const semanticLegalExtractor = new SemanticLegalExtractor();
