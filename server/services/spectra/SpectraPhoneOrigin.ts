import { extractCityStateHint } from '../geoconsole/city-state-geocoder';
import { retrieveSpectraPublicEvidence, type SpectraRetrievedEvidence } from './SpectraPublicRetrieval';

export interface SpectraPhoneOrigin {
  city: string;
  state: string;
  carrier: string | null;
  sourceUrl: string;
  block: string;
  /** Assignment geography only. A ported mobile number says nothing about current residence. */
  currentPositionVerified: false;
}

/** Parse a public NPA-NXX table, matching the thousand-number block exactly. */
export function parsePhoneOrigin(text: string, prefix: string, block: string, sourceUrl: string): SpectraPhoneOrigin | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = new RegExp(`(?:^|\\s)${escaped}\\s+${block}\\s+([A-Za-z][A-Za-z .'-]{1,50}?)\\s+([A-Z]{2})\\s+[^\\n]{0,120}`);
  const match = row.exec(text.replace(/\u00a0/g, ' '));
  if (!match) return null;
  const region = extractCityStateHint(`${match[1].trim()}, ${match[2].toUpperCase()}`);
  if (!region) return null;
  const carrier = /(?:CELLCO PARTNERSHIP|VERIZON WIRELESS|METROPCS|T-MOBILE|AT&T MOBILITY|UNITED STATES CELLULAR)/i.exec(match[0])?.[0] || null;
  return { city: region.city, state: region.state, carrier, block, sourceUrl, currentPositionVerified: false };
}

export async function collectSpectraPhoneOrigin(
  phone: string | undefined,
  retrieve: typeof retrieveSpectraPublicEvidence = retrieveSpectraPublicEvidence,
): Promise<{ origin: SpectraPhoneOrigin | null; records: SpectraRetrievedEvidence[] }> {
  const raw = phone?.replace(/\D/g, '') || '';
  const digits = raw.length === 11 && raw.startsWith('1') ? raw.slice(1) : raw;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return { origin: null, records: [] };
  const prefix = `${digits.slice(0, 3)}-${digits.slice(3, 6)}`;
  const endpoint = `https://localcallingguide.com/lca_prefix.php?npa=${digits.slice(0, 3)}&nxx=${digits.slice(3, 6)}`;
  const records = await retrieve([endpoint], AbortSignal.timeout(3_000)).catch(() => []);
  const evidence = records.find(record => record.requestedUrl === endpoint && record.textExcerpt);
  const origin = evidence ? parsePhoneOrigin(evidence.textExcerpt || '', prefix, digits[6], evidence.url) : null;
  return { origin, records };
}
