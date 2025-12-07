import { Page } from 'playwright';
import { CriminalSearchQuery, CriminalRecord } from '../types';

export abstract class BaseCriminalScraper {
  abstract name: string;
  abstract confidence: number;
  
  abstract search(query: CriminalSearchQuery, page: Page): Promise<CriminalRecord[]>;
  
  protected normalizeDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      return date.toISOString().split('T')[0];
    } catch {
      return dateStr;
    }
  }
  
  protected normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
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
