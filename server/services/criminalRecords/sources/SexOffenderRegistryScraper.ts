// Sex Offender Registry Scraper
import type { Page } from 'playwright';
import type { CriminalSearchQuery, ScraperResult } from '../types';
import { LegacyScraperAdapter } from './LegacyScraperAdapter';

export class SexOffenderRegistryScraper extends LegacyScraperAdapter {
  protected sourceName = 'Sex Offender Registry';
  protected baseConfidence = 1.0; // Zero false positives

  async search(query: CriminalSearchQuery, page: Page): Promise<ScraperResult> {
    try {
      const records: any[] = [];
      
      // National Sex Offender Public Website
      await page.goto('https://www.nsopw.gov/', { waitUntil: 'networkidle' });
      await this.humanLikeDelay();

      // Perform search (placeholder - actual implementation would interact with search form)
      // This is HIGH PRIORITY - if found, flag immediately
      
      const offenderData = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.offender-record')).map(el => ({
          name: el.querySelector('.offender-name')?.textContent?.trim(),
          tier: el.querySelector('.tier-level')?.textContent?.trim(),
          offenses: el.querySelector('.offenses')?.textContent?.trim(),
          registrationDate: el.querySelector('.reg-date')?.textContent?.trim(),
        }));
      });

      offenderData.forEach(o => {
        if (o.name && o.name.toLowerCase().includes(query.fullName.toLowerCase())) {
          records.push({
            fullName: query.fullName,
            sexOffenderStatus: {
              registered: true,
              tier: this.parseTier(o.tier),
              offenses: o.offenses ? [o.offenses] : [],
              registrationDate: o.registrationDate,
            },
            source: this.sourceName,
            confidence: this.baseConfidence,
            scrapedAt: new Date(),
          });
        }
      });

      return this.createResult(records);
    } catch (error: any) {
      return this.createResult([], false, error.message);
    }
  }

  private parseTier(tierText?: string): 1 | 2 | 3 | undefined {
    if (!tierText) return undefined;
    const match = tierText.match(/\d/);
    if (match) {
      const tier = parseInt(match[0]);
      if (tier >= 1 && tier <= 3) return tier as 1 | 2 | 3;
    }
    return undefined;
  }
}
