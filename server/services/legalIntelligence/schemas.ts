/**
 * Legal Document Extraction Schemas
 * Pre-defined schemas for structured data extraction from legal documents
 * Used with semantic extractor for LLM-powered extraction
 */

import { z } from 'zod';

/**
 * Base schema interface for extraction
 */
export interface ExtractionSchema {
  name: string;
  description: string;
  schema: z.ZodType<any>;
  extractionPrompt: string;
}

/**
 * Court Docket Schema
 * For extracting structured data from court docket pages
 */
export const CourtDocketSchema = z.object({
  caseNumber: z.string().describe('The case number or docket number'),
  caseName: z.string().describe('Full case name (parties)'),
  court: z.string().describe('Name of the court'),
  judge: z.string().optional().describe('Presiding judge name'),
  parties: z.object({
    plaintiffs: z.array(z.string()).describe('List of plaintiff names'),
    defendants: z.array(z.string()).describe('List of defendant names'),
  }),
  status: z.string().describe('Current case status'),
  filingDate: z.string().optional().describe('Date case was filed'),
  filings: z.array(z.object({
    date: z.string().describe('Filing date'),
    description: z.string().describe('Description of filing'),
    document: z.string().optional().describe('Document name or type'),
  })).optional().describe('Recent filings'),
  nextHearing: z.string().optional().describe('Next scheduled hearing date'),
});

export type CourtDocket = z.infer<typeof CourtDocketSchema>;

export const COURT_DOCKET: ExtractionSchema = {
  name: 'court_docket',
  description: 'Extract structured data from court docket pages',
  schema: CourtDocketSchema,
  extractionPrompt: `Extract court docket information from the provided legal document.
Focus on: case number, case name, court, judge, parties (plaintiffs and defendants), case status, filing date, recent filings, and next hearing date.
Only include information that is clearly stated in the document.`,
};

/**
 * Statute Schema
 * For extracting statutory text and metadata
 */
export const StatuteSchema = z.object({
  citation: z.string().describe('Full statutory citation'),
  title: z.string().describe('Title or short name of the statute'),
  jurisdiction: z.string().describe('State or federal jurisdiction'),
  text: z.string().describe('Full text of the statute'),
  amendments: z.array(z.object({
    date: z.string().describe('Amendment date'),
    description: z.string().describe('Description of amendment'),
  })).optional().describe('Amendment history'),
  effectiveDate: z.string().optional().describe('Effective date of statute'),
  relatedStatutes: z.array(z.string()).optional().describe('Related statute citations'),
  keywords: z.array(z.string()).optional().describe('Key legal terms'),
});

export type Statute = z.infer<typeof StatuteSchema>;

export const STATUTE: ExtractionSchema = {
  name: 'statute',
  description: 'Extract statute text and metadata from legal code pages',
  schema: StatuteSchema,
  extractionPrompt: `Extract statute information from the provided legal document.
Focus on: citation, title, jurisdiction, full text, amendments, effective date, related statutes, and keywords.
Preserve the exact statutory text without modification.`,
};

/**
 * Officer Record Schema
 * For extracting law enforcement officer information
 */
export const OfficerRecordSchema = z.object({
  name: z.string().describe('Officer full name'),
  badge: z.string().optional().describe('Badge number'),
  department: z.string().describe('Police department or agency'),
  rank: z.string().optional().describe('Officer rank or title'),
  location: z.object({
    city: z.string().optional(),
    state: z.string().optional(),
  }).optional().describe('Department location'),
  complaints: z.array(z.object({
    date: z.string().optional().describe('Complaint date'),
    type: z.string().describe('Type of complaint'),
    disposition: z.string().optional().describe('Complaint outcome'),
    description: z.string().optional().describe('Complaint details'),
  })).optional().describe('Complaints or disciplinary actions'),
  certifications: z.array(z.object({
    type: z.string().describe('Certification type'),
    date: z.string().optional().describe('Certification date'),
    status: z.string().optional().describe('Certification status (active/expired)'),
  })).optional().describe('Officer certifications'),
  yearsOfService: z.number().optional().describe('Years in law enforcement'),
  contactInfo: z.object({
    email: z.string().optional(),
    phone: z.string().optional(),
  }).optional().describe('Contact information'),
});

export type OfficerRecord = z.infer<typeof OfficerRecordSchema>;

export const OFFICER_RECORD: ExtractionSchema = {
  name: 'officer_record',
  description: 'Extract law enforcement officer records from transparency portals',
  schema: OfficerRecordSchema,
  extractionPrompt: `Extract law enforcement officer information from the provided document.
Focus on: name, badge number, department, rank, location, complaints, certifications, years of service, and contact information.
Include all complaints and disciplinary actions mentioned.`,
};

/**
 * Case Opinion Schema
 * For extracting judicial opinions and holdings
 */
export const CaseOpinionSchema = z.object({
  caseName: z.string().describe('Full case name'),
  citation: z.string().describe('Official case citation'),
  court: z.string().describe('Court that issued the opinion'),
  decisionDate: z.string().optional().describe('Date of decision'),
  judges: z.array(z.string()).optional().describe('Judges on the panel'),
  holdingType: z.enum(['affirmed', 'reversed', 'remanded', 'dismissed', 'other']).optional().describe('Type of holding'),
  holding: z.string().describe('Main holding or outcome'),
  reasoning: z.string().describe('Court\'s reasoning and analysis'),
  facts: z.string().optional().describe('Relevant facts of the case'),
  legalIssues: z.array(z.string()).optional().describe('Legal issues addressed'),
  precedents: z.array(z.object({
    caseName: z.string().describe('Precedent case name'),
    citation: z.string().optional().describe('Precedent citation'),
  })).optional().describe('Cases cited as precedent'),
  keywords: z.array(z.string()).optional().describe('Legal topics and keywords'),
});

export type CaseOpinion = z.infer<typeof CaseOpinionSchema>;

export const CASE_OPINION: ExtractionSchema = {
  name: 'case_opinion',
  description: 'Extract judicial opinions and case holdings',
  schema: CaseOpinionSchema,
  extractionPrompt: `Extract case opinion information from the provided judicial document.
Focus on: case name, citation, court, decision date, judges, holding, reasoning, facts, legal issues, precedents cited, and keywords.
Preserve key legal reasoning verbatim where possible.`,
};

/**
 * Get schema by name
 */
export function getSchemaByName(name: string): ExtractionSchema | undefined {
  const schemas = {
    court_docket: COURT_DOCKET,
    statute: STATUTE,
    officer_record: OFFICER_RECORD,
    case_opinion: CASE_OPINION,
  };
  
  return schemas[name as keyof typeof schemas];
}

/**
 * Get all available schemas
 */
export function getAllSchemas(): ExtractionSchema[] {
  return [
    COURT_DOCKET,
    STATUTE,
    OFFICER_RECORD,
    CASE_OPINION,
  ];
}

/**
 * Validate extracted data against schema
 */
export function validateExtraction(schemaName: string, data: any): { success: boolean; data?: any; errors?: string[] } {
  const schema = getSchemaByName(schemaName);
  
  if (!schema) {
    return { success: false, errors: [`Unknown schema: ${schemaName}`] };
  }
  
  try {
    const validated = schema.schema.parse(data);
    return { success: true, data: validated };
  } catch (error: any) {
    const errors = error.errors?.map((e: any) => `${e.path.join('.')}: ${e.message}`) || [error.message];
    return { success: false, errors };
  }
}
