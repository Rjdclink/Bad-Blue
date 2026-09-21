import { BaseCrawler } from '../baseCrawler';
import { EntropySignature, CrawlerType } from '../core';
import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import { acquirePublicResource } from '../../crawlers/PublicAcquisitionInfrastructure';

/**
 * ICE CRAWLER - Precision Extractor
 * 
 * Specializes in high-fidelity data extraction from rich sources.
 * Named "Ice" because it freezes/captures exact data states.
 * 
 * Extracts:
 * - Metadata (title, description, keywords, OG tags)
 * - Tables (structured data with headers/rows)
 * - Forms (action, method, field names/types)
 * - Resources (PDFs, docs, images with bounded public metadata)
 * - Structured content (lists, definitions)
 */
export class IceCrawler extends BaseCrawler {
  private static readonly MAX_RESOURCES = 5; // Limit resource extraction to prevent overload
  
  constructor(task: any) {
    super(task, CrawlerType.ICE);
  }

  async execute(): Promise<EntropySignature[]> {
    const signatures: EntropySignature[] = [];
    
    try {
      const response = await acquirePublicResource(this.task.target, 5000);
      if (!response.ok) throw new Error(response.error || `HTTP ${response.status}`);
      const $ = cheerio.load(response.content);
      
      // Extract metadata
      const metadata = this.extractMetadata($);
      if (Object.values(metadata).some(v => v)) {
        signatures.push(this.generateEntropySignature({ 
          type: 'metadata', 
          ...metadata 
        }));
      }
      
      // Extract tables
      const tables = this.extractTables($);
      if (tables.length > 0) {
        signatures.push(this.generateEntropySignature({ 
          type: 'tables', 
          tables,
          count: tables.length
        }));
      }
      
      // Extract forms
      const forms = this.extractForms($);
      if (forms.length > 0) {
        signatures.push(this.generateEntropySignature({ 
          type: 'forms', 
          forms,
          count: forms.length
        }));
      }
      
      // Find downloadable resources
      const resources = this.findResources($);
      for (const resource of resources.slice(0, IceCrawler.MAX_RESOURCES)) {
        const sig = await this.extractResourceData(resource);
        if (sig) signatures.push(sig);
      }
      
    } catch {
      // IMMEDIATE SKIP - return partial results collected so far
    }
    
    return signatures;
  }

  /**
   * Extract page metadata
   */
  private extractMetadata($: cheerio.CheerioAPI): any {
    return {
      title: $('title').text().trim(),
      description: $('meta[name="description"]').attr('content')?.trim(),
      keywords: $('meta[name="keywords"]').attr('content')?.trim(),
      author: $('meta[name="author"]').attr('content')?.trim(),
      ogTitle: $('meta[property="og:title"]').attr('content')?.trim(),
      ogDescription: $('meta[property="og:description"]').attr('content')?.trim(),
      ogImage: $('meta[property="og:image"]').attr('content')?.trim(),
      ogUrl: $('meta[property="og:url"]').attr('content')?.trim(),
      canonical: $('link[rel="canonical"]').attr('href')?.trim()
    };
  }

  /**
   * Extract structured tables
   */
  private extractTables($: cheerio.CheerioAPI): any[] {
    const tables: any[] = [];
    
    $('table').each((i, table) => {
      const headers: string[] = [];
      const rows: string[][] = [];
      
      // Extract headers
      $(table).find('th').each((j, th) => {
        headers.push($(th).text().trim());
      });
      
      // Extract rows
      $(table).find('tr').each((j, tr) => {
        const row: string[] = [];
        $(tr).find('td').each((k, td) => {
          row.push($(td).text().trim());
        });
        if (row.length > 0) rows.push(row);
      });
      
      if (headers.length > 0 || rows.length > 0) {
        tables.push({ 
          headers, 
          rows, 
          rowCount: rows.length,
          colCount: Math.max(headers.length, rows.length > 0 ? rows[0].length : 0)
        });
      }
    });
    
    return tables;
  }

  /**
   * Extract forms and field definitions
   */
  private extractForms($: cheerio.CheerioAPI): any[] {
    const forms: any[] = [];
    
    $('form').each((i, form) => {
      const fields: any[] = [];
      
      $(form).find('input, select, textarea').each((j, field) => {
        const name = $(field).attr('name');
        const tagName = $(field).prop('tagName');
        const type = $(field).attr('type') || (tagName ? tagName.toString().toLowerCase() : 'text');
        const required = $(field).attr('required') !== undefined;
        const placeholder = $(field).attr('placeholder');
        
        if (name) {
          fields.push({ 
            name, 
            type, 
            required,
            placeholder
          });
        }
      });
      
      forms.push({
        action: $(form).attr('action') || '',
        method: ($(form).attr('method') || 'get').toUpperCase(),
        fields,
        fieldCount: fields.length
      });
    });
    
    return forms;
  }

  /**
   * Find downloadable resources
   */
  private findResources($: cheerio.CheerioAPI): string[] {
    const resources: string[] = [];
    
    // PDFs and documents
    $('a[href$=".pdf"], a[href$=".doc"], a[href$=".docx"], a[href$=".xls"], a[href$=".xlsx"]').each((i, link) => {
      const href = $(link).attr('href');
      if (href) resources.push(href);
    });
    
    // Images (for EXIF/GPS extraction)
    $('img[src$=".jpg"], img[src$=".jpeg"], img[src$=".png"]').each((i, img) => {
      const src = $(img).attr('src');
      if (src) resources.push(src);
    });
    
    return Array.from(new Set(resources)); // Remove duplicates
  }

  /**
   * Extract bounded public metadata from linked resources.
   * Precise EXIF/GPS location is intentionally not harvested here.
   */
  private async extractResourceData(url: string): Promise<EntropySignature | null> {
    try {
      const resolvedUrl = new URL(url, this.task.target).toString();

      if (resolvedUrl.match(/\.(jpg|jpeg|png)(?:[?#].*)?$/i)) {
        const response = await acquirePublicResource(resolvedUrl, 3000);
        if (!response.ok) return null;
        const bytes = Buffer.from(response.content);
        return this.generateEntropySignature({
          type: 'image_resource',
          url: response.url,
          size: bytes.length,
          contentType: response.contentType || null,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
      
      if (resolvedUrl.match(/\.(pdf|doc|docx|xls|xlsx)(?:[?#].*)?$/i)) {
        const response = await acquirePublicResource(resolvedUrl, 3000);
        if (!response.ok) return null;
        return this.generateEntropySignature({
          type: 'document_resource',
          url: response.url,
          extension: new URL(response.url).pathname.split('.').pop()?.toLowerCase(),
          contentType: response.contentType || null,
          contentLength: response.content.length || null,
          lastModified: response.lastModified || null,
        });
      }
      
      return null;
    } catch {
      // Resource retrieval failed - skip this resource locally.
      return null;
    }
  }
}
