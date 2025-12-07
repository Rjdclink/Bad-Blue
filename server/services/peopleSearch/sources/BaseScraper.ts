/**
 * Abstract base scraper class with utility methods
 */
import type { Page } from 'playwright';
import type { SearchQuery, PersonRecord } from '../types';

export abstract class BaseScraper {
  abstract search(query: SearchQuery, page: Page): Promise<PersonRecord[]>;

  /**
   * Normalize phone number to 10 digits
   */
  protected normalizePhone(phone: string): string {
    // Strip everything except digits
    const digits = phone.replace(/\D/g, '');
    // Return last 10 digits (removing country code if present)
    return digits.length >= 10 ? digits.slice(-10) : digits;
  }

  /**
   * Parse and normalize address string
   * Example: "123 Main St, Los Angeles, CA 90001" -> { street, city, state, zip }
   */
  protected normalizeAddress(addr: string): { street: string; city: string; state: string; zip: string } | null {
    try {
      const parts = addr.split(',').map(p => p.trim());
      
      if (parts.length < 2) return null;
      
      const street = parts[0];
      const lastPart = parts[parts.length - 1];
      
      // Extract ZIP from last part
      const zipMatch = lastPart.match(/\b\d{5}(-\d{4})?\b/);
      const zip = zipMatch ? zipMatch[0] : '';
      
      // Extract state (2 letter code before ZIP)
      const stateMatch = lastPart.match(/\b([A-Z]{2})\b/);
      const state = stateMatch ? stateMatch[1] : '';
      
      // City is what remains between street and state/zip
      let city = '';
      if (parts.length === 3) {
        city = parts[1];
      } else if (parts.length > 3) {
        // Join middle parts, then remove state and zip
        city = parts.slice(1, -1).join(', ').replace(state, '').replace(zip, '').trim();
      }
      
      return { street, city, state, zip };
    } catch {
      return null;
    }
  }
}
