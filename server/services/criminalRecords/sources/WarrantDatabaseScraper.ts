// Active Warrant Database Scraper
import type { Page } from 'playwright';
import type { CriminalSearchQuery, ScraperResult } from '../types';
import { LegacyScraperAdapter } from './LegacyScraperAdapter';

export class WarrantDatabaseScraper extends LegacyScraperAdapter {
  protected sourceName = 'Warrant Database';
  protected baseConfidence = 0.80;

  async search(query: CriminalSearchQuery, page: Page): Promise<ScraperResult> {
    try {
      const records: any[] = [];
      
      // Check multiple warrant sources
      const warrantSites = [
        'https://www.crimewatchers.net/',
        // County sheriff websites would be added here based on location
      ];

      for (const site of warrantSites) {
        try {
          await page.goto(site, { waitUntil: 'networkidle', timeout: 10000 });
          await this.humanLikeDelay();

          const warrantData = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.warrant, .warrant-record')).map(el => ({
              name: el.querySelector('.name')?.textContent?.trim(),
              charge: el.querySelector('.charge')?.textContent?.trim(),
              issueDate: el.querySelector('.issue-date')?.textContent?.trim(),
              jurisdiction: el.querySelector('.jurisdiction')?.textContent?.trim(),
              bondAmount: el.querySelector('.bond')?.textContent?.trim(),
            }));
          });

          warrantData.forEach(w => {
            if (w.name && w.charge && w.name.toLowerCase().includes(query.fullName.toLowerCase())) {
              records.push({
                fullName: query.fullName,
                activeWarrants: [{
                  issueDate: w.issueDate || 'Unknown',
                  charge: w.charge,
                  jurisdiction: w.jurisdiction || query.state || 'Unknown',
                  bondAmount: w.bondAmount,
                }],
                source: this.sourceName,
                confidence: this.baseConfidence,
                scrapedAt: new Date(),
              });
            }
          });
        } catch (siteError) {
          console.error(`[WarrantScraper] Error with ${site}:`, siteError);
          // Continue with next site
        }
      }

      return this.createResult(records);
    } catch (error: any) {
      return this.createResult([], false, error.message);
    }
  }
}
