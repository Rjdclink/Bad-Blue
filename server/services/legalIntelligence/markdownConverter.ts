/**
 * Legal Markdown Converter
 * Converts HTML to LLM-friendly markdown with legal formatting
 * Preserves structure important for legal document understanding
 */

import * as cheerio from 'cheerio';
import { logger } from '../../logger';

const log = logger.child({ component: 'legalIntelligence:markdownConverter' });

/**
 * Case citation patterns for bold formatting
 * Examples: Smith v. Jones, 123 U.S. 456 (2020)
 */
const CASE_CITATION_PATTERN = /\b([A-Z][a-z]+\s+v\.\s+[A-Z][a-z]+|[A-Z][a-z]+\s+et\s+al\.\s+v\.\s+[A-Z][a-z]+)/g;

/**
 * Statute citation patterns for code formatting
 * Examples: 42 U.S.C. § 1983, Cal. Penal Code § 148
 */
const STATUTE_CITATION_PATTERN = /\b(\d+\s+[A-Z]\.?[A-Z]\.?[A-Z]?\.?\s*(?:Code|Stat|Rev\.\s*Stat|C)\.?\s*§\s*\d+(?:[.-]\d+)*)/gi;

/**
 * Court name patterns for bold formatting
 * Examples: Supreme Court, District Court for the Northern District
 */
const COURT_NAME_PATTERN = /\b((?:Supreme|District|Circuit|Appellate|Municipal|County|State|Federal)\s+Court(?:\s+(?:of|for)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)?)/g;

/**
 * Legal Markdown Converter
 */
export class MarkdownConverter {
  /**
   * Convert HTML to legal-formatted markdown
   */
  convert(html: string): string {
    const $ = cheerio.load(html);
    
    // Start conversion
    let markdown = this.processNode($, $.root().children());
    
    // Apply legal-specific formatting
    markdown = this.formatCaseCitations(markdown);
    markdown = this.formatStatutes(markdown);
    markdown = this.formatCourtNames(markdown);
    
    // Clean up extra whitespace
    markdown = this.cleanWhitespace(markdown);
    
    log.debug('Markdown conversion complete', {
      inputLength: html.length,
      outputLength: markdown.length,
    });
    
    return markdown;
  }

  /**
   * Process HTML nodes recursively
   */
  private processNode($: cheerio.CheerioAPI, elements: cheerio.Cheerio<any>): string {
    let result = '';
    
    elements.each((_, element) => {
      const $el = $(element);
      const tag = element.tagName?.toLowerCase();
      
      switch (tag) {
        case 'h1':
          result += `# ${$el.text().trim()}\n\n`;
          break;
        case 'h2':
          result += `## ${$el.text().trim()}\n\n`;
          break;
        case 'h3':
          result += `### ${$el.text().trim()}\n\n`;
          break;
        case 'h4':
          result += `#### ${$el.text().trim()}\n\n`;
          break;
        case 'h5':
          result += `##### ${$el.text().trim()}\n\n`;
          break;
        case 'h6':
          result += `###### ${$el.text().trim()}\n\n`;
          break;
        case 'p':
          result += `${$el.text().trim()}\n\n`;
          break;
        case 'strong':
        case 'b':
          result += `**${$el.text().trim()}**`;
          break;
        case 'em':
        case 'i':
          result += `*${$el.text().trim()}*`;
          break;
        case 'code':
          result += `\`${$el.text().trim()}\``;
          break;
        case 'pre':
          result += `\`\`\`\n${$el.text().trim()}\n\`\`\`\n\n`;
          break;
        case 'blockquote':
          const quoteText = $el.text().trim().split('\n').map(line => `> ${line}`).join('\n');
          result += `${quoteText}\n\n`;
          break;
        case 'ul':
          result += this.processList($, $el, false);
          break;
        case 'ol':
          result += this.processList($, $el, true);
          break;
        case 'table':
          result += this.processTable($, $el);
          break;
        case 'a':
          const href = $el.attr('href');
          const text = $el.text().trim();
          if (href) {
            result += `[${text}](${href})`;
          } else {
            result += text;
          }
          break;
        case 'br':
          result += '\n';
          break;
        case 'hr':
          result += '\n---\n\n';
          break;
        case 'div':
        case 'section':
        case 'article':
        case 'main':
          // Recursively process children
          result += this.processNode($, $el.children());
          break;
        default:
          // For text nodes and unknown elements, just get the text
          if (element.type === 'text') {
            result += $(element).text();
          } else {
            result += this.processNode($, $el.children());
          }
      }
    });
    
    return result;
  }

  /**
   * Process list elements (ul/ol)
   */
  private processList($: cheerio.CheerioAPI, $list: cheerio.Cheerio<any>, ordered: boolean): string {
    let result = '';
    let index = 1;
    
    $list.children('li').each((_, li) => {
      const $li = $(li);
      const text = $li.text().trim();
      const prefix = ordered ? `${index}. ` : '- ';
      result += `${prefix}${text}\n`;
      index++;
    });
    
    result += '\n';
    return result;
  }

  /**
   * Process table elements
   * Preserves table structure in markdown
   */
  private processTable($: cheerio.CheerioAPI, $table: cheerio.Cheerio<any>): string {
    let result = '';
    
    // Extract headers
    const headers: string[] = [];
    $table.find('thead th, tr:first-child th').each((_, th) => {
      headers.push($(th).text().trim());
    });
    
    if (headers.length > 0) {
      result += `| ${headers.join(' | ')} |\n`;
      result += `| ${headers.map(() => '---').join(' | ')} |\n`;
    }
    
    // Extract rows
    $table.find('tbody tr, tr').each((_, tr) => {
      const $tr = $(tr);
      // Skip header rows
      if ($tr.find('th').length > 0) return;
      
      const cells: string[] = [];
      $tr.find('td').each((_, td) => {
        cells.push($(td).text().trim());
      });
      
      if (cells.length > 0) {
        result += `| ${cells.join(' | ')} |\n`;
      }
    });
    
    result += '\n';
    return result;
  }

  /**
   * Format case citations with bold
   */
  private formatCaseCitations(markdown: string): string {
    return markdown.replace(CASE_CITATION_PATTERN, '**$1**');
  }

  /**
   * Format statute citations with code formatting
   */
  private formatStatutes(markdown: string): string {
    return markdown.replace(STATUTE_CITATION_PATTERN, '`$1`');
  }

  /**
   * Format court names with bold
   */
  private formatCourtNames(markdown: string): string {
    return markdown.replace(COURT_NAME_PATTERN, '**$1**');
  }

  /**
   * Clean up excessive whitespace
   */
  private cleanWhitespace(markdown: string): string {
    // Remove more than 2 consecutive newlines
    markdown = markdown.replace(/\n{3,}/g, '\n\n');
    
    // Remove trailing whitespace on lines
    markdown = markdown.replace(/[ \t]+$/gm, '');
    
    // Ensure file ends with single newline
    markdown = markdown.trim() + '\n';
    
    return markdown;
  }
}

// Singleton instance
export const markdownConverter = new MarkdownConverter();
