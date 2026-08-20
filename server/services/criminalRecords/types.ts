export interface CriminalSearchQuery {
  fullName: string;
  dateOfBirth?: string;  // YYYY-MM-DD format
  state?: string;        // Two-letter state code
  county?: string;
}

export type CriminalSearchStatus = 'sources_discovered' | 'sources_unavailable';

export interface CriminalRecord {
  fullName: string;
  dateOfBirth?: string;
  
  charges: Array<{
    charge: string;
    statute: string;
    degree: 'felony' | 'misdemeanor' | 'infraction';
    date: string;
    disposition?: string;  // guilty, dismissed, pending
    sentence?: string;
  }>;
  
  arrests: Array<{
    date: string;
    agency: string;
    charges: string[];
  }>;
  
  convictions: Array<{
    date: string;
    charge: string;
    court: string;
    sentence: string;
  }>;
  
  activeWarrants: Array<{
    issueDate: string;
    charge: string;
    jurisdiction: string;
    bondAmount?: string;
  }>;
  
  sexOffenderStatus: {
    registered: boolean;
    tier?: 1 | 2 | 3;
    offenses?: string[];
    registrationDate?: string;
  };
  
  incarcerationHistory: Array<{
    facility: string;
    inDate: string;
    outDate?: string;
    status: 'incarcerated' | 'released' | 'paroled';
  }>;
  
  source: string;
  confidence: number;  // 0-1
  riskScore?: number;  // 0-10
  scrapedAt: Date;
  searchStatus?: CriminalSearchStatus;
  sourceDiscovery?: import('./CriminalSourceDiscovery').CriminalSourceDiscovery[];
}

// Legacy compatibility interface - to be removed in future version
export interface ScraperResult {
  success: boolean;
  records: Partial<CriminalRecord>[];
  source: string;
  confidence: number;
  error?: string;
}
