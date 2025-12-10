/**
 * BM25 Content Filtering Engine
 * Removes navigation, ads, footers using BM25 relevance scoring
 * Based on Crawl4AI pattern for legal document intelligence
 */

import * as cheerio from 'cheerio';
import { logger } from '../../logger';

const log = logger.child({ component: 'legalIntelligence:contentFilter' });

/**
 * Legal terminology for relevance scoring
 * Prioritize blocks containing these terms
 */
const LEGAL_TERMS = [
  'plaintiff', 'defendant', 'court', 'statute', 'amendment', 'ruling',
  'judgment', 'complaint', 'motion', 'brief', 'jurisdiction', 'precedent',
  'docket', 'appeal', 'testimony', 'verdict', 'liability', 'damages',
  'injunction', 'petition', 'ordinance', 'regulation', 'code', 'section',
  'chapter', 'article', 'subsection', 'clause', 'provision', 'law',
  'legal', 'criminal', 'civil', 'federal', 'state', 'municipal',
  'officer', 'police', 'sheriff', 'department', 'agency', 'attorney',
  'counsel', 'prosecutor', 'defense', 'litigation', 'hearing', 'trial',
  'sentencing', 'conviction', 'acquittal', 'settlement', 'arbitration',
];

/**
 * BM25 Parameters
 * k1: term frequency saturation parameter (1.2-2.0 typical)
 * b: length normalization parameter (0.75 typical)
 */
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const RELEVANCE_THRESHOLD = 0.3;

interface ContentBlock {
  html: string;
  text: string;
  wordCount: number;
  score: number;
  tag: string;
  hasLegalTerms: boolean;
}

/**
 * Content Filtering Engine
 */
export class ContentFilter {
  private avgDocLength: number = 0;

  /**
   * Filter HTML content to remove noise and keep relevant legal content
   */
  async filterContent(html: string): Promise<string> {
    const $ = cheerio.load(html);

    // Remove common noise elements
    this.removeNoiseElements($);

    // Parse HTML into semantic blocks
    const blocks = this.parseBlocks($);

    if (blocks.length === 0) {
      log.warn('No content blocks found after parsing');
      return html;
    }

    // Calculate average document length for BM25
    this.avgDocLength = blocks.reduce((sum, block) => sum + block.wordCount, 0) / blocks.length;

    // Score each block using BM25
    const scoredBlocks = blocks.map(block => ({
      ...block,
      score: this.calculateBM25Score(block),
    }));

    // Filter blocks below threshold
    const relevantBlocks = scoredBlocks.filter(block => 
      block.score >= RELEVANCE_THRESHOLD || block.hasLegalTerms
    );

    log.info('Content filtering complete', {
      totalBlocks: blocks.length,
      relevantBlocks: relevantBlocks.length,
      avgScore: (relevantBlocks.reduce((sum, b) => sum + b.score, 0) / relevantBlocks.length).toFixed(3),
    });

    // Reconstruct filtered HTML
    return this.reconstructHTML(relevantBlocks);
  }

  /**
   * Remove common noise elements from HTML
   */
  private removeNoiseElements($: cheerio.CheerioAPI): void {
    // Remove scripts and styles
    $('script, style, noscript').remove();
    
    // Remove common navigation and UI elements
    $('nav, header, footer, aside, .navigation, .nav, .menu, .sidebar').remove();
    
    // Remove ads and tracking
    $('.ad, .ads, .advertisement, .banner, .popup, .modal, [id*="ad-"], [class*="ad-"]').remove();
    
    // Remove social media widgets
    $('.social, .share, .twitter, .facebook, .instagram').remove();
    
    // Remove comments sections
    $('.comments, .comment-section, #comments').remove();
  }

  /**
   * Parse HTML into semantic blocks
   */
  private parseBlocks($: cheerio.CheerioAPI): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    
    // Target meaningful content elements
    const selectors = [
      'article', 'main', 'section', 'div.content', 'div.main',
      'div.body', 'div.article', 'p', 'table', 'ul', 'ol',
      'div[class*="content"]', 'div[class*="body"]', 'div[class*="text"]',
    ];

    const processedElements = new Set<string>();

    selectors.forEach(selector => {
      $(selector).each((_, element) => {
        const $el = $(element);
        
        // Skip if already processed via parent
        const elementId = this.getElementId($el);
        if (processedElements.has(elementId)) {
          return;
        }

        const text = $el.text().trim();
        const wordCount = text.split(/\s+/).length;
        
        // Skip very short blocks (likely noise)
        if (wordCount < 5) {
          return;
        }

        // Check for legal terms
        const hasLegalTerms = this.containsLegalTerms(text);

        blocks.push({
          html: $.html($el),
          text,
          wordCount,
          score: 0,
          tag: (element as any).tagName || 'div',
          hasLegalTerms,
        });

        processedElements.add(elementId);
      });
    });

    return blocks;
  }

  /**
   * Generate unique ID for element
   */
  private getElementId($el: cheerio.Cheerio<any>): string {
    const id = $el.attr('id');
    const className = $el.attr('class');
    const text = $el.text().substring(0, 50);
    return `${id || ''}-${className || ''}-${text}`;
  }

  /**
   * Check if text contains legal terms
   */
  private containsLegalTerms(text: string): boolean {
    const lowerText = text.toLowerCase();
    return LEGAL_TERMS.some(term => lowerText.includes(term.toLowerCase()));
  }

  /**
   * Calculate BM25 score for a content block
   * Simplified BM25 for single-document scoring with legal term weighting
   */
  private calculateBM25Score(block: ContentBlock): number {
    const words = block.text.toLowerCase().split(/\s+/);
    const termFreq = new Map<string, number>();
    
    // Count term frequencies in block
    words.forEach(word => {
      if (word.length > 2) { // Skip very short words
        termFreq.set(word, (termFreq.get(word) || 0) + 1);
      }
    });

    let totalScore = 0;
    let matchedTerms = 0;

    // Calculate score based on legal terms
    LEGAL_TERMS.forEach(term => {
      const freq = termFreq.get(term.toLowerCase()) || 0;
      if (freq > 0) {
        matchedTerms++;
        // Simplified BM25 term score (single document context)
        // For single document, we focus on term frequency saturation
        const numerator = freq * (BM25_K1 + 1);
        const denominator = freq + BM25_K1 * (1 - BM25_B + BM25_B * block.wordCount / Math.max(this.avgDocLength, 1));
        const termScore = numerator / denominator;
        totalScore += termScore;
      }
    });

    // Normalize score (0-1 range approximately)
    const normalizedScore = Math.min(totalScore / 5, 1);

    // Boost score if multiple legal terms present (diversity bonus)
    const diversityBonus = matchedTerms > 3 ? 0.2 : 0;

    return normalizedScore + diversityBonus;
  }

  /**
   * Reconstruct HTML from filtered blocks
   */
  private reconstructHTML(blocks: ContentBlock[]): string {
    if (blocks.length === 0) {
      return '<div>No relevant content found</div>';
    }

    // Sort blocks by score (highest first)
    const sortedBlocks = [...blocks].sort((a, b) => b.score - a.score);

    // Combine blocks into single HTML
    const combinedHTML = sortedBlocks
      .map(block => block.html)
      .join('\n');

    return `<div class="filtered-content">${combinedHTML}</div>`;
  }

  /**
   * Get statistics about the last filtering operation
   */
  getStats(): { avgDocLength: number } {
    return {
      avgDocLength: this.avgDocLength,
    };
  }
}

// Singleton instance
export const contentFilter = new ContentFilter();
