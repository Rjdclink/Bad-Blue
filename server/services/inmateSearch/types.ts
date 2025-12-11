/**
 * Nationwide Inmate Locator System - Type Definitions
 * 
 * Supports searching across:
 * - Federal Bureau of Prisons (BOP)
 * - State Departments of Correction (DOC)
 * - County/Local Jails
 * - Immigration Detention (ICE)
 */

export interface InmateSearchQuery {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth?: string; // YYYY-MM-DD format
  state?: string; // 2-letter state code
  inmateId?: string; // BOP register number or state DOC number
  searchScope?: 'federal' | 'state' | 'county' | 'all';
}

export interface InmateRecord {
  id: string;
  source: InmateSource;
  
  // Personal Information
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  aliases?: string[];
  dateOfBirth?: string;
  age?: number;
  sex?: 'Male' | 'Female' | 'Unknown';
  race?: string;
  
  // Incarceration Details
  inmateNumber: string;
  facilityName: string;
  facilityType: 'Federal Prison' | 'State Prison' | 'County Jail' | 'Immigration Detention' | 'Other';
  facilityLocation: {
    city?: string;
    state?: string;
    address?: string;
  };
  
  // Status
  custodyStatus: 'In Custody' | 'Released' | 'Transferred' | 'Deceased' | 'Unknown';
  releaseDate?: string; // Projected or actual
  admissionDate?: string;
  
  // Charges/Offenses (if available)
  charges?: string[];
  sentenceLength?: string;
  
  // Contact/Visitation (if available)
  visitorInfo?: string;
  
  // Data quality
  confidence: number; // 0-100
  lastUpdated: Date;
  sourceUrl?: string;
}

export type InmateSource = 
  | 'BOP' // Federal Bureau of Prisons
  | 'STATE_DOC' // State Department of Corrections
  | 'COUNTY_JAIL' // County/local jail
  | 'ICE' // Immigration and Customs Enforcement
  | 'VINE' // Victim Information and Notification Everyday
  | 'PUBLIC_RECORDS'; // Aggregated public records

export interface InmateSearchResult {
  query: InmateSearchQuery;
  totalResults: number;
  inmates: InmateRecord[];
  sources: {
    source: InmateSource;
    searched: boolean;
    resultsCount: number;
    error?: string;
  }[];
  searchDuration: number; // milliseconds
  cached: boolean;
  disclaimer: string;
}

export interface StateCorrectionsInfo {
  state: string;
  stateName: string;
  departmentName: string;
  searchUrl?: string;
  apiAvailable: boolean;
  notes?: string;
}

// Cache entry type
export interface CachedInmateSearch {
  result: InmateSearchResult;
  timestamp: number;
  key: string;
}
