/**
 * WhitePages.com scraper
 */
import type { Page } from 'playwright';
import { BaseScraper } from './BaseScraper';
import type { SearchQuery, PersonRecord, Address, Phone } from '../types';

export class WhitePagesScraper extends BaseScraper {
  private readonly confidence = 0.75;
  private readonly baseUrl = 'https://www.whitepages.com';

  async search(query: SearchQuery, page: Page): Promise<PersonRecord[]> {
    try {
      let url = `${this.baseUrl}/name/${query.firstName}-${query.lastName}`;
      if (query.state && query.city) {
        url += `/${query.state}/${query.city.replace(/\s+/g, '-')}`;
      }
      
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      
      // Wait for results to load
      await page.waitForSelector('.person-result, .no-results', { timeout: 5000 }).catch(() => {});

      const records: PersonRecord[] = [];
      
      // Extract all person results
      const results = await page.$$('.person-result');
      
      for (const result of results) {
        try {
          const fullName = await result.$eval('.name', el => el.textContent?.trim() || '').catch(() => '');
          if (!fullName) continue;
          
          const ageText = await result.$eval('.age', el => el.textContent?.trim()).catch(() => '');
          const age = ageText ? parseInt(ageText.replace(/\D/g, ''), 10) : undefined;
          
          // Extract addresses
          const addresses: Address[] = [];
          const addressEls = await result.$$('.address');
          for (const addrEl of addressEls) {
            const addrText = await addrEl.textContent();
            if (addrText) {
              const normalized = this.normalizeAddress(addrText.trim());
              if (normalized) {
                addresses.push({ ...normalized, type: 'current' });
              }
            }
          }
          
          // Extract phones
          const phones: Phone[] = [];
          const phoneEls = await result.$$('.phone');
          for (const phoneEl of phoneEls) {
            const phoneText = await phoneEl.textContent();
            if (phoneText) {
              const normalized = this.normalizePhone(phoneText.trim());
              if (normalized.length === 10) {
                phones.push({ number: normalized });
              }
            }
          }
          
          // Extract relatives
          const relatives: string[] = [];
          const relativeEls = await result.$$('.relatives');
          for (const relEl of relativeEls) {
            const relText = await relEl.textContent();
            if (relText) {
              relatives.push(relText.trim());
            }
          }
          
          records.push({
            fullName,
            age,
            addresses,
            phones,
            emails: [],
            relatives,
            aliases: [],
            source: 'WhitePages',
            confidence: this.confidence,
            scrapedAt: new Date(),
          });
        } catch (err) {
          console.error('Error parsing result:', err);
          continue;
        }
      }
      
      return records;
    } catch {
      // IMMEDIATE SKIP - retry logic handles it
      return [];
    }
  }
}
