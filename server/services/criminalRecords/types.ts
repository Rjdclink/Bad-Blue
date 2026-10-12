export interface CriminalSearchQuery {
  fullName: string;
  dateOfBirth?: string;  // YYYY-MM-DD format
  state?: string;        // Two-letter state code
  county?: string;
  docketNumber?: string;
  inmateNumber?: string;
}

export type CriminalSearchStatus = 'sources_discovered' | 'sources_unavailable' | 'partial_results' | 'no_matches_in_checked_sources';

export interface CriminalSourceCoverage {
  source: string;
  url: string;
  status: 'checked' | 'partial' | 'unavailable' | 'not_configured' | 'manual_required' | 'not_checked';
  recordsFound: number;
  retrievedAt: string;
  note: string;
}

export interface CriminalCaseCandidate {
  caseNumber: string;
  court: string;
  title: string;
  sourceUrl: string;
  retrievedAt: string;
  filedAt?: string;
  identityStatus: 'unconfirmed';
  charges: Array<{ count?: string; description: string; statute?: string; offenseDate?: string; disposition?: string; dispositionDate?: string }>;
  documents: Array<{ title: string; sourceUrl: string; excerpt: string; retrievedAt: string }>;
}

export interface CriminalCustodyCandidate {
  fullName: string;
  inmateNumber: string;
  facility?: string;
  age?: number;
  status: string;
  releaseDate?: string;
  identityStatus: 'unconfirmed' | 'identifier_matched';
  sourceUrl: string;
  retrievedAt: string;
}

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
    registered: boolean | null;
    searchStatus?: 'not_checked' | 'checked';
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
  riskScore?: number | null;
  scrapedAt: Date;
  searchStatus?: CriminalSearchStatus;
  sourceDiscovery?: import('./CriminalSourceDiscovery').CriminalSourceDiscovery[];
  caseCandidates?: CriminalCaseCandidate[];
  custodyCandidates?: CriminalCustodyCandidate[];
  coverage?: CriminalSourceCoverage[];
  recordsDetermined?: boolean;
  coverageLimited?: boolean;
  coverageNote?: string;
}

// Legacy compatibility interface - to be removed in future version
export interface ScraperResult {
  success: boolean;
  records: Partial<CriminalRecord>[];
  source: string;
  confidence: number;
  error?: string;
}
