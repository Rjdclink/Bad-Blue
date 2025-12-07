// Base Criminal Records Scraper
import type { Page } from 'playwright';
import type { CriminalSearchQuery, ScraperResult } from '../types';

export abstract class BaseCriminalScraper {
  protected abstract sourceName: string;
  protected abstract baseConfidence: number;

  abstract search(query: CriminalSearchQuery, page: Page): Promise<ScraperResult>;

  protected async delay(ms: number): Promise<void> {
    const jitter = Math.random() * 2000;
    await new Promise(resolve => setTimeout(resolve, ms + jitter));
  }

  protected humanLikeDelay(): Promise<void> {
    return this.delay(3000 + Math.random() * 5000);
  }

  protected createResult(records: any[], success: boolean = true, error?: string): ScraperResult {
    return {
      success,
      records,
      source: this.sourceName,
      confidence: this.baseConfidence,
      error,
    };
  }
}
