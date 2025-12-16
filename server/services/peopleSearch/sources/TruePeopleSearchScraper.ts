/**
 * TruePeopleSearch.com scraper
 */
import type { Page } from 'playwright';
import { BaseScraper } from './BaseScraper';
import type { SearchQuery, PersonRecord, Address, Phone } from '../types';

export class TruePeopleSearchScraper extends BaseScraper {
  private readonly confidence = 0.85;
  private readonly baseUrl = 'https://www.truepeoplesearch.com';

  async search(query: SearchQuery, page: Page): Promise<PersonRecord[]> {
    try {
      let url = `${this.baseUrl}/results?name=${encodeURIComponent(query.firstName + ' ' + query.lastName)}`;
      if (query.city && query.state) {
        url += `&citystatezip=${encodeURIComponent(query.city + ' ' + query.state)}`;
      }
      
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      
      // Wait for results to load
      await page.waitForSelector('.card, .no-results', { timeout: 5000 }).catch(() => {});

      const records: PersonRecord[] = [];
      
      // Extract all person cards
      const cards = await page.$$('.card');
      
      for (const card of cards) {
        try {
          const fullName = await card.$eval('.h4', el => el.textContent?.trim() || '').catch(() => '');
          if (!fullName) continue;
          
          // Extract age
          const contentLabels = await card.$$('.content-label');
          const contentValues = await card.$$('.content-value');
          let age: number | undefined;
          
          for (let i = 0; i < contentLabels.length; i++) {
            const label = await contentLabels[i].textContent();
            if (label?.toLowerCase().includes('age') && i < contentValues.length) {
              const ageText = await contentValues[i].textContent();
              age = ageText ? parseInt(ageText.replace(/\D/g, ''), 10) : undefined;
              break;
            }
          }
          
          // Extract addresses
          const addresses: Address[] = [];
          for (let i = 0; i < contentLabels.length; i++) {
            const label = await contentLabels[i].textContent();
            if (label?.toLowerCase().includes('address') && i < contentValues.length) {
              const addrText = await contentValues[i].textContent();
              if (addrText) {
                const normalized = this.normalizeAddress(addrText.trim());
                if (normalized) {
                  addresses.push({ ...normalized, type: 'current' });
                }
              }
            }
          }
          
          // Extract phones
          const phones: Phone[] = [];
          for (let i = 0; i < contentLabels.length; i++) {
            const label = await contentLabels[i].textContent();
            if (label?.toLowerCase().includes('phone') && i < contentValues.length) {
              const phoneText = await contentValues[i].textContent();
              if (phoneText) {
                const normalized = this.normalizePhone(phoneText.trim());
                if (normalized.length === 10) {
                  phones.push({ number: normalized });
                }
              }
            }
          }
          
          // Extract relatives
          const relatives: string[] = [];
          const relativeEls = await card.$$('.relative-name');
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
            source: 'TruePeopleSearch',
            confidence: this.confidence,
            scrapedAt: new Date(),
          });
        } catch (err) {
          console.error('Error parsing card:', err);
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
