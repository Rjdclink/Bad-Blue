/**
 * FastPeopleSearch.com scraper
 */
import type { Page } from 'playwright';
import { BaseScraper } from './BaseScraper';
import type { SearchQuery, PersonRecord, Address, Phone } from '../types';

export class FastPeopleSearchScraper extends BaseScraper {
  private readonly confidence = 0.8;
  private readonly baseUrl = 'https://www.fastpeoplesearch.com';

  async search(query: SearchQuery, page: Page): Promise<PersonRecord[]> {
    try {
      const url = `${this.baseUrl}/name/${query.firstName}-${query.lastName}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      
      // Wait for results to load
      await page.waitForSelector('.card-summary, .no-results', { timeout: 5000 }).catch(() => {});

      const records: PersonRecord[] = [];
      
      // Extract all person cards
      const cards = await page.$$('.card-summary');
      
      for (const card of cards) {
        try {
          const fullName = await card.$eval('.card-title', el => el.textContent?.trim() || '').catch(() => '');
          if (!fullName) continue;
          
          const ageText = await card.$eval('.age', el => el.textContent?.trim()).catch(() => '');
          const age = ageText ? parseInt(ageText.replace(/\D/g, ''), 10) : undefined;
          
          // Extract addresses
          const addresses: Address[] = [];
          const addressEls = await card.$$('.address');
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
          const phoneEls = await card.$$('.phone');
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
          const relativeEls = await card.$$('.relative');
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
            source: 'FastPeopleSearch',
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
      // IMMEDIATE SKIP - let retry logic handle it
      return [];
    }
  }
}
