import {
  PANTHEON_REPORT_CATEGORY_LABELS,
  type PantheonReportCategoryLabel,
} from '../services/pantheon/PantheonCrawlerCapabilityMatrix';
import type {
  PantheonBackgroundCategory,
} from '../services/pantheon/PantheonSovereignSourceRegistry';

export interface PantheonSemanticCategoryMatch {
  label: PantheonReportCategoryLabel;
  score: number;
  matchedCues: string[];
}

// Lexical concepts describe the user's requested fact, not a required exact
// command. Keep common natural-language paraphrases together so both sequence
// routing and the evidence search receive the same bounded multi-label intent.
const CATEGORY_CUES: Record<PantheonReportCategoryLabel, readonly string[]> = {
  'Identity & Identity Verification': [
    'identity', 'verify identity', 'confirm identity', 'who is', 'real name', 'legal name',
    'alias', 'aliases', 'aka', 'also known as', 'previous name', 'known under', 'birth date', 'date of birth', 'birthday',
    'how old', 'age', 'identity theft', 'name variation',
  ],
  'Phone Numbers': [
    'phone', 'phone number', 'telephone', 'mobile number', 'cell number', 'cellphone',
    'contact number', 'call number', 'number to reach', 'telephone number', 'reach by phone',
    'way to get in touch',
  ],
  'Email Addresses': [
    'email', 'e-mail', 'email address', 'mailing address online', 'electronic mail',
    'contact email', 'inbox address', 'write to', 'contact electronically',
  ],
  'Current Address': [
    'current address', 'home address', 'where live', 'lives at', 'lives in', 'resides at',
    'resides in', 'where based', 'based in', 'where located now', 'present residence',
    'current residence', 'home location', 'where currently lives',
    'living address', 'resides', 'calls home',
  ],
  'Address History': [
    'address history', 'previous address', 'prior address', 'former address',
    'past address', 'old address', 'where lived before', 'previously lived',
    'moved from', 'past residences', 'residence history', 'former residence',
    'lived before', 'live before', 'previously resided', 'previously at',
  ],
  'Relatives & Family': [
    'relative', 'relatives', 'family', 'family member', 'family members', 'parent',
    'parents', 'mother', 'father', 'sibling', 'siblings', 'brother', 'sister',
    'son', 'daughter', 'child', 'children', 'kin', 'next of kin', 'family tree',
  ],
  'Associates & Household Connections': [
    'associate', 'associates', 'business associate', 'household', 'household member',
    'roommate', 'lives with', 'connected to', 'linked to', 'social connection',
    'known associates', 'cohabitant', 'shared residence', 'social circle', 'co worker',
  ],
  'Social-Media Profiles': [
    'social media', 'social-media', 'facebook', 'instagram', 'linkedin', 'tiktok',
    'twitter', 'x.com', 'social profile', 'social account', 'social networking',
    'public profile', 'social network profile',
  ],
  'Usernames & Online Accounts': [
    'username', 'user name', 'usernames', 'screen name', 'screenname', 'online handle',
    'handle', 'online account', 'online accounts', 'account name', 'gaming account',
    'forum account',
  ],
  'Photos & Public Images': [
    'photo', 'photos', 'photograph', 'photographs', 'picture', 'pictures', 'headshot',
    'image', 'images', 'public image', 'public images', 'portrait', 'public pictures',
  ],
  'Employment History': [
    'employment', 'employed', 'employer', 'employers', 'job history', 'work history', 'career history',
    'occupation', 'profession', 'professional background', 'line of work', 'where works', 'works for',
    'works at', 'worked at', 'job title', 'staff directory', 'source of income',
  ],
  'Education': [
    'education', 'educational background', 'school', 'schools', 'college', 'university',
    'alma mater', 'degree', 'degrees', 'diploma', 'graduation', 'attended', 'studied at',
  ],
  'Professional Licenses & Credentials': [
    'professional license', 'license', 'licensed', 'licensure', 'credential',
    'credentials', 'certification', 'certified', 'board certification', 'professional qualification',
    'disciplinary action', 'license status', 'bar admission',
  ],
  'Business Ownership & Affiliations': [
    'business ownership', 'business owner', 'owns a company', 'company ownership',
    'corporate affiliation', 'business affiliation', 'business interests', 'company officer',
    'corporate officer', 'registered agent', 'company director', 'business partner',
    'affiliated with a company',
    'business history', 'corporation',
  ],
  'Property & Real Estate': [
    'real estate', 'property', 'properties', 'property ownership', 'owns property',
    'land ownership', 'owns land', 'deed', 'parcel', 'assessor', 'home ownership', 'mortgage',
    'foreclosure', 'real property',
  ],
  'Vehicles & Transportation Records': [
    'vehicle', 'vehicles', 'car', 'cars', 'automobile', 'truck', 'motorcycle',
    'vehicle registration', 'vehicle title', 'license plate', 'vin', 'transportation record',
  ],
  'Court Records': [
    'court record', 'court records', 'court case', 'court cases', 'docket', 'dockets',
    'case filing', 'court filing', 'court docket', 'litigation history', 'court appearance',
  ],
  'Criminal Records': [
    'criminal record', 'criminal records', 'criminal history', 'criminal background',
    'conviction', 'convictions', 'criminal charge', 'criminal charges', 'sentence',
    'sentencing', 'rap sheet', 'felony', 'misdemeanor',
  ],
  'Arrest & Police Records': [
    'arrest', 'arrests', 'arrest record', 'arrest records', 'arrested', 'police record',
    'police records', 'booking record', 'booked', 'book', 'sheriff record', 'law enforcement contact',
  ],
  'Incarceration & Corrections': [
    'incarcerated', 'incarceration', 'inmate', 'inmates', 'jail record', 'prison record',
    'correctional facility', 'custody status', 'currently in prison', 'detention', 'detained',
    'release from prison', 'corrections', 'behind bars', 'served time',
  ],
  'Probation & Parole Information': [
    'probation', 'parole', 'parole status', 'probation status', 'supervision',
    'supervised release', 'community supervision', 'released on parole',
  ],
  'Warrants & Wanted-Person Records': [
    'warrant', 'warrants', 'outstanding warrant', 'bench warrant', 'wanted person',
    'wanted poster', 'fugitive status', 'wanted by police',
  ],
  'Sex-Offender Registries': [
    'sex offender', 'sexual offender', 'offender registry', 'sex offender registry',
    'registry status', 'registered offender',
  ],
  'Civil Litigation & Judgments': [
    'civil litigation', 'civil lawsuit', 'lawsuit', 'sued', 'being sued', 'civil case',
    'civil cases', 'judgment', 'judgments', 'court judgment', 'plaintiff', 'defendant',
    'small claims',
  ],
  'Bankruptcies, Liens & Financial Public Records': [
    'bankruptcy', 'bankruptcies', 'bankrupt', 'lien', 'liens', 'tax lien',
    'financial public record', 'financial filing', 'foreclosure filing', 'judgment lien',
    'insolvency', 'creditor filing',
  ],
  'Marriage, Divorce & Vital-Record Information': [
    'marriage', 'married', 'marital status', 'spouse', 'husband', 'wife', 'divorce',
    'divorced', 'birth record', 'death record', 'vital record', 'marriage record',
    'marriage license', 'death certificate', 'birth certificate',
  ],
  'News & Media Mentions': [
    'news', 'media mention', 'newspaper', 'press coverage', 'news article', 'headline',
    'press release', 'media coverage', 'publicity', 'adverse media',
  ],
  'Internet & Web Footprint': [
    'internet footprint', 'web footprint', 'online presence', 'digital footprint',
    'website', 'websites', 'domain', 'web mention', 'internet presence', 'online footprint',
  ],
  'Government, Political & Public-Service Records': [
    'government service', 'public service', 'public office', 'government position',
    'elected official', 'political office', 'political activity', 'campaign contribution',
    'campaign donation', 'government employee', 'lobbying', 'public servant',
    'public-sector employment',
  ],
  'Relationship & Timeline Intelligence': [
    'timeline', 'chronology', 'sequence of events', 'event sequence', 'relationship timeline',
    'connections over time', 'relationship history', 'who was connected', 'event history',
    'corroborate timeline', 'contradictory timeline',
  ],
};

export const PANTHEON_REPORT_CATEGORY_TO_BACKGROUND_CATEGORIES: Record<
  PantheonReportCategoryLabel,
  readonly PantheonBackgroundCategory[]
> = {
  'Identity & Identity Verification': ['identity', 'identity-resolution', 'historical', 'chronology'],
  'Phone Numbers': ['contacts', 'identity-resolution'],
  'Email Addresses': ['contacts', 'breach-notices', 'identity-resolution'],
  'Current Address': ['residence', 'geography'],
  'Address History': ['residence', 'geography', 'historical', 'chronology'],
  'Relatives & Family': ['relatives', 'family-probate', 'relationship-graph'],
  'Associates & Household Connections': ['associates', 'relationship-graph'],
  'Social-Media Profiles': ['social', 'professional-web', 'internet'],
  'Usernames & Online Accounts': ['usernames', 'domain-web', 'internet'],
  'Photos & Public Images': ['internet', 'social', 'news'],
  'Employment History': ['employment', 'professional-web', 'government-employment'],
  Education: ['education', 'credentials'],
  'Professional Licenses & Credentials': ['credentials', 'professional-discipline'],
  'Business Ownership & Affiliations': ['business', 'corporate', 'organizations'],
  'Property & Real Estate': ['property', 'residence', 'tax-public', 'financial-public'],
  'Vehicles & Transportation Records': ['transportation'],
  'Court Records': ['courts'],
  'Criminal Records': ['criminal', 'courts'],
  'Arrest & Police Records': ['arrests', 'criminal', 'courts'],
  'Incarceration & Corrections': ['corrections', 'criminal', 'courts'],
  'Probation & Parole Information': ['probation-parole', 'criminal'],
  'Warrants & Wanted-Person Records': ['warrants', 'criminal', 'courts'],
  'Sex-Offender Registries': ['sex-offender'],
  'Civil Litigation & Judgments': ['civil-litigation', 'courts', 'financial-public'],
  'Bankruptcies, Liens & Financial Public Records': ['bankruptcy', 'financial-public', 'property'],
  'Marriage, Divorce & Vital-Record Information': ['vital-records', 'family-probate', 'relatives'],
  'News & Media Mentions': ['news', 'adverse-media'],
  'Internet & Web Footprint': ['internet', 'domain-web', 'professional-web'],
  'Government, Political & Public-Service Records': [
    'government-employment', 'campaign-finance', 'lobbying', 'government-contracting',
  ],
  'Relationship & Timeline Intelligence': [
    'relationship-graph', 'chronology', 'corroboration', 'contradictions', 'provenance',
  ],
};

const NORMALIZED_CUES: Array<{
  label: PantheonReportCategoryLabel;
  cue: string;
  score: number;
}> = PANTHEON_REPORT_CATEGORY_LABELS.flatMap(label =>
  CATEGORY_CUES[label].map(cue => ({
    label,
    cue,
    score: Math.max(2, cue.trim().split(/\s+/).length)
      + (/^.+(?:record|history|status|address|profile|record)$/.test(cue) ? 0.5 : 0),
  })),
);

function normalizedText(text: string): string {
  return ` ${String(text || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')} `;
}

function matchesCue(text: string, cue: string): boolean {
  const normalizedCue = normalizedText(cue).trim();
  return normalizedCue.length > 0 && text.includes(` ${normalizedCue} `);
}

export function classifyPantheonSemanticCategories(
  text: string,
  previousUserTurns: readonly string[] = [],
): PantheonSemanticCategoryMatch[] {
  const current = normalizedText(text);
  const currentScores = new Map<PantheonReportCategoryLabel, { score: number; cues: string[] }>();
  for (const { label, cue, score } of NORMALIZED_CUES) {
    if (!matchesCue(current, cue)) continue;
    const existing = currentScores.get(label) || { score: 0, cues: [] };
    existing.score = Math.max(existing.score, score);
    existing.cues.push(cue);
    currentScores.set(label, existing);
  }

  // A generic pronoun or ellipsis inherits the prior user's subject-level
  // category only when the current turn has no category cue of its own.
  if (currentScores.size === 0 && isContextualReference(text)) {
    const prior = [...previousUserTurns].reverse().find(turn =>
      classifyPantheonSemanticCategories(turn).length > 0,
    );
    if (prior) {
      return classifyPantheonSemanticCategories(prior).map(match => ({
        ...match,
        matchedCues: [...match.matchedCues, 'inherited-from-prior-turn'],
      }));
    }
  }

  const ranked = [...currentScores.entries()]
    .map(([label, result]) => ({ label, ...result }))
    .sort((left, right) => right.score - left.score
      || PANTHEON_REPORT_CATEGORY_LABELS.indexOf(left.label) - PANTHEON_REPORT_CATEGORY_LABELS.indexOf(right.label));
  if (!ranked.length) return [];

  // Keep independent, materially expressed facts (e.g., an arrest and later
  // conviction) multi-label; suppress only incidental generic overlaps.
  const threshold = Math.max(2, ranked[0].score * 0.45);
  return ranked
    .filter((match, index) => index === 0 || match.score >= threshold)
    .slice(0, PANTHEON_REPORT_CATEGORY_LABELS.length)
    .map(({ label, score, cues }) => ({ label, score, matchedCues: [...new Set(cues)] }));
}

export function isContextualReference(text: string): boolean {
  const normalized = normalizedText(text);
  return /\b(?:he|she|they|them|their|his|her|its|it|that|this|those|these|same person|same company|same place|and what about|what about|how about|also check|and the|how is|where is it|what happened next|keep looking|try again|look further)\b/.test(normalized);
}

export function isFullLexaraBackgroundReportIntent(text: string): boolean {
  const normalized = normalizedText(text);
  return /\b(?:full|complete|comprehensive|entire|all 30|every category)\b.{0,35}\b(?:background|report|check|investigation)\b|\b(?:run|do|generate|prepare|conduct)\b.{0,20}\b(?:background report|background check|full report)\b/.test(normalized);
}
