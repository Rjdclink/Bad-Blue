/**
 * Legal Expert System
 * Generates law-specific expert profiles with specialized knowledge and characteristics
 * Phase 1A: Backend infrastructure for intelligent legal consultation
 */

import { ExpertProfile } from '../shared/legalCounselTypes';

/**
 * Expert profile configurations for each law type
 * Each profile includes specialty, experience level, tone, meticulousness, and focus areas
 */
const expertProfiles: Record<string, ExpertProfile> = {
  'law-enforcement-accountability': {
    specialty: 'Civil Rights & Police Accountability',
    yearsExperience: 15,
    tone: 'authoritative',
    meticulousness: 9,
    focusAreas: [
      'Section 1983 claims',
      'Fourth Amendment violations',
      'Excessive force cases',
      'Qualified immunity',
      'Police misconduct documentation'
    ]
  },
  'criminal-law': {
    specialty: 'Criminal Defense',
    yearsExperience: 12,
    tone: 'analytical',
    meticulousness: 10,
    focusAreas: [
      'Constitutional rights',
      'Evidence suppression',
      'Plea negotiations',
      'Sentencing guidelines',
      'Appeal procedures'
    ]
  },
  'family-law': {
    specialty: 'Family Law & Domestic Relations',
    yearsExperience: 10,
    tone: 'empathetic',
    meticulousness: 8,
    focusAreas: [
      'Custody arrangements',
      'Child support calculations',
      'Divorce proceedings',
      'Domestic violence protection',
      'Property division'
    ]
  },
  'employment-law': {
    specialty: 'Employment & Labor Law',
    yearsExperience: 11,
    tone: 'balanced',
    meticulousness: 8,
    focusAreas: [
      'Wrongful termination',
      'Discrimination claims',
      'Wage and hour disputes',
      'FMLA violations',
      'Harassment complaints'
    ]
  },
  'personal-injury': {
    specialty: 'Personal Injury & Torts',
    yearsExperience: 14,
    tone: 'empathetic',
    meticulousness: 9,
    focusAreas: [
      'Negligence claims',
      'Medical malpractice',
      'Damages assessment',
      'Insurance negotiations',
      'Accident reconstruction'
    ]
  },
  'civil-rights': {
    specialty: 'Civil Rights Litigation',
    yearsExperience: 13,
    tone: 'authoritative',
    meticulousness: 10,
    focusAreas: [
      'Constitutional violations',
      'Discrimination cases',
      'First Amendment issues',
      'Equal protection claims',
      'Injunctive relief'
    ]
  },
  'immigration-law': {
    specialty: 'Immigration Law',
    yearsExperience: 9,
    tone: 'empathetic',
    meticulousness: 9,
    focusAreas: [
      'Visa applications',
      'Asylum claims',
      'Deportation defense',
      'Citizenship procedures',
      'Family-based petitions'
    ]
  },
  'real-estate-law': {
    specialty: 'Real Estate Law',
    yearsExperience: 12,
    tone: 'analytical',
    meticulousness: 8,
    focusAreas: [
      'Property transactions',
      'Title disputes',
      'Landlord-tenant issues',
      'Zoning regulations',
      'Contract disputes'
    ]
  },
  'business-law': {
    specialty: 'Business & Commercial Law',
    yearsExperience: 13,
    tone: 'analytical',
    meticulousness: 8,
    focusAreas: [
      'Entity formation',
      'Contract negotiations',
      'Partnership disputes',
      'Business transactions',
      'Commercial litigation'
    ]
  },
  'bankruptcy-law': {
    specialty: 'Bankruptcy Law',
    yearsExperience: 11,
    tone: 'empathetic',
    meticulousness: 9,
    focusAreas: [
      'Chapter 7 liquidation',
      'Chapter 13 reorganization',
      'Debt discharge',
      'Asset protection',
      'Creditor negotiations'
    ]
  },
  'tax-law': {
    specialty: 'Tax Law',
    yearsExperience: 14,
    tone: 'analytical',
    meticulousness: 10,
    focusAreas: [
      'IRS disputes',
      'Tax planning',
      'Audit representation',
      'Tax liens',
      'Penalty abatement'
    ]
  },
  'intellectual-property': {
    specialty: 'Intellectual Property Law',
    yearsExperience: 10,
    tone: 'analytical',
    meticulousness: 9,
    focusAreas: [
      'Patent applications',
      'Trademark registration',
      'Copyright protection',
      'Trade secret disputes',
      'IP litigation'
    ]
  },
  'environmental-law': {
    specialty: 'Environmental Law',
    yearsExperience: 11,
    tone: 'authoritative',
    meticulousness: 9,
    focusAreas: [
      'EPA regulations',
      'Environmental compliance',
      'Pollution control',
      'Natural resource protection',
      'Environmental impact assessments'
    ]
  },
  'healthcare-law': {
    specialty: 'Healthcare Law',
    yearsExperience: 12,
    tone: 'balanced',
    meticulousness: 9,
    focusAreas: [
      'Medical malpractice',
      'HIPAA compliance',
      'Healthcare fraud',
      'Patient rights',
      'Medical device liability'
    ]
  },
  'education-law': {
    specialty: 'Education Law',
    yearsExperience: 9,
    tone: 'empathetic',
    meticulousness: 8,
    focusAreas: [
      'Special education rights',
      'Student discipline',
      'Title IX issues',
      'Educational accommodations',
      'School policy disputes'
    ]
  },
  'elder-law': {
    specialty: 'Elder Law',
    yearsExperience: 11,
    tone: 'empathetic',
    meticulousness: 8,
    focusAreas: [
      'Medicare/Medicaid planning',
      'Guardianship proceedings',
      'Elder abuse protection',
      'Long-term care planning',
      'Senior rights advocacy'
    ]
  },
  'estate-planning': {
    specialty: 'Estate Planning & Probate',
    yearsExperience: 13,
    tone: 'analytical',
    meticulousness: 9,
    focusAreas: [
      'Will preparation',
      'Trust administration',
      'Probate proceedings',
      'Estate tax planning',
      'Asset distribution'
    ]
  },
  'contract-law': {
    specialty: 'Contract Law',
    yearsExperience: 12,
    tone: 'analytical',
    meticulousness: 9,
    focusAreas: [
      'Contract drafting',
      'Breach of contract',
      'Contract interpretation',
      'Remedies and damages',
      'Commercial agreements'
    ]
  },
  'tort-law': {
    specialty: 'Tort Law',
    yearsExperience: 13,
    tone: 'balanced',
    meticulousness: 9,
    focusAreas: [
      'Negligence claims',
      'Intentional torts',
      'Strict liability',
      'Damages calculation',
      'Comparative fault'
    ]
  },
  'administrative-law': {
    specialty: 'Administrative Law',
    yearsExperience: 11,
    tone: 'authoritative',
    meticulousness: 9,
    focusAreas: [
      'Agency regulations',
      'Administrative procedures',
      'Regulatory compliance',
      'Government permits',
      'Administrative appeals'
    ]
  },
  'constitutional-law': {
    specialty: 'Constitutional Law',
    yearsExperience: 15,
    tone: 'authoritative',
    meticulousness: 10,
    focusAreas: [
      'Constitutional rights',
      'First Amendment issues',
      'Due process claims',
      'Equal protection',
      'Federal jurisdiction'
    ]
  },
  'consumer-protection': {
    specialty: 'Consumer Protection Law',
    yearsExperience: 10,
    tone: 'empathetic',
    meticulousness: 8,
    focusAreas: [
      'Fraud claims',
      'Deceptive practices',
      'Product liability',
      'Consumer rights',
      'Class actions'
    ]
  },
  'landlord-tenant': {
    specialty: 'Landlord-Tenant Law',
    yearsExperience: 9,
    tone: 'balanced',
    meticulousness: 8,
    focusAreas: [
      'Lease agreements',
      'Eviction proceedings',
      'Security deposits',
      'Habitability issues',
      'Tenant rights'
    ]
  },
  'traffic-violations': {
    specialty: 'Traffic Law',
    yearsExperience: 8,
    tone: 'analytical',
    meticulousness: 7,
    focusAreas: [
      'Traffic citations',
      'License suspensions',
      'Traffic court procedures',
      'Points reduction',
      'Insurance impact'
    ]
  },
  'dui-dwi': {
    specialty: 'DUI/DWI Defense',
    yearsExperience: 11,
    tone: 'analytical',
    meticulousness: 10,
    focusAreas: [
      'Field sobriety tests',
      'Breathalyzer challenges',
      'License hearings',
      'BAC evidence',
      'DUI defenses'
    ]
  },
  'expungement': {
    specialty: 'Expungement & Record Sealing',
    yearsExperience: 9,
    tone: 'empathetic',
    meticulousness: 8,
    focusAreas: [
      'Eligibility requirements',
      'Record sealing procedures',
      'Petition preparation',
      'Court hearings',
      'Post-conviction relief'
    ]
  },
  'juvenile-law': {
    specialty: 'Juvenile Law',
    yearsExperience: 10,
    tone: 'empathetic',
    meticulousness: 9,
    focusAreas: [
      'Juvenile court procedures',
      'Delinquency cases',
      'Rehabilitation programs',
      'Juvenile rights',
      'Sealing juvenile records'
    ]
  },
  'military-law': {
    specialty: 'Military Law & Veterans Affairs',
    yearsExperience: 12,
    tone: 'authoritative',
    meticulousness: 9,
    focusAreas: [
      'Court-martial proceedings',
      'Military discharge upgrades',
      'VA benefits claims',
      'Military justice',
      'Service-connected disabilities'
    ]
  },
  'whistleblower-protection': {
    specialty: 'Whistleblower Protection',
    yearsExperience: 11,
    tone: 'authoritative',
    meticulousness: 10,
    focusAreas: [
      'Qui tam actions',
      'Retaliation claims',
      'False Claims Act',
      'Protected disclosures',
      'Whistleblower rewards'
    ]
  }
};

/**
 * Get expert profile for a specific law type
 */
export function getExpertProfile(lawType: string): ExpertProfile {
  // Return the expert profile or a default balanced profile
  return expertProfiles[lawType] || {
    specialty: 'General Legal Practice',
    yearsExperience: 10,
    tone: 'balanced',
    meticulousness: 8,
    focusAreas: [
      'Legal research',
      'Case analysis',
      'Legal documentation',
      'Client advocacy',
      'Legal procedures'
    ]
  };
}

/**
 * Generate a system prompt based on expert profile and context
 */
export function generateExpertPrompt(
  lawType: string,
  state: string,
  context?: Record<string, any>
): string {
  const expert = getExpertProfile(lawType);
  
  const toneDescriptions = {
    empathetic: 'compassionate and understanding, prioritizing the emotional well-being of clients',
    analytical: 'precise and methodical, focusing on logical reasoning and detailed analysis',
    authoritative: 'confident and assertive, drawing on extensive legal knowledge and experience',
    balanced: 'well-rounded and adaptable, combining empathy with analytical rigor'
  };

  return `You are a highly experienced legal expert specializing in ${expert.specialty} with ${expert.yearsExperience} years of practice. 

Your professional characteristics:
- Communication Style: ${toneDescriptions[expert.tone]}
- Attention to Detail: ${expert.meticulousness}/10 (extremely thorough)
- Primary Focus Areas: ${expert.focusAreas.join(', ')}

You are consulting with a client in ${state}. Provide accurate, jurisdiction-specific legal guidance while:

1. Explaining complex legal concepts in clear, accessible language
2. Identifying relevant statutes and case law for ${state}
3. Outlining potential courses of action with pros and cons
4. Highlighting critical deadlines and procedural requirements
5. Suggesting when professional legal representation is essential

Important Disclaimers:
- You provide legal information, not legal advice
- Your guidance does not create an attorney-client relationship
- Recommend consulting with a licensed attorney for specific legal matters
- Emphasize that laws vary by jurisdiction and change over time

${context ? `Additional Context: ${JSON.stringify(context, null, 2)}` : ''}

Provide thorough, accurate, and professionally crafted responses that demonstrate your expertise in ${expert.specialty}.`;
}

/**
 * Get all available law types with their expert specialties
 */
export function getAllExpertProfiles(): Record<string, ExpertProfile> {
  return { ...expertProfiles };
}

/**
 * Validate if a law type has an expert profile
 */
export function hasExpertProfile(lawType: string): boolean {
  return lawType in expertProfiles;
}
