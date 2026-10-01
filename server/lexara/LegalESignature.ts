import { createHash } from 'crypto';

export interface LegalESignEligibility {
  eligible: boolean;
  reason: string;
  authority: string;
}

export const LEGALWHAT_ESIGN_CONSENT =
  'I intend to sign this document electronically, I consent to use of this electronic signature for this document, and I understand that the signed PDF and its audit record may be retained and reproduced later.';

const GENERICALLY_SUPPORTED_TYPES = new Set([
  'Demand Letter',
  'Cease and Desist Letter',
  'Settlement Proposal',
  'Settlement Agreement',
  'Contract or Agreement',
  'Release or Waiver',
  'Lease Agreement',
  'Release Agreement',
  'Waiver',
  'Business Governance Document',
  'Client Letter',
  'Immigration Support Letter',
  'FOIA or Public Records Request',
]);

const COURT_DOCUMENT_PATTERN = /\b(?:motion|brief|complaint|answer|counterclaim|interrogator|request for (?:production|admission)|discovery response|affidavit|declaration|notice of appeal|petition|subpoena|jury instruction|proposed order|trial brief|sentencing memorandum|habeas|post[- ]conviction|administrative appeal|pleading)\b/i;
const FAMILY_PATTERN = /\b(?:adoption|divorce|dissolution|custody|parental rights?|child support|family[- ]law|paternity)\b/i;
const ESTATE_PATTERN = /\b(?:will|codicil|testamentary trust|last will|probate|estate document)\b/i;
const PRIMARY_RESIDENCE_NOTICE_PATTERN = /\b(?:foreclosure|eviction|default|acceleration|repossession|right to cure)\b/i;
const UCC_EXCEPTION_PATTERN = /\b(?:security agreement|secured transaction|financing statement|ucc[- ]?1|ucc article 9|perfect(?:ion|ed|ing) of (?:a )?security interest|collateral assignment)\b/i;
const OTHER_ESIGN_EXCEPTION_PATTERN = /\b(?:utility (?:termination|cancellation)|health insurance (?:termination|cancellation)|life insurance (?:termination|cancellation)|product recall|hazardous materials?|pesticides?|toxic materials?)\b/i;

export function assessGenericESignEligibility(input: {
  documentType?: string;
  lawType?: string;
  title?: string;
  content?: string;
}): LegalESignEligibility {
  const documentType = String(input.documentType || '').trim();
  const haystack = [documentType, input.lawType, input.title, String(input.content || '').slice(0, 5_000)]
    .filter(Boolean).join(' ');

  const unsupported = (reason: string): LegalESignEligibility => ({
    eligible: false,
    reason,
    authority: '15 U.S.C. §§ 7001, 7003; applicable state law and court rules still control.',
  });

  if (FAMILY_PATTERN.test(haystack) || documentType === 'Family-Law Pleading') {
    return unsupported('Generic LegalWhat e-signing is disabled for family-law documents because the federal E-SIGN general rule does not govern state family-law execution requirements. Use the jurisdiction-specific signing method instead.');
  }
  if (ESTATE_PATTERN.test(haystack) || documentType === 'Probate or Estate Document') {
    return unsupported('Generic LegalWhat e-signing is disabled for wills, codicils, testamentary trusts, and estate/probate documents unless the controlling jurisdiction is separately verified to permit the requested electronic execution method.');
  }
  if (COURT_DOCUMENT_PATTERN.test(haystack)) {
    return unsupported('Generic LegalWhat e-signing is disabled for court filings and official court documents. The controlling court rules must establish the permitted electronic-signature method.');
  }
  if (PRIMARY_RESIDENCE_NOTICE_PATTERN.test(haystack) && /\b(?:primary residence|home|residential|tenant|landlord)\b/i.test(haystack)) {
    return unsupported('Generic LegalWhat e-signing is disabled for covered primary-residence default, foreclosure, repossession, or eviction notices unless the controlling law is separately verified.');
  }
  if (UCC_EXCEPTION_PATTERN.test(haystack)) {
    return unsupported('Generic LegalWhat e-signing is disabled for UCC-governed secured-transaction documents unless the controlling state electronic-transactions law is separately verified.');
  }
  if (OTHER_ESIGN_EXCEPTION_PATTERN.test(haystack)) {
    return unsupported('This document falls within a category that requires separate execution-law verification before LegalWhat can apply a generic electronic signature.');
  }
  if (documentType === 'Landlord-Tenant Notice' || documentType === 'Legal Notice') {
    return unsupported('Notice documents can carry special service and execution requirements, so LegalWhat requires jurisdiction-specific verification instead of applying its generic e-sign workflow.');
  }

  if (!GENERICALLY_SUPPORTED_TYPES.has(documentType)) {
    return unsupported('LegalWhat has not classified this document type as safe for its generic e-sign workflow. It can still be downloaded and signed using the method required by the applicable jurisdiction.');
  }

  return {
    eligible: true,
    reason: 'This document type can use LegalWhat’s generic electronic-signature workflow, subject to any more specific law or agreement that requires a different execution method.',
    authority: '15 U.S.C. § 7001; applicable state law and any document-specific requirements still control.',
  };
}

export function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseSignaturePngDataUrl(value: unknown): Buffer | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!match) throw new Error('Signature drawing must be a PNG image');
  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.length || bytes.length > 1024 * 1024) throw new Error('Signature drawing is too large');
  if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Signature drawing is not a valid PNG');
  }
  return bytes;
}
