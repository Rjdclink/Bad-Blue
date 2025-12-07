// Legacy compatibility adapter for existing scrapers
// This allows existing scrapers to continue working while we transition to the new base class
import type { Page } from 'playwright';
import type { CriminalSearchQuery, ScraperResult } from '../types';

export abstract class LegacyScraperAdapter {
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

  protected inferDegree(charge: string): 'felony' | 'misdemeanor' | 'infraction' {
    const lower = charge.toLowerCase();
    if (lower.includes('felony') || lower.includes('murder') || lower.includes('robbery')) {
      return 'felony';
    }
    if (lower.includes('misdemeanor') || lower.includes('dui') || lower.includes('petty')) {
      return 'misdemeanor';
    }
    return 'infraction';
  }
}
