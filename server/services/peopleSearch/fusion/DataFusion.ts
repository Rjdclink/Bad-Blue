/**
 * Data fusion module for merging and deduplicating person records
 */
import type { PersonRecord, Address, Phone } from '../types';

export class DataFusion {
  /**
   * Merge multiple PersonRecords into one fused record
   */
  static fuseRecords(records: PersonRecord[]): PersonRecord {
    if (records.length === 0) {
      throw new Error('Cannot fuse empty records array');
    }

    if (records.length === 1) {
      return records[0];
    }

    // Find highest confidence record for base data
    const sortedByConfidence = [...records].sort((a, b) => b.confidence - a.confidence);
    const primaryRecord = sortedByConfidence[0];

    // Collect all unique data
    const allAddresses = records.flatMap(r => r.addresses);
    const allPhones = records.flatMap(r => r.phones);
    const allEmails = records.flatMap(r => r.emails);
    const allRelatives = records.flatMap(r => r.relatives);
    const allAliases = records.flatMap(r => r.aliases);

    // Deduplicate
    const uniqueAddresses = this.deduplicateAddresses(allAddresses);
    const uniquePhones = this.deduplicatePhones(allPhones);
    const uniqueEmails = this.deduplicateEmails(allEmails);
    const uniqueRelatives = this.deduplicateStrings(allRelatives);
    const uniqueAliases = this.deduplicateStrings(allAliases);

    // Calculate weighted average confidence (average of all source confidences)
    const totalConfidence = records.reduce((sum, r) => sum + r.confidence, 0);
    const avgConfidence = totalConfidence / records.length;

    // Collect all source names
    const sources = records.map(r => r.source).join(', ');

    return {
      fullName: primaryRecord.fullName,
      age: primaryRecord.age,
      addresses: uniqueAddresses,
      phones: uniquePhones,
      emails: uniqueEmails,
      relatives: uniqueRelatives,
      aliases: uniqueAliases,
      source: `Fused from ${records.length} sources: ${sources}`,
      confidence: avgConfidence,
      scrapedAt: new Date(),
    };
  }

  /**
   * Deduplicate addresses by comparing normalized key
   */
  private static deduplicateAddresses(addresses: Address[]): Address[] {
    const seen = new Set<string>();
    const unique: Address[] = [];

    for (const addr of addresses) {
      const key = this.getAddressKey(addr);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(addr);
      }
    }

    return unique;
  }

  /**
   * Generate normalized key for address comparison
   */
  private static getAddressKey(addr: Address): string {
    return `${addr.street}-${addr.city}-${addr.state}-${addr.zip}`.toLowerCase();
  }

  /**
   * Deduplicate phones by comparing normalized numbers
   */
  private static deduplicatePhones(phones: Phone[]): Phone[] {
    const seen = new Set<string>();
    const unique: Phone[] = [];

    for (const phone of phones) {
      if (!seen.has(phone.number)) {
        seen.add(phone.number);
        unique.push(phone);
      }
    }

    return unique;
  }

  /**
   * Deduplicate emails (case-insensitive)
   */
  private static deduplicateEmails(emails: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];

    for (const email of emails) {
      const normalized = email.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        unique.push(email);
      }
    }

    return unique;
  }

  /**
   * Deduplicate strings (exact match)
   */
  private static deduplicateStrings(strings: string[]): string[] {
    return Array.from(new Set(strings));
  }
}
