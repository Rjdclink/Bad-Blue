/**
 * Legal Counsel Expert System
 * Generates law-specific expert personas for 29 different legal specialties
 * Phase 1A-1: Pure backend logic with zero API or database dependencies
 */

import type { ExpertProfile, LawType } from '../shared/legalCounselTypes';

/**
 * Expert profile configuration for each law type
 */
interface ExpertProfileConfig {
  specialty: string;
  tone: 'empathetic' | 'analytical' | 'authoritative' | 'balanced';
  focusAreas: string[];
  baseMeticulousness: number;
}

/**
 * Configuration map for all 29 law types
 */
const LAW_TYPE_CONFIGS: Record<LawType, ExpertProfileConfig> = {
  'criminal-law': {
    specialty: 'Criminal Defense & Prosecution',
    tone: 'authoritative',
    focusAreas: ['Criminal procedure', 'Constitutional rights', 'Evidence law', 'Sentencing guidelines'],
    baseMeticulousness: 6
  },
  'family-law': {
    specialty: 'Family Law & Domestic Relations',
    tone: 'empathetic',
    focusAreas: ['Divorce', 'Child custody', 'Support obligations', 'Domestic violence'],
    baseMeticulousness: 6
  },
  'employment-law': {
    specialty: 'Employment & Labor Law',
    tone: 'analytical',
    focusAreas: ['Wrongful termination', 'Discrimination', 'Wage disputes', 'Workplace harassment'],
    baseMeticulousness: 7
  },
  'personal-injury': {
    specialty: 'Personal Injury & Tort Law',
    tone: 'empathetic',
    focusAreas: ['Negligence', 'Medical malpractice', 'Product liability', 'Insurance claims'],
    baseMeticulousness: 6
  },
  'civil-rights': {
    specialty: 'Civil Rights & Constitutional Law',
    tone: 'authoritative',
    focusAreas: ['42 U.S.C. § 1983', 'First Amendment', 'Equal protection', 'Due process'],
    baseMeticulousness: 6
  },
  'immigration-law': {
    specialty: 'Immigration & Nationality Law',
    tone: 'empathetic',
    focusAreas: ['Visa applications', 'Deportation defense', 'Citizenship', 'Asylum'],
    baseMeticulousness: 9
  },
  'real-estate-law': {
    specialty: 'Real Estate & Property Law',
    tone: 'analytical',
    focusAreas: ['Transactions', 'Title issues', 'Landlord-tenant', 'Zoning'],
    baseMeticulousness: 7
  },
  'business-law': {
    specialty: 'Business & Commercial Law',
    tone: 'analytical',
    focusAreas: ['Corporate formation', 'Contracts', 'Mergers & acquisitions', 'Compliance'],
    baseMeticulousness: 7
  },
  'bankruptcy-law': {
    specialty: 'Bankruptcy & Debt Relief',
    tone: 'balanced',
    focusAreas: ['Chapter 7', 'Chapter 13', 'Creditor rights', 'Asset protection'],
    baseMeticulousness: 9
  },
  'tax-law': {
    specialty: 'Tax Law & IRS Representation',
    tone: 'analytical',
    focusAreas: ['Tax disputes', 'Audit defense', 'Tax planning', 'Collection matters'],
    baseMeticulousness: 9
  },
  'intellectual-property': {
    specialty: 'Intellectual Property Law',
    tone: 'analytical',
    focusAreas: ['Patents', 'Trademarks', 'Copyrights', 'Trade secrets'],
    baseMeticulousness: 9
  },
  'environmental-law': {
    specialty: 'Environmental & Natural Resources Law',
    tone: 'authoritative',
    focusAreas: ['EPA compliance', 'Pollution', 'Land use', 'Environmental impact'],
    baseMeticulousness: 7
  },
  'healthcare-law': {
    specialty: 'Healthcare & Medical Law',
    tone: 'balanced',
    focusAreas: ['HIPAA compliance', 'Medical malpractice', 'Healthcare fraud', 'Licensing'],
    baseMeticulousness: 7
  },
  'education-law': {
    specialty: 'Education Law',
    tone: 'empathetic',
    focusAreas: ['Special education', 'Student rights', 'Title IX', 'School discipline'],
    baseMeticulousness: 6
  },
  'elder-law': {
    specialty: 'Elder Law & Long-Term Care',
    tone: 'empathetic',
    focusAreas: ['Medicare/Medicaid', 'Guardianship', 'Elder abuse', 'Long-term care'],
    baseMeticulousness: 6
  },
  'estate-planning': {
    specialty: 'Estate Planning & Probate',
    tone: 'balanced',
    focusAreas: ['Wills', 'Trusts', 'Probate', 'Estate tax'],
    baseMeticulousness: 9
  },
  'contract-law': {
    specialty: 'Contract & Commercial Law',
    tone: 'analytical',
    focusAreas: ['Contract formation', 'Breach of contract', 'Remedies', 'UCC'],
    baseMeticulousness: 6
  },
  'tort-law': {
    specialty: 'Tort Law & Liability',
    tone: 'authoritative',
    focusAreas: ['Negligence', 'Intentional torts', 'Strict liability', 'Damages'],
    baseMeticulousness: 6
  },
  'administrative-law': {
    specialty: 'Administrative Law & Government Relations',
    tone: 'authoritative',
    focusAreas: ['Agency regulations', 'Administrative hearings', 'Appeals', 'Licensing'],
    baseMeticulousness: 7
  },
  'constitutional-law': {
    specialty: 'Constitutional Law',
    tone: 'authoritative',
    focusAreas: ['Bill of Rights', 'Federalism', 'Separation of powers', 'Constitutional challenges'],
    baseMeticulousness: 9
  },
  'consumer-protection': {
    specialty: 'Consumer Protection Law',
    tone: 'empathetic',
    focusAreas: ['Fraud', 'Unfair practices', 'Warranty issues', 'Debt collection'],
    baseMeticulousness: 6
  },
  'landlord-tenant': {
    specialty: 'Landlord-Tenant Law',
    tone: 'balanced',
    focusAreas: ['Evictions', 'Security deposits', 'Habitability', 'Lease disputes'],
    baseMeticulousness: 6
  },
  'traffic-violations': {
    specialty: 'Traffic & Motor Vehicle Law',
    tone: 'balanced',
    focusAreas: ['Tickets', 'License suspension', 'Traffic court', 'DMV hearings'],
    baseMeticulousness: 6
  },
  'dui-dwi': {
    specialty: 'DUI/DWI Defense',
    tone: 'authoritative',
    focusAreas: ['Breathalyzer', 'Field sobriety', 'License suspension', 'Trial defense'],
    baseMeticulousness: 6
  },
  'expungement': {
    specialty: 'Criminal Record Expungement',
    tone: 'empathetic',
    focusAreas: ['Eligibility', 'Petition process', 'Sealing records', 'Employment barriers'],
    baseMeticulousness: 6
  },
  'juvenile-law': {
    specialty: 'Juvenile Law',
    tone: 'empathetic',
    focusAreas: ['Juvenile court', 'Delinquency', 'Dependency', 'Juvenile rights'],
    baseMeticulousness: 6
  },
  'military-law': {
    specialty: 'Military & Veterans Law',
    tone: 'authoritative',
    focusAreas: ['UCMJ', 'Courts-martial', 'VA benefits', 'Military discharge'],
    baseMeticulousness: 6
  },
  'whistleblower-protection': {
    specialty: 'Whistleblower & Retaliation Law',
    tone: 'empathetic',
    focusAreas: ['False Claims Act', 'Retaliation', 'Qui tam', 'Protected disclosures'],
    baseMeticulousness: 6
  },
  'law-enforcement-accountability': {
    specialty: 'Law Enforcement Accountability & Civil Rights',
    tone: 'authoritative',
    focusAreas: ['Police misconduct', '42 U.S.C. § 1983', 'Excessive force', 'False arrest'],
    baseMeticulousness: 6
  }
};

/**
 * Configuration interface for expert system
 */
export interface ExpertSystemConfig {
  profile: ExpertProfile;
  systemPrompt: string;
  consultationPrompt: string;
  credentials: string;
}

/**
 * Generates an expert profile for a specific law type
 * Returns profile with 25+ years of experience and specialized characteristics
 * 
 * @param lawType - The type of law for which to generate an expert profile
 * @returns ExpertProfile with specialty, experience, tone, meticulousness, and focus areas
 */
export function generateExpertProfile(lawType: LawType): ExpertProfile {
  const config = LAW_TYPE_CONFIGS[lawType];
  
  if (!config) {
    console.warn(`[ExpertSystem] Unknown law type: ${lawType}, using default profile`);
    return {
      specialty: 'General Legal Practice',
      yearsExperience: 25,
      tone: 'balanced',
      meticulousness: 6,
      focusAreas: ['Legal research', 'Case analysis', 'Client advocacy', 'Legal procedures']
    };
  }

  // Generate 25-32 years of experience (25 + 0-7 random years)
  // Note: Using Math.random() to create unique expert personas each time.
  // This simulates real-world variation in expert experience levels.
  // For deterministic testing, callers can set a fixed seed or use the result as-is.
  const yearsExperience = 25 + Math.floor(Math.random() * 8);
  const meticulousness = calculateMeticulousness(lawType);

  return {
    specialty: config.specialty,
    yearsExperience,
    tone: config.tone,
    meticulousness,
    focusAreas: config.focusAreas
  };
}

/**
 * Calculates the meticulousness level (1-10) based on law complexity
 * 
 * @param lawType - The type of law to calculate meticulousness for
 * @returns Number from 1-10 indicating detail level required
 */
export function calculateMeticulousness(lawType: LawType): number {
  const config = LAW_TYPE_CONFIGS[lawType];
  return config?.baseMeticulousness || 6;
}

/**
 * Generates a system prompt for the AI based on expert profile, law type, and jurisdiction
 * 
 * @param profile - The expert profile to base the prompt on
 * @param lawType - The type of law being consulted
 * @param state - The state/jurisdiction for legal guidance
 * @returns System prompt string for AI model
 */
export function generateSystemPrompt(profile: ExpertProfile, lawType: LawType, state: string): string {
  const toneDescriptions = {
    empathetic: 'compassionate and understanding',
    analytical: 'precise and methodical',
    authoritative: 'confident and assertive',
    balanced: 'well-rounded and adaptable'
  };

  // Determine response structure based on meticulousness
  let responseGuidance = '';
  if (profile.meticulousness >= 8) {
    responseGuidance = 'Provide comprehensive responses with 4-6 paragraphs covering all relevant aspects.';
  } else if (profile.meticulousness >= 6) {
    responseGuidance = 'Provide focused responses with 2-3 paragraphs addressing key points.';
  } else {
    responseGuidance = 'Provide concise responses with 1-2 paragraphs highlighting essentials.';
  }

  return `You are a highly experienced legal expert specializing in ${profile.specialty} with ${profile.yearsExperience} years of practice in ${state}.

PROFESSIONAL CHARACTERISTICS:
- Communication Style: ${toneDescriptions[profile.tone]}
- Attention to Detail: ${profile.meticulousness}/10 (${profile.meticulousness >= 8 ? 'extremely thorough' : profile.meticulousness >= 6 ? 'highly detailed' : 'focused on essentials'})
- Primary Expertise: ${profile.focusAreas.join(', ')}

JURISDICTION: Your guidance is tailored specifically to ${state} law. Always cite ${state}-specific statutes, regulations, and case law when applicable.

CORE RESPONSIBILITIES:
1. Accuracy & Fact-Checking: Every legal claim MUST be accurate and verifiable. Cite specific statutes (with section numbers), case law (with citations), and regulations.
2. Source Attribution: Always provide specific legal authorities. Format citations properly (e.g., "Cal. Penal Code § 484", "42 U.S.C. § 1983", "Miranda v. Arizona, 384 U.S. 436 (1966)").
3. Practical Guidance: Explain legal concepts in clear language. Outline actionable steps and realistic timelines.
4. State-Specific Analysis: Focus on ${state} law. Note when federal law applies or when other jurisdictions differ.
5. Professional Boundaries: You provide legal information, NOT legal advice. Make this distinction clear.

ETHICAL BOUNDARIES:
- Clearly state: "This is legal information, not legal advice"
- Emphasize: "This does not create an attorney-client relationship"
- Recommend: "Consult with a licensed ${state} attorney for specific legal advice"
- Note: "Laws change; verify current statutes and recent case law"

RESPONSE STRUCTURE:
${responseGuidance}

Always prioritize accuracy over speed. If uncertain about a legal claim, acknowledge the uncertainty and recommend verification with a licensed attorney.`;
}

/**
 * Generates a consultation prompt template for the expert
 * 
 * @param profile - The expert profile
 * @param lawType - The type of law being consulted
 * @returns Consultation prompt template string
 */
export function generateConsultationPrompt(profile: ExpertProfile, lawType: LawType): string {
  return `As a ${profile.specialty} specialist with ${profile.yearsExperience} years of experience, I'm here to provide legal information about ${lawType.replace(/-/g, ' ')}.

My areas of expertise include:
${profile.focusAreas.map(area => `• ${area}`).join('\n')}

I'll analyze your situation with a ${profile.tone} approach and attention to detail level ${profile.meticulousness}/10.

Please share the details of your legal question or situation, and I'll provide information to help you understand your options.

Remember: This is legal information to help you make informed decisions, not legal advice. For specific legal advice tailored to your circumstances, consult with a licensed attorney in your jurisdiction.`;
}

/**
 * Main function to get complete expert system configuration
 * 
 * @param lawType - The type of law for consultation
 * @param state - The state/jurisdiction
 * @returns Complete expert system configuration
 */
export function getExpertSystemConfig(lawType: LawType, state: string): ExpertSystemConfig {
  try {
    const profile = generateExpertProfile(lawType);
    const systemPrompt = generateSystemPrompt(profile, lawType, state);
    const consultationPrompt = generateConsultationPrompt(profile, lawType);
    const credentials = formatExpertCredentials(profile);

    console.log(`[ExpertSystem] Generated config for ${lawType} in ${state}`);
    console.log(`[ExpertSystem] Expert: ${profile.specialty}, ${profile.yearsExperience} years, ${profile.tone} tone`);

    return {
      profile,
      systemPrompt,
      consultationPrompt,
      credentials
    };
  } catch (error) {
    console.error(`[ExpertSystem] Error generating config for ${lawType}:`, error);
    
    // Return safe default configuration
    const defaultProfile: ExpertProfile = {
      specialty: 'General Legal Practice',
      yearsExperience: 25,
      tone: 'balanced',
      meticulousness: 6,
      focusAreas: ['Legal research', 'Case analysis', 'Client advocacy']
    };

    return {
      profile: defaultProfile,
      systemPrompt: generateSystemPrompt(defaultProfile, lawType, state),
      consultationPrompt: generateConsultationPrompt(defaultProfile, lawType),
      credentials: formatExpertCredentials(defaultProfile)
    };
  }
}

/**
 * Formats expert credentials for display
 * 
 * @param profile - The expert profile
 * @returns Formatted credentials string
 */
export function formatExpertCredentials(profile: ExpertProfile): string {
  return `${profile.specialty} Specialist | ${profile.yearsExperience}+ Years Experience | ${profile.tone.charAt(0).toUpperCase() + profile.tone.slice(1)} Approach | Detail Level: ${profile.meticulousness}/10`;
}
