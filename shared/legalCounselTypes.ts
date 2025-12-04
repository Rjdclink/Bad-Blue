// Shared types for Legal Counsel system across client and server

export interface LegalCounselSession {
  id: string;
  userId: string;
  lawType: string;
  state: string;
  createdAt: Date;
  updatedAt: Date;
  context: Record<string, any>;
}

export interface LegalCounselMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  verified: boolean;
  verificationScore: number | null;
  citations: Citation[];
  timestamp: Date;
}

export interface Citation {
  statute: string;
  description: string;
  url?: string;
  verified: boolean;
}

export interface VerificationResult {
  verified: boolean;
  confidence: number;
  models: string[];
  consensus: boolean;
  discrepancies: string[];
  citations: Citation[];
}

export interface ExpertProfile {
  specialty: string;
  yearsExperience: number;
  tone: 'empathetic' | 'analytical' | 'authoritative' | 'balanced';
  meticulousness: number; // 1-10 scale
  focusAreas: string[];
}

export interface LegalCounselSuggestion {
  id: string;
  sessionId: string;
  type: 'document' | 'people-search' | 'evidence-upload' | 'next-step';
  priority: 'high' | 'medium' | 'low';
  data: Record<string, any>;
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: Date;
}

export interface FactCheckRequest {
  claim: string;
  context: {
    lawType: string;
    state: string;
    jurisdiction?: string;
  };
}

export interface FactCheckResponse {
  claim: string;
  verified: boolean;
  confidence: number; // 0-1
  consensus: boolean; // All 3 models agree
  modelResults: {
    model: string;
    verified: boolean;
    reasoning: string;
    sources: string[];
  }[];
  citations: Citation[];
  discrepancies: string[];
  recommendations: string[];
}

export const LAW_TYPES = [
  'law-enforcement-accountability',
  'criminal-law',
  'family-law',
  'employment-law',
  'personal-injury',
  'civil-rights',
  'immigration-law',
  'real-estate-law',
  'business-law',
  'bankruptcy-law',
  'tax-law',
  'intellectual-property',
  'environmental-law',
  'healthcare-law',
  'education-law',
  'elder-law',
  'estate-planning',
  'contract-law',
  'tort-law',
  'administrative-law',
  'constitutional-law',
  'consumer-protection',
  'landlord-tenant',
  'traffic-violations',
  'dui-dwi',
  'expungement',
  'juvenile-law',
  'military-law',
  'whistleblower-protection'
] as const;

export type LawType = typeof LAW_TYPES[number];
