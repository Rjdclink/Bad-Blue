/**
 * 10 RAZORS - Implementation
 * Fast, specialized crawlers for targeted data extraction
 */

import { BaseRazor } from './BaseRazor';
import { RazorType } from './types';

// ============================================================================
// RAZOR 1: IDENTITY - Name/identity extraction
// ============================================================================
export class IdentityRazor extends BaseRazor {
  readonly type = RazorType.IDENTITY;
  readonly patterns = [
    /(?:name|fullname|full_name)[:\s]*["']?([A-Z][a-z]+ [A-Z][a-z]+)/gi,
    /<(?:h1|h2|h3|title)[^>]*>([A-Z][a-z]+ [A-Z][a-z]+)/gi,
  ];

  async extract(html: string, _url: string) {
    const names = this.matchPatterns(html);
    const ageMatch = html.match(/(?:age|born)[:\s]*(\d{1,3})/i);
    const dobMatch = html.match(/(?:dob|birth)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    
    return {
      names: names.slice(0, 5),
      age: ageMatch?.[1] ? parseInt(ageMatch[1]) : null,
      dateOfBirth: dobMatch?.[1] || null,
    };
  }
}

// ============================================================================
// RAZOR 2: CONTACT - Phone/email extraction
// ============================================================================
export class ContactRazor extends BaseRazor {
  readonly type = RazorType.CONTACT;
  readonly patterns = [
    /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi,
    /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
  ];

  async extract(html: string, _url: string) {
    const all = this.matchPatterns(html);
    const emails = all.filter(m => m.includes('@'));
    const phones = all.filter(m => !m.includes('@') && /\d{10}/.test(m.replace(/\D/g, '')));
    
    return {
      emails: [...new Set(emails)].slice(0, 10),
      phones: [...new Set(phones.map(p => p.replace(/\D/g, '')))].slice(0, 10),
    };
  }
}

// ============================================================================
// RAZOR 3: ADDRESS - Location/address extraction
// ============================================================================
export class AddressRazor extends BaseRazor {
  readonly type = RazorType.ADDRESS;
  readonly patterns = [
    /\d{1,5}\s+[\w\s]+(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court)[,.\s]+[\w\s]+[,.\s]+[A-Z]{2}\s+\d{5}/gi,
    /(?:address|location)[:\s]*([^<\n]{10,100})/gi,
  ];

  async extract(html: string, _url: string) {
    const addresses = this.matchPatterns(html);
    const cityMatch = html.match(/(?:city)[:\s]*["']?([A-Za-z\s]+)/i);
    const stateMatch = html.match(/(?:state)[:\s]*["']?([A-Z]{2})/i);
    const zipMatch = html.match(/\b(\d{5}(?:-\d{4})?)\b/);
    
    return {
      addresses: addresses.slice(0, 5),
      city: cityMatch?.[1]?.trim() || null,
      state: stateMatch?.[1] || null,
      zip: zipMatch?.[1] || null,
    };
  }
}

// ============================================================================
// RAZOR 4: SOCIAL - Social media profile extraction
// ============================================================================
export class SocialRazor extends BaseRazor {
  readonly type = RazorType.SOCIAL;
  readonly patterns = [
    /(?:facebook\.com|fb\.com)\/[\w.-]+/gi,
    /twitter\.com\/[\w]+/gi,
    /(?:linkedin\.com\/in|linkedin\.com\/pub)\/[\w-]+/gi,
    /instagram\.com\/[\w.]+/gi,
    /tiktok\.com\/@[\w.]+/gi,
  ];

  async extract(html: string, _url: string) {
    const profiles = this.matchPatterns(html);
    const categorized: Record<string, string[]> = {
      facebook: [],
      twitter: [],
      linkedin: [],
      instagram: [],
      tiktok: [],
      other: [],
    };
    
    for (const p of profiles) {
      if (p.includes('facebook') || p.includes('fb.com')) categorized.facebook.push(p);
      else if (p.includes('twitter')) categorized.twitter.push(p);
      else if (p.includes('linkedin')) categorized.linkedin.push(p);
      else if (p.includes('instagram')) categorized.instagram.push(p);
      else if (p.includes('tiktok')) categorized.tiktok.push(p);
      else categorized.other.push(p);
    }
    
    return categorized;
  }
}

// ============================================================================
// RAZOR 5: RECORD - Public records extraction
// ============================================================================
export class RecordRazor extends BaseRazor {
  readonly type = RazorType.RECORD;
  readonly patterns = [
    /case\s*(?:#|no\.?|number)[:\s]*([A-Z0-9-]+)/gi,
    /(?:license|permit)\s*(?:#|no\.?|number)[:\s]*([A-Z0-9-]+)/gi,
    /(?:ssn|social)[:\s]*(?:\d{3}[-\s]?\d{2}[-\s]?\d{4}|\*{3}-\*{2}-\d{4})/gi,
  ];

  async extract(html: string, _url: string) {
    const records = this.matchPatterns(html);
    const caseNumbers = records.filter(r => /case/i.test(r));
    const licenses = records.filter(r => /license|permit/i.test(r));
    
    return {
      caseNumbers: caseNumbers.slice(0, 10),
      licenses: licenses.slice(0, 10),
      recordCount: records.length,
    };
  }
}

// ============================================================================
// RAZOR 6: ASSET - Property/asset data extraction
// ============================================================================
export class AssetRazor extends BaseRazor {
  readonly type = RazorType.ASSET;
  readonly patterns = [
    /(?:property|parcel)\s*(?:id|#)[:\s]*([A-Z0-9-]+)/gi,
    /(?:assessed|market)\s*value[:\s]*\$?([\d,]+)/gi,
    /(?:vin|vehicle)[:\s]*([A-Z0-9]{17})/gi,
  ];

  async extract(html: string, _url: string) {
    const valueMatch = html.match(/\$\s*([\d,]+(?:\.\d{2})?)/g);
    const values = valueMatch?.map(v => parseFloat(v.replace(/[$,]/g, ''))) || [];
    
    return {
      propertyIds: this.matchPatterns(html).slice(0, 5),
      estimatedValues: values.filter(v => v > 1000).slice(0, 5),
      hasAssets: values.length > 0,
    };
  }
}

// ============================================================================
// RAZOR 7: COURT - Court/legal records extraction
// ============================================================================
export class CourtRazor extends BaseRazor {
  readonly type = RazorType.COURT;
  readonly patterns = [
    /(?:case|docket)\s*(?:#|no\.?)[:\s]*([A-Z0-9:-]+)/gi,
    /(?:plaintiff|defendant)[:\s]*([A-Z][a-z]+ [A-Z][a-z]+)/gi,
    /(?:filed|judgment)\s*(?:date)?[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
  ];

  async extract(html: string, _url: string) {
    const matches = this.matchPatterns(html);
    const courtMatch = html.match(/(?:circuit|district|superior|municipal)\s*court/gi);
    const statusMatch = html.match(/(?:status|disposition)[:\s]*([A-Za-z\s]+)/i);
    
    return {
      caseNumbers: matches.filter(m => /case|docket/i.test(m)).slice(0, 5),
      parties: matches.filter(m => /plaintiff|defendant/i.test(m)).slice(0, 5),
      courts: courtMatch?.slice(0, 3) || [],
      status: statusMatch?.[1]?.trim() || null,
    };
  }
}

// ============================================================================
// RAZOR 8: BUSINESS - Business/corporate data extraction
// ============================================================================
export class BusinessRazor extends BaseRazor {
  readonly type = RazorType.BUSINESS;
  readonly patterns = [
    /(?:llc|inc|corp|ltd|company)[:\s]*/gi,
    /(?:ein|tax\s*id)[:\s]*(\d{2}-\d{7})/gi,
    /(?:dba|doing\s*business\s*as)[:\s]*([A-Za-z0-9\s]+)/gi,
  ];

  async extract(html: string, _url: string) {
    const businessNames = html.match(/([A-Z][a-zA-Z0-9\s]+(?:LLC|Inc|Corp|Ltd))/g);
    const einMatch = html.match(/\d{2}-\d{7}/g);
    const dbaMatch = html.match(/(?:dba|d\/b\/a)[:\s]*([A-Za-z0-9\s]+)/gi);
    
    return {
      businessNames: businessNames?.slice(0, 5) || [],
      einNumbers: einMatch?.slice(0, 3) || [],
      dbas: dbaMatch?.slice(0, 3) || [],
      isBusinessEntity: (businessNames?.length || 0) > 0,
    };
  }
}

// ============================================================================
// RAZOR 9: RELATION - Relationships/associates extraction
// ============================================================================
export class RelationRazor extends BaseRazor {
  readonly type = RazorType.RELATION;
  readonly patterns = [
    /(?:spouse|wife|husband|partner)[:\s]*([A-Z][a-z]+ [A-Z][a-z]+)/gi,
    /(?:relative|family|associate)[:\s]*([A-Z][a-z]+ [A-Z][a-z]+)/gi,
    /(?:mother|father|son|daughter|brother|sister)[:\s]*([A-Z][a-z]+ [A-Z][a-z]+)/gi,
  ];

  async extract(html: string, _url: string) {
    const relations = this.matchPatterns(html);
    const spouseMatch = html.match(/(?:spouse|wife|husband)[:\s]*([A-Z][a-z]+ [A-Z][a-z]+)/i);
    
    return {
      associates: relations.slice(0, 10),
      spouse: spouseMatch?.[1] || null,
      relationCount: relations.length,
    };
  }
}

// ============================================================================
// RAZOR 10: MEDIA - News/media mentions extraction
// ============================================================================
export class MediaRazor extends BaseRazor {
  readonly type = RazorType.MEDIA;
  readonly patterns = [
    /(?:published|posted|updated)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
    /<(?:article|news)[^>]*>([^<]+)/gi,
    /(?:headline|title)[:\s]*["']?([^"'\n<]+)/gi,
  ];

  async extract(html: string, url: string) {
    const headlines = this.matchPatterns(html);
    const dateMatch = html.match(/(?:published|posted)[:\s]*([A-Za-z]+ \d{1,2},? \d{4})/i);
    const authorMatch = html.match(/(?:by|author)[:\s]*([A-Z][a-z]+ [A-Z][a-z]+)/i);
    
    return {
      headlines: headlines.slice(0, 5),
      publishDate: dateMatch?.[1] || null,
      author: authorMatch?.[1] || null,
      sourceUrl: url,
    };
  }
}

// ============================================================================
// EXPORT ALL 10 RAZORS
// ============================================================================
export const ALL_RAZORS = [
  IdentityRazor,
  ContactRazor,
  AddressRazor,
  SocialRazor,
  RecordRazor,
  AssetRazor,
  CourtRazor,
  BusinessRazor,
  RelationRazor,
  MediaRazor,
] as const;

export function createAllRazors(): BaseRazor[] {
  return ALL_RAZORS.map(RazorClass => new RazorClass());
}
