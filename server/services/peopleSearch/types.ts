/**
 * Core interfaces for People Search Aggregator
 */

export interface SearchQuery {
  firstName: string;
  lastName: string;
  city?: string;
  state?: string;
  age?: number;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
  type?: 'current' | 'previous';
}

export interface Phone {
  number: string;  // Normalized (10 digits)
  type?: 'mobile' | 'landline' | 'voip';
}

export interface PersonRecord {
  fullName: string;
  age?: number;
  addresses: Address[];
  phones: Phone[];
  emails: string[];
  relatives: string[];
  aliases: string[];
  source: string;
  confidence: number;  // 0.0 - 1.0
  scrapedAt: Date;
}
