/**
 * Canonical LEXARA legal-document registry.
 * Current-turn document language is authoritative; history may only resolve
 * an otherwise-unspecified document reference.
 */
export const LEGAL_DOCUMENT_TYPES = [
  'Motion', 'Supporting Brief', 'Memorandum of Law', 'Complaint', 'Answer', 'Counterclaim',
  'Interrogatories', 'Request for Production', 'Request for Admission', 'Discovery Response',
  'Affidavit', 'Declaration', 'Demand Letter', 'Cease and Desist Letter', 'Settlement Proposal',
  'Settlement Agreement', 'Motion to Suppress', 'Motion to Dismiss', 'Motion to Compel',
  'Motion for Continuance', 'Bond or Bail Motion', 'Sentencing Memorandum',
  'Post-Conviction Motion', 'Notice of Appeal', 'Appellate Brief', 'Habeas Petition',
  'FOIA or Public Records Request', 'Contract or Agreement', 'Release or Waiver',
  'Legal Research Memorandum', 'Case Chronology', 'Witness Summary', 'Deposition Outline',
  'Witness List', 'Exhibit List', 'Proposed Jury Instructions', 'Motion in Limine',
  'Trial Brief', 'Proposed Order', 'Client Letter', 'Administrative Appeal',
  'Landlord-Tenant Notice', 'Family-Law Pleading', 'Probate or Estate Document',
  'Business Governance Document', 'Immigration Support Letter', 'Petition', 'Lease Agreement',
  'Release Agreement', 'Waiver', 'Legal Notice', 'Subpoena', 'Custom Document',
] as const;

export type LegalDocumentType = typeof LEGAL_DOCUMENT_TYPES[number];

const normalize = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const TYPE_ALIASES: ReadonlyArray<readonly [LegalDocumentType, readonly string[]]> = [
  ['Motion to Suppress', ['motion to suppress', 'suppress evidence motion']],
  ['Motion to Dismiss', ['motion to dismiss', 'dismissal motion']],
  ['Motion to Compel', ['motion to compel', 'compel discovery motion']],
  ['Motion for Continuance', ['motion for continuance', 'continuance motion']],
  ['Bond or Bail Motion', ['bond motion', 'bail motion', 'motion for bond', 'motion for bail']],
  ['Post-Conviction Motion', ['post conviction motion', 'postconviction motion']],
  ['Motion in Limine', ['motion in limine']],
  ['Sentencing Memorandum', ['sentencing memorandum', 'sentencing memo']],
  ['Memorandum of Law', ['memorandum of law', 'legal memorandum', 'legal memo']],
  ['Legal Research Memorandum', ['legal research memorandum', 'research memorandum']],
  ['Supporting Brief', ['supporting brief']],
  ['Appellate Brief', ['appellate brief', 'appeal brief']],
  ['Trial Brief', ['trial brief']],
  ['Habeas Petition', ['habeas petition', 'habeas corpus petition']],
  ['Notice of Appeal', ['notice of appeal', 'appeal notice']],
  ['FOIA or Public Records Request', ['foia request', 'public records request', 'open records request']],
  ['Lease Agreement', ['lease', 'lease agreement']],
  ['Release Agreement', ['release agreement']],
  ['Waiver', ['waiver']],
  ['Legal Notice', ['legal notice', 'notice']],
  ['Subpoena', ['subpoena']],
  ['Petition', ['petition']],
  ['Contract or Agreement', ['contract', 'agreement']],
  ['Release or Waiver', ['release or waiver']],
  ['Cease and Desist Letter', ['cease and desist', 'cease and desist letter']],
  ['Demand Letter', ['demand letter']],
  ['Settlement Proposal', ['settlement proposal']],
  ['Settlement Agreement', ['settlement agreement']],
  ['Landlord-Tenant Notice', ['landlord tenant notice', 'tenant notice', 'landlord notice']],
  ['Family-Law Pleading', ['family law pleading']],
  ['Probate or Estate Document', ['probate document', 'estate document']],
  ['Business Governance Document', ['business governance document', 'corporate governance document']],
  ['Immigration Support Letter', ['immigration support letter']],
  ['Request for Production', ['request for production', 'production request']],
  ['Request for Admission', ['request for admission', 'admission request']],
  ['Discovery Response', ['discovery response']],
  ['Interrogatories', ['interrogatories', 'interrogatory']],
  ['Affidavit', ['affidavit']],
  ['Declaration', ['declaration']],
  ['Complaint', ['complaint']],
  ['Answer', ['answer pleading', 'answer to complaint']],
  ['Counterclaim', ['counterclaim']],
  ['Proposed Jury Instructions', ['proposed jury instructions', 'jury instructions']],
  ['Proposed Order', ['proposed order']],
  ['Deposition Outline', ['deposition outline']],
  ['Witness Summary', ['witness summary']],
  ['Witness List', ['witness list']],
  ['Exhibit List', ['exhibit list']],
  ['Case Chronology', ['case chronology']],
  ['Client Letter', ['client letter']],
  ['Administrative Appeal', ['administrative appeal']],
  ['Motion', ['motion']],
  ['Custom Document', ['custom document']],
];

const canonicalByLength = [...LEGAL_DOCUMENT_TYPES]
  .filter(type => type !== 'Custom Document')
  .sort((a, b) => normalize(b).length - normalize(a).length);

export function resolveLegalDocumentType(text: string): LegalDocumentType | null {
  const normalized = normalize(text);
  if (!normalized) return null;

  for (const type of canonicalByLength) {
    const canonical = normalize(type);
    if (type === 'Complaint' && /\banswer\s+to\s+(?:the\s+|a\s+)?complaint\b/.test(normalized)) continue;
    // "Answer briefly" describes conversation style, not an answer pleading.
    // Keep bare pleading requests and explicit drafting language recognizable.
    if (type === 'Answer' && !/^(?:an? )?answer$|\b(?:draft|prepare|create|generate|write|file|filing|submit|serve|need|want)\s+(?:(?:me|my|an?|the)\s+)*answer\b|\banswer\s+(?:pleading|to\s+(?:the\s+|a\s+)?(?:complaint|lawsuit|summons))\b/.test(normalized)) continue;
    if (canonical && new RegExp(`(?:^| )${canonical}(?: |$)`).test(normalized)) return type;
  }
  for (const [type, aliases] of TYPE_ALIASES) {
    if (aliases.some(alias => normalized.includes(normalize(alias)))) return type;
  }
  return null;
}


/** Route high-confidence legal objectives to appropriate documents, not filing advice. */
export function inferLegalDocumentNeed(text: string): LegalDocumentType | null {
  const value = normalize(String(text || ''));
  if (!value || /\b(?:do not|don t|dont|never|no longer|not trying to)\s+(?:want|need|plan|intend|file|prepare|draft|create)\b/.test(value)) return null;
  if (/^(?:what is|what are|explain|define|tell me about|what does|why do|how does)\b/.test(value)) return null;
  if (!/\b(?:i need|i want|i have to|i must|i was|ive been|i got|i received|help me|how do i|what should i|trying to|need to|want to|we need|we want)\b/.test(value)) return null;

  if (/\b(?:i was|ive been|i got|i received)\s+(?:just\s+)?served\s+(?:with\s+)?(?:a\s+)?(?:complaint|lawsuit|summons)\b|\b(?:respond|reply|defend)\s+(?:to\s+)?(?:the\s+|a\s+)?(?:complaint|lawsuit|summons)\b/.test(value)) return 'Answer';
  if (/\b(?:appeal|challenge)\s+(?:the\s+|a\s+)?(?:court\s+)?(?:judgment|final order|court ruling)\b|\b(?:court\s+)?(?:judgment|final order)\b.{0,65}\bappeal\b/.test(value)) return 'Notice of Appeal';
  if (/\b(?:landlord|property manager)\b.{0,110}\b(?:kept|withheld|wont return|hasnt returned|refuses to return)\b.{0,80}\b(?:security deposit|deposit)\b|\b(?:get|recover)\s+(?:my\s+)?(?:security\s+)?deposit\s+back\b/.test(value)) return 'Demand Letter';
  if (/\b(?:discovery|interrogatories|documents requested|request for production)\b.{0,100}\b(?:refused|withheld|ignored|not provided|wont provide|failed to provide)\b|\b(?:compel|force)\b.{0,70}\b(?:discovery|documents|interrogatories)\b/.test(value)) return 'Motion to Compel';
  return null;
}

export function isBlankLegalDocumentRequest(text: string): boolean {
  return /\b(blank|template|form|empty|fillable)\b/i.test(text);
}

export function validateLegalDocumentDraft(
  requestedType: LegalDocumentType,
  content: string,
  templateMode = false,
): { valid: boolean; reason?: string } {
  const trimmed = String(content || '').trim();
  const minimumLength = templateMode ? 220 : 400;
  if (trimmed.length < minimumLength) return { valid: false, reason: 'draft too short' };

  if (/^(?:it looks like|i (?:do not|don't|can|cannot|can't|need)|could you|please tell me|you(?:'ll| will) need|before (?:i|we) can)/i.test(trimmed)) {
    return { valid: false, reason: 'conversational commentary instead of a document' };
  }
  if (/\b(?:don't have a specific question|details didn't come through|could you tell me what's going on)\b/i.test(trimmed)) {
    return { valid: false, reason: 'missing-input conversational fallback' };
  }

  if (requestedType !== 'Custom Document') {
    if (requestedType === 'FOIA or Public Records Request'
      && !/\b(?:foia|freedom of information|public records?|open records?)\b/i.test(trimmed)) {
      return { valid: false, reason: 'draft is not a public-records request' };
    }
    const normalizedHead = normalize(trimmed.slice(0, 2200));
    const canonicalTokens = normalize(requestedType)
      .split(' ')
      .filter(token => token.length >= 4 && !['legal', 'document', 'supporting', 'proposed', 'business', 'family'].includes(token));
    if (canonicalTokens.length && !canonicalTokens.some(token => normalizedHead.includes(token))) {
      return { valid: false, reason: 'draft does not resemble the requested document type' };
    }
  }

  if (templateMode && !/\[[A-Z0-9 _/.-]{3,}\]/.test(trimmed)) {
    return { valid: false, reason: 'blank template is missing placeholders' };
  }

  return { valid: true };
}
