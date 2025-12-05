/**
 * PANTHEON Shadow Retrieval - Content Extraction Engine
 * Multi-format data extractor that handles anything
 */

import * as cheerio from 'cheerio';
import type {
  ExtractionResult,
  ExtractedData,
  StructuredData,
  ExtractedLink,
  ExtractedImage,
  PageMetadata,
  ExtractedTable,
  ExtractedForm,
  FormField,
  APIEndpoint,
} from './types';
import { logger } from '../../logger';

const log = logger.child({ component: 'shadowRetrieval:contentExtractor' });

/**
 * Content Extraction Service
 */
export class ContentExtractor {
  /**
   * Extract all content from HTML
   */
  async extract(html: string, url?: string): Promise<ExtractionResult> {
    const startTime = Date.now();
    
    try {
      const $ = cheerio.load(html);
      
      const data: ExtractedData = {
        html,
        text: this.extractText($),
        structured: this.extractStructuredData($),
        links: this.extractLinks($, url),
        images: this.extractImages($, url),
        metadata: this.extractMetadata($, url),
        tables: this.extractTables($),
        forms: this.extractForms($, url),
      };
      
      const processingTime = Date.now() - startTime;
      
      log.debug('Content extracted successfully', {
        url,
        textLength: data.text?.length,
        linksCount: data.links?.length,
        imagesCount: data.images?.length,
        tablesCount: data.tables?.length,
        processingTime,
      });
      
      return {
        success: true,
        data,
        extractionMethod: 'cheerio',
        timestamp: new Date(),
        processingTime,
      };
    } catch (error: any) {
      log.error('Content extraction failed', { error: error.message, url });
      
      return {
        success: false,
        data: {},
        extractionMethod: 'cheerio',
        timestamp: new Date(),
        processingTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Extract clean text content
   */
  private extractText($: cheerio.CheerioAPI): string {
    // Remove script, style, and other non-content elements
    $('script, style, noscript, iframe, svg').remove();
    
    // Get body text or full text
    const body = $('body');
    const text = body.length > 0 ? body.text() : $.text();
    
    // Clean up whitespace
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
  }

  /**
   * Extract structured data (JSON-LD, Microdata, RDFa, OpenGraph, Twitter Cards)
   */
  private extractStructuredData($: cheerio.CheerioAPI): StructuredData {
    const structured: StructuredData = {};
    
    // JSON-LD
    const jsonLdScripts = $('script[type="application/ld+json"]');
    if (jsonLdScripts.length > 0) {
      structured.jsonLd = [];
      jsonLdScripts.each((_, elem) => {
        try {
          const jsonLd = JSON.parse($(elem).html() || '{}');
          structured.jsonLd!.push(jsonLd);
        } catch (error) {
          log.debug('Failed to parse JSON-LD', { error });
        }
      });
    }
    
    // OpenGraph
    const ogTags = $('meta[property^="og:"]');
    if (ogTags.length > 0) {
      structured.openGraph = {};
      ogTags.each((_, elem) => {
        const property = $(elem).attr('property');
        const content = $(elem).attr('content');
        if (property && content) {
          const key = property.replace('og:', '');
          structured.openGraph![key] = content;
        }
      });
    }
    
    // Twitter Cards
    const twitterTags = $('meta[name^="twitter:"]');
    if (twitterTags.length > 0) {
      structured.twitterCards = {};
      twitterTags.each((_, elem) => {
        const name = $(elem).attr('name');
        const content = $(elem).attr('content');
        if (name && content) {
          const key = name.replace('twitter:', '');
          structured.twitterCards![key] = content;
        }
      });
    }
    
    // Microdata (basic extraction)
    const microdataItems = $('[itemscope]');
    if (microdataItems.length > 0) {
      structured.microdata = [];
      microdataItems.each((_, elem) => {
        const itemType = $(elem).attr('itemtype');
        const item: any = { type: itemType, properties: {} };
        
        $(elem).find('[itemprop]').each((_, propElem) => {
          const prop = $(propElem).attr('itemprop');
          const content = $(propElem).attr('content') || $(propElem).text();
          if (prop) {
            item.properties[prop] = content;
          }
        });
        
        structured.microdata!.push(item);
      });
    }
    
    return structured;
  }

  /**
   * Extract all links from page
   */
  private extractLinks($: cheerio.CheerioAPI, baseUrl?: string): ExtractedLink[] {
    const links: ExtractedLink[] = [];
    const seen = new Set<string>();
    
    $('a[href]').each((_, elem) => {
      const href = $(elem).attr('href');
      if (!href) return;
      
      // Resolve relative URLs
      let url = href;
      if (baseUrl && !href.startsWith('http') && !href.startsWith('//')) {
        try {
          url = new URL(href, baseUrl).href;
        } catch (error) {
          // Invalid URL, skip
          return;
        }
      }
      
      // Skip duplicates
      if (seen.has(url)) return;
      seen.add(url);
      
      // Determine if internal or external
      let type: 'internal' | 'external' = 'external';
      if (baseUrl) {
        try {
          const linkHost = new URL(url).hostname;
          const baseHost = new URL(baseUrl).hostname;
          type = linkHost === baseHost ? 'internal' : 'external';
        } catch (error) {
          // Invalid URL
        }
      }
      
      links.push({
        url,
        text: $(elem).text().trim(),
        title: $(elem).attr('title'),
        rel: $(elem).attr('rel'),
        type,
        context: $(elem).parent().text().slice(0, 100),
      });
    });
    
    return links;
  }

  /**
   * Extract all images from page
   */
  private extractImages($: cheerio.CheerioAPI, baseUrl?: string): ExtractedImage[] {
    const images: ExtractedImage[] = [];
    const seen = new Set<string>();
    
    $('img[src]').each((_, elem) => {
      const src = $(elem).attr('src');
      if (!src) return;
      
      // Resolve relative URLs
      let url = src;
      if (baseUrl && !src.startsWith('http') && !src.startsWith('//')) {
        try {
          url = new URL(src, baseUrl).href;
        } catch (error) {
          return;
        }
      }
      
      // Skip duplicates
      if (seen.has(url)) return;
      seen.add(url);
      
      images.push({
        src: url,
        alt: $(elem).attr('alt'),
        title: $(elem).attr('title'),
        width: parseInt($(elem).attr('width') || '0'),
        height: parseInt($(elem).attr('height') || '0'),
        context: $(elem).parent().text().slice(0, 100),
      });
    });
    
    return images;
  }

  /**
   * Extract page metadata
   */
  private extractMetadata($: cheerio.CheerioAPI, url?: string): PageMetadata {
    const metadata: PageMetadata = {};
    
    // Title
    metadata.title = $('title').text() || $('meta[property="og:title"]').attr('content');
    
    // Description
    metadata.description = $('meta[name="description"]').attr('content') || 
                          $('meta[property="og:description"]').attr('content');
    
    // Keywords
    const keywordsContent = $('meta[name="keywords"]').attr('content');
    if (keywordsContent) {
      metadata.keywords = keywordsContent.split(',').map(k => k.trim());
    }
    
    // Author
    metadata.author = $('meta[name="author"]').attr('content');
    
    // Published date
    metadata.publishedDate = $('meta[property="article:published_time"]').attr('content') ||
                             $('meta[name="date"]').attr('content');
    
    // Modified date
    metadata.modifiedDate = $('meta[property="article:modified_time"]').attr('content');
    
    // Canonical URL
    metadata.canonical = $('link[rel="canonical"]').attr('href') || url;
    
    // Language
    metadata.language = $('html').attr('lang') || 
                       $('meta[http-equiv="content-language"]').attr('content');
    
    // Charset
    metadata.charset = $('meta[charset]').attr('charset') || 
                      $('meta[http-equiv="content-type"]').attr('content');
    
    // Viewport
    metadata.viewport = $('meta[name="viewport"]').attr('content');
    
    // Robots
    metadata.robots = $('meta[name="robots"]').attr('content');
    
    return metadata;
  }

  /**
   * Extract tables with headers and rows
   */
  private extractTables($: cheerio.CheerioAPI): ExtractedTable[] {
    const tables: ExtractedTable[] = [];
    
    $('table').each((_, elem) => {
      const $table = $(elem);
      
      // Extract headers
      const headers: string[] = [];
      $table.find('thead th, thead td').each((_, th) => {
        headers.push($(th).text().trim());
      });
      
      // If no thead, try first row
      if (headers.length === 0) {
        $table.find('tr:first th, tr:first td').each((_, td) => {
          headers.push($(td).text().trim());
        });
      }
      
      // Extract rows
      const rows: string[][] = [];
      $table.find('tbody tr, tr').each((i, tr) => {
        // Skip header row if no thead
        if (i === 0 && $table.find('thead').length === 0) return;
        
        const row: string[] = [];
        $(tr).find('td').each((_, td) => {
          row.push($(td).text().trim());
        });
        
        if (row.length > 0) {
          rows.push(row);
        }
      });
      
      if (headers.length > 0 || rows.length > 0) {
        tables.push({
          headers,
          rows,
          caption: $table.find('caption').text().trim(),
          context: $table.parent().text().slice(0, 100),
        });
      }
    });
    
    return tables;
  }

  /**
   * Extract forms with fields
   */
  private extractForms($: cheerio.CheerioAPI, url?: string): ExtractedForm[] {
    const forms: ExtractedForm[] = [];
    
    $('form').each((_, elem) => {
      const $form = $(elem);
      const action = $form.attr('action');
      const method = $form.attr('method')?.toUpperCase() || 'GET';
      
      // Resolve form action URL
      let actionUrl = action;
      if (url && action && !action.startsWith('http')) {
        try {
          actionUrl = new URL(action, url).href;
        } catch (error) {
          // Invalid URL
        }
      }
      
      // Extract fields
      const fields: FormField[] = [];
      $form.find('input, textarea, select').each((_, field) => {
        const $field = $(field);
        const name = $field.attr('name');
        const type = $field.attr('type') || $field.prop('tagName')?.toLowerCase() || 'text';
        
        if (name) {
          fields.push({
            name,
            type,
            label: $form.find(`label[for="${$field.attr('id')}"]`).text().trim(),
            placeholder: $field.attr('placeholder'),
            required: $field.attr('required') !== undefined,
            value: $field.attr('value'),
          });
        }
      });
      
      forms.push({
        action: actionUrl,
        method,
        fields,
        context: $form.parent().text().slice(0, 100),
      });
    });
    
    return forms;
  }

  /**
   * Extract specific selectors
   */
  extractBySelector(html: string, selector: string): string[] {
    const $ = cheerio.load(html);
    const results: string[] = [];
    
    $(selector).each((_, elem) => {
      results.push($(elem).text().trim());
    });
    
    return results;
  }

  /**
   * Extract specific attribute values
   */
  extractAttribute(html: string, selector: string, attribute: string): string[] {
    const $ = cheerio.load(html);
    const results: string[] = [];
    
    $(selector).each((_, elem) => {
      const value = $(elem).attr(attribute);
      if (value) {
        results.push(value);
      }
    });
    
    return results;
  }
}

/**
 * Default content extractor instance
 */
export const defaultContentExtractor = new ContentExtractor();

/**
 * Quick extraction helper
 */
export async function extractContent(html: string, url?: string): Promise<ExtractionResult> {
  return defaultContentExtractor.extract(html, url);
}
