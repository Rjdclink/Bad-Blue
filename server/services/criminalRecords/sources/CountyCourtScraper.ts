// County Court Records Scraper
import type { Page } from 'playwright';
import type { CriminalSearchQuery, ScraperResult } from '../types';
import { LegacyScraperAdapter } from './LegacyScraperAdapter';

export class CountyCourtScraper extends LegacyScraperAdapter {
  protected sourceName = 'County Courts';
  protected baseConfidence = 0.90;

  async search(query: CriminalSearchQuery, page: Page): Promise<ScraperResult> {
    try {
      const records: any[] = [];
      
      // Top county court systems
      const countyUrls: Record<string, string> = {
        'Los Angeles': 'https://www.lacourt.org/',
        'Cook': 'https://www.cookcountyclerkofcourt.org/',
        'Harris': 'https://www.hcdistrictclerk.com/',
      };

      const targetUrl = query.county ? countyUrls[query.county] : null;
      
      if (!targetUrl) {
        return this.createResult([], true);
      }

      await page.goto(targetUrl, { waitUntil: 'networkidle' });
      await this.humanLikeDelay();

      // Extract detailed county records
      const caseData = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.case-detail, .case-info')).map(el => ({
          caseNumber: el.querySelector('.case-id')?.textContent?.trim(),
          charge: el.querySelector('.charge')?.textContent?.trim(),
          disposition: el.querySelector('.disposition')?.textContent?.trim(),
          courtDate: el.querySelector('.court-date')?.textContent?.trim(),
          fine: el.querySelector('.fine-amount')?.textContent?.trim(),
        }));
      });

      caseData.forEach(c => {
        if (c.charge) {
          records.push({
            fullName: query.fullName,
            charges: [{
              charge: c.charge,
              statute: 'Unknown',
              degree: this.inferDegree(c.charge),
              date: c.courtDate || new Date().toISOString().split('T')[0],
              disposition: c.disposition,
              sentence: c.fine ? `Fine: ${c.fine}` : undefined,
            }],
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

  private inferDegree(charge: string): 'felony' | 'misdemeanor' | 'infraction' {
    const lower = charge.toLowerCase();
    // NOTE: This is a simplified classification. For production, use a lookup table
    // of actual statute codes mapped to their proper classifications per jurisdiction.
    if (lower.match(/felony|murder|assault|robbery|burglary/)) return 'felony';
    if (lower.match(/misdemeanor|dui|battery/)) return 'misdemeanor';
    return 'infraction';
  }
}
