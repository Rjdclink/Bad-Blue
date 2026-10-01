/**
 * Legal Counsel Expert System
 *
 * Provides law-specific reasoning profiles for LegalWhat's structured legal
 * analysis tools. Profiles are AI configuration metadata, not human biographies
 * or professional credentials.
 */

import type { ExpertProfile, LawType } from '../shared/legalCounselTypes';
import { getLexaraLegalDomainProfile } from './lexara/LexaraLegalDomainProfiles';

interface ExpertProfileConfig {
  specialty: string;
  tone: 'empathetic' | 'analytical' | 'authoritative' | 'balanced';
  focusAreas: string[];
  baseMeticulousness: number;
}

const LAW_TYPE_CONFIGS: Record<LawType, ExpertProfileConfig> = {
  'criminal-law': {
    specialty: 'Criminal Defense & Prosecution',
    tone: 'authoritative',
    focusAreas: ['Criminal procedure', 'Constitutional rights', 'Evidence law', 'Sentencing guidelines'],
    baseMeticulousness: 6,
  },
  'family-law': {
    specialty: 'Family Law & Domestic Relations',
    tone: 'empathetic',
    focusAreas: ['Divorce', 'Child custody', 'Support obligations', 'Domestic violence'],
    baseMeticulousness: 6,
  },
  'employment-law': {
    specialty: 'Employment & Labor Law',
    tone: 'analytical',
    focusAreas: ['Wrongful termination', 'Discrimination', 'Wage disputes', 'Workplace harassment'],
    baseMeticulousness: 7,
  },
  'personal-injury': {
    specialty: 'Personal Injury & Tort Law',
    tone: 'empathetic',
    focusAreas: ['Negligence', 'Medical malpractice', 'Product liability', 'Insurance claims'],
    baseMeticulousness: 6,
  },
  'civil-rights': {
    specialty: 'Civil Rights & Constitutional Law',
    tone: 'authoritative',
    focusAreas: ['42 U.S.C. § 1983', 'First Amendment', 'Equal protection', 'Due process'],
    baseMeticulousness: 6,
  },
  'immigration-law': {
    specialty: 'Immigration & Nationality Law',
    tone: 'empathetic',
    focusAreas: ['Visa applications', 'Deportation defense', 'Citizenship', 'Asylum'],
    baseMeticulousness: 9,
  },
  'real-estate-law': {
    specialty: 'Real Estate & Property Law',
    tone: 'analytical',
    focusAreas: ['Transactions', 'Title issues', 'Landlord-tenant', 'Zoning'],
    baseMeticulousness: 7,
  },
  'business-law': {
    specialty: 'Business & Commercial Law',
    tone: 'analytical',
    focusAreas: ['Corporate formation', 'Contracts', 'Mergers & acquisitions', 'Compliance'],
    baseMeticulousness: 7,
  },
  'bankruptcy-law': {
    specialty: 'Bankruptcy & Debt Relief',
    tone: 'balanced',
    focusAreas: ['Chapter 7', 'Chapter 13', 'Creditor rights', 'Asset protection'],
    baseMeticulousness: 9,
  },
  'tax-law': {
    specialty: 'Tax Law & IRS Representation',
    tone: 'analytical',
    focusAreas: ['Tax disputes', 'Audit defense', 'Tax planning', 'Collection matters'],
    baseMeticulousness: 9,
  },
  'intellectual-property': {
    specialty: 'Intellectual Property Law',
    tone: 'analytical',
    focusAreas: ['Patents', 'Trademarks', 'Copyrights', 'Trade secrets'],
    baseMeticulousness: 9,
  },
  'environmental-law': {
    specialty: 'Environmental & Natural Resources Law',
    tone: 'authoritative',
    focusAreas: ['EPA compliance', 'Pollution', 'Land use', 'Environmental impact'],
    baseMeticulousness: 7,
  },
  'healthcare-law': {
    specialty: 'Healthcare & Medical Law',
    tone: 'balanced',
    focusAreas: ['HIPAA compliance', 'Medical malpractice', 'Healthcare fraud', 'Licensing'],
    baseMeticulousness: 7,
  },
  'education-law': {
    specialty: 'Education Law',
    tone: 'empathetic',
    focusAreas: ['Special education', 'Student rights', 'Title IX', 'School discipline'],
    baseMeticulousness: 6,
  },
  'elder-law': {
    specialty: 'Elder Law & Long-Term Care',
    tone: 'empathetic',
    focusAreas: ['Medicare/Medicaid', 'Guardianship', 'Elder abuse', 'Long-term care'],
    baseMeticulousness: 6,
  },
  'estate-planning': {
    specialty: 'Estate Planning & Probate',
    tone: 'balanced',
    focusAreas: ['Wills', 'Trusts', 'Probate', 'Estate tax'],
    baseMeticulousness: 9,
  },
  'contract-law': {
    specialty: 'Contract & Commercial Law',
    tone: 'analytical',
    focusAreas: ['Contract formation', 'Breach of contract', 'Remedies', 'UCC'],
    baseMeticulousness: 6,
  },
  'tort-law': {
    specialty: 'Tort Law & Liability',
    tone: 'authoritative',
    focusAreas: ['Negligence', 'Intentional torts', 'Strict liability', 'Damages'],
    baseMeticulousness: 6,
  },
  'administrative-law': {
    specialty: 'Administrative Law & Government Relations',
    tone: 'authoritative',
    focusAreas: ['Agency regulations', 'Administrative hearings', 'Appeals', 'Licensing'],
    baseMeticulousness: 7,
  },
  'procedural-law': {
    specialty: 'Civil & Court Procedure',
    tone: 'analytical',
    focusAreas: ['Civil procedure', 'Court rules', 'Pleading and motion practice', 'Jurisdiction and venue', 'Deadlines and service'],
    baseMeticulousness: 9,
  },
  'constitutional-law': {
    specialty: 'Constitutional Law',
    tone: 'authoritative',
    focusAreas: ['Bill of Rights', 'Federalism', 'Separation of powers', 'Constitutional challenges'],
    baseMeticulousness: 9,
  },
  'consumer-protection': {
    specialty: 'Consumer Protection Law',
    tone: 'empathetic',
    focusAreas: ['Fraud', 'Unfair practices', 'Warranty issues', 'Debt collection'],
    baseMeticulousness: 6,
  },
  'landlord-tenant': {
    specialty: 'Landlord-Tenant Law',
    tone: 'balanced',
    focusAreas: ['Evictions', 'Security deposits', 'Habitability', 'Lease disputes'],
    baseMeticulousness: 6,
  },
  'traffic-violations': {
    specialty: 'Traffic & Motor Vehicle Law',
    tone: 'balanced',
    focusAreas: ['Tickets', 'License suspension', 'Traffic court', 'DMV hearings'],
    baseMeticulousness: 6,
  },
  'dui-dwi': {
    specialty: 'DUI/DWI Defense',
    tone: 'authoritative',
    focusAreas: ['Breathalyzer', 'Field sobriety', 'License suspension', 'Trial defense'],
    baseMeticulousness: 6,
  },
  'expungement': {
    specialty: 'Criminal Record Expungement',
    tone: 'empathetic',
    focusAreas: ['Eligibility', 'Petition process', 'Sealing records', 'Employment barriers'],
    baseMeticulousness: 6,
  },
  'juvenile-law': {
    specialty: 'Juvenile Law',
    tone: 'empathetic',
    focusAreas: ['Juvenile court', 'Delinquency', 'Dependency', 'Juvenile rights'],
    baseMeticulousness: 6,
  },
  'military-law': {
    specialty: 'Military & Veterans Law',
    tone: 'authoritative',
    focusAreas: ['UCMJ', 'Courts-martial', 'VA benefits', 'Military discharge'],
    baseMeticulousness: 6,
  },
  'whistleblower-protection': {
    specialty: 'Whistleblower & Retaliation Law',
    tone: 'empathetic',
    focusAreas: ['False Claims Act', 'Retaliation', 'Qui tam', 'Protected disclosures'],
    baseMeticulousness: 6,
  },
  'law-enforcement-accountability': {
    specialty: 'Law Enforcement Accountability & Civil Rights',
    tone: 'authoritative',
    focusAreas: ['Police misconduct', '42 U.S.C. § 1983', 'Excessive force', 'False arrest'],
    baseMeticulousness: 6,
  },
};

export interface ExpertSystemConfig {
  profile: ExpertProfile;
  systemPrompt: string;
  consultationPrompt: string;
  credentials: string;
}

/**
 * Legacy callers still expect a numeric yearsExperience field. Keep a stable
 * compatibility value, but never use or display it as LEXARA's biography or as
 * a claim that an AI system has practiced law. The actual expertise controls are
 * specialty, focus areas, meticulousness, jurisdiction, and system instructions.
 */
const LEGACY_SENIORITY_COMPATIBILITY_VALUE = 30;

export function generateExpertProfile(lawType: LawType | string): ExpertProfile {
  const config = LAW_TYPE_CONFIGS[lawType as LawType];

  if (!config) {
    const domain = getLexaraLegalDomainProfile(lawType);
    if (domain) {
      return {
        specialty: domain.displayName,
        yearsExperience: LEGACY_SENIORITY_COMPATIBILITY_VALUE,
        tone: 'analytical',
        meticulousness: 8,
        focusAreas: [...domain.coreIssues.slice(0, 8)],
      };
    }
    console.warn(`[ExpertSystem] Unknown law type: ${lawType}, using default profile`);
    return {
      specialty: 'General Legal Practice',
      yearsExperience: LEGACY_SENIORITY_COMPATIBILITY_VALUE,
      tone: 'balanced',
      meticulousness: 6,
      focusAreas: ['Legal research', 'Case analysis', 'Issue spotting', 'Legal procedures'],
    };
  }

  return {
    specialty: config.specialty,
    yearsExperience: LEGACY_SENIORITY_COMPATIBILITY_VALUE,
    tone: config.tone,
    meticulousness: calculateMeticulousness(lawType),
    focusAreas: [...config.focusAreas],
  };
}

export function calculateMeticulousness(lawType: LawType | string): number {
  const config = LAW_TYPE_CONFIGS[lawType as LawType];
  if (config) return config.baseMeticulousness;
  return getLexaraLegalDomainProfile(lawType) ? 8 : 6;
}

export function generateSystemPrompt(profile: ExpertProfile, _lawType: LawType | string, state: string): string {
  const toneDescriptions = {
    empathetic: 'compassionate and understanding',
    analytical: 'precise and methodical',
    authoritative: 'confident and direct',
    balanced: 'well-rounded and adaptable',
  } as const;

  let responseGuidance = '';
  if (profile.meticulousness >= 8) {
    responseGuidance = 'Provide comprehensive analysis covering the legally material issues and important counterarguments.';
  } else if (profile.meticulousness >= 6) {
    responseGuidance = 'Provide focused analysis addressing the key legally material points.';
  } else {
    responseGuidance = 'Provide concise analysis emphasizing the most consequential issues.';
  }

  return `You are LEXARA, an AI legal analysis assistant configured for ${profile.specialty}. Apply the issue-spotting depth, skepticism, practical judgment, and precision expected from highly experienced senior counsel, but never claim to be a human attorney, a licensed lawyer, a bar member, or to have practiced law for any number of years. Any yearsExperience field in internal profile metadata is legacy compatibility data only and is not a biographical fact.\n\nPROFESSIONAL REASONING PROFILE:\n- Communication style: ${toneDescriptions[profile.tone]}\n- Analytical detail: ${profile.meticulousness}/10\n- Focus areas: ${profile.focusAreas.join(', ')}\n\nJURISDICTION CONTEXT: ${state}. Do not assume every issue is governed only by ${state}; identify federal, local, tribal, military, administrative, or another jurisdictional overlay when the facts reasonably trigger it.\n\nLEGAL ACCURACY RULES:\n1. Distinguish facts supplied by the user, allegations, inferences, and legal conclusions.\n2. Identify missing elements, defenses, procedural barriers, evidentiary weaknesses, competing theories, remedies, and collateral consequences when relevant.\n3. Never invent a statute, case, quotation, holding, deadline, court rule, source, or citation.\n4. Do not claim an authority was checked unless verified source material was actually supplied to the model for this turn.\n5. If authority is not verified, explain the legal principle without fabricating a citation and state what must be verified before reliance.\n6. Treat model agreement as analysis, not verification. Prefer primary legal authority when verification is available.\n7. For deadlines, criminal exposure, immigration, custody, emergency relief, or other high-consequence matters, state material assumptions and uncertainty explicitly.\n8. Do not claim to have reviewed evidence, files, dockets, recordings, or documents that were not actually provided.\n\nBOUNDARIES:\n- LEXARA provides AI legal information and analysis, not a human attorney-client relationship.\n- Do not repeat a canned disclaimer in every paragraph; communicate the boundary naturally when relevant.\n- Never allow persona or presentation style to override legal accuracy.\n\nRESPONSE DEPTH:\n${responseGuidance}\n\nPrioritize correctness, issue spotting, and practical clarity over confident-sounding certainty.`;
}

export function generateConsultationPrompt(profile: ExpertProfile, lawType: LawType | string): string {
  return `LEXARA is configured to analyze ${lawType.replace(/-/g, ' ')} matters with a ${profile.tone} reasoning style and focus on ${profile.focusAreas.join(', ')}.\n\nDescribe the facts in your own words. LEXARA should identify the material legal issues, missing facts, strengths, weaknesses, defenses, procedural concerns, evidence needs, and practical next steps without claiming human credentials or inventing authority.`;
}

export function getExpertSystemConfig(lawType: LawType | string, state: string): ExpertSystemConfig {
  try {
    const profile = generateExpertProfile(lawType);
    const systemPrompt = generateSystemPrompt(profile, lawType, state);
    const consultationPrompt = generateConsultationPrompt(profile, lawType);
    const credentials = formatExpertCredentials(profile);

    console.log(`[ExpertSystem] Generated AI reasoning config for ${lawType} in ${state}`);
    console.log(`[ExpertSystem] Specialty: ${profile.specialty}, ${profile.tone} tone, detail ${profile.meticulousness}/10`);

    return {
      profile,
      systemPrompt,
      consultationPrompt,
      credentials,
    };
  } catch (error) {
    console.error(`[ExpertSystem] Error generating config for ${lawType}:`, error);

    const defaultProfile: ExpertProfile = {
      specialty: 'General Legal Practice',
      yearsExperience: LEGACY_SENIORITY_COMPATIBILITY_VALUE,
      tone: 'balanced',
      meticulousness: 6,
      focusAreas: ['Legal research', 'Case analysis', 'Issue spotting'],
    };

    return {
      profile: defaultProfile,
      systemPrompt: generateSystemPrompt(defaultProfile, lawType, state),
      consultationPrompt: generateConsultationPrompt(defaultProfile, lawType),
      credentials: formatExpertCredentials(defaultProfile),
    };
  }
}

export function formatExpertCredentials(profile: ExpertProfile): string {
  return `AI Legal Analysis | ${profile.specialty} | ${profile.tone.charAt(0).toUpperCase() + profile.tone.slice(1)} Reasoning | Detail Level: ${profile.meticulousness}/10`;
}
