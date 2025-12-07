import { BaseCrawler } from '../baseCrawler';
import { EntropySignature, CrawlerType } from '../core';
import { extractGPSFromFile } from '../../gpsIntelligence';
import axios from 'axios';
import * as cheerio from 'cheerio';

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
 * - Resources (PDFs, docs, images with GPS/EXIF)
 * - Structured content (lists, definitions)
 */
export class IceCrawler extends BaseCrawler {
  constructor(task: any) {
    super(task, CrawlerType.ICE);
  }

  async execute(): Promise<EntropySignature[]> {
    const signatures: EntropySignature[] = [];
    
    try {
      const response = await axios.get(this.task.target, { 
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        maxRedirects: 3
      });
      
      const $ = cheerio.load(response.data);
      
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
      for (const resource of resources.slice(0, 5)) { // Limit to 5 resources
        const sig = await this.extractResourceData(resource);
        if (sig) signatures.push(sig);
      }
      
    } catch (error) {
      // Ice fails gracefully - returns partial results
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
          colCount: Math.max(headers.length, rows[0]?.length || 0)
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
        const type = $(field).attr('type') || $(field).prop('tagName').toLowerCase();
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
   * Extract data from resources (GPS from images)
   */
  private async extractResourceData(url: string): Promise<EntropySignature | null> {
    try {
      // For images, extract GPS (reuse GPS service!)
      if (url.match(/\.(jpg|jpeg|png)$/i)) {
        // Download image temporarily
        const response = await axios.get(url, { 
          responseType: 'arraybuffer',
          timeout: 3000,
          maxContentLength: 5 * 1024 * 1024 // 5MB max
        });
        
        // Try to extract GPS (note: extractGPSFromFile expects file path)
        // For now, we'll just record the resource
        return this.generateEntropySignature({ 
          type: 'image_resource', 
          url,
          size: response.data.length
        });
      }
      
      // For documents, just record metadata
      if (url.match(/\.(pdf|doc|docx|xls|xlsx)$/i)) {
        return this.generateEntropySignature({ 
          type: 'document_resource', 
          url,
          extension: url.split('.').pop()
        });
      }
      
      return null;
    } catch {
      return null;
    }
  }
}
