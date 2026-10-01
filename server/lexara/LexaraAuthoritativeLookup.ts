import type { LexaraBackgroundSubject } from './LexaraBackgroundSubject';
import type { LexaraRequestedFact } from './LexaraResearchIntentRouter';
import type { LexaraSourceCategory } from './LexaraPublicSourceRegistry';

export interface LexaraAuthoritativeEvidence {
  url: string;
  content: string;
  retrievedAt: string;
  provider: string;
}

const DIRECT_LOOKUP_TIMEOUT_MS = 2_000;

function splitPersonName(name: string): { first: string; middle: string; last: string } | null {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return {
    first: parts[0],
    middle: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    last: parts[parts.length - 1],
  };
}

function stateAbbreviation(value?: string): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  const direct = /\b([A-Z]{2})\b/.exec(raw.toUpperCase())?.[1];
  if (direct) return direct;
  const states: Record<string, string> = {
    alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA', colorado:'CO',
    connecticut:'CT', delaware:'DE', florida:'FL', georgia:'GA', hawaii:'HI', idaho:'ID',
    illinois:'IL', indiana:'IN', iowa:'IA', kansas:'KS', kentucky:'KY', louisiana:'LA',
    maine:'ME', maryland:'MD', massachusetts:'MA', michigan:'MI', minnesota:'MN',
    mississippi:'MS', missouri:'MO', montana:'MT', nebraska:'NE', nevada:'NV',
    'new hampshire':'NH', 'new jersey':'NJ', 'new mexico':'NM', 'new york':'NY',
    'north carolina':'NC', 'north dakota':'ND', ohio:'OH', oklahoma:'OK', oregon:'OR',
    pennsylvania:'PA', 'rhode island':'RI', 'south carolina':'SC', 'south dakota':'SD',
    tennessee:'TN', texas:'TX', utah:'UT', vermont:'VT', virginia:'VA', washington:'WA',
    'west virginia':'WV', wisconsin:'WI', wyoming:'WY', 'district of columbia':'DC',
  };
  const normalized = raw.toLowerCase();
  return Object.entries(states).find(([name]) => normalized.includes(name))?.[1];
}

async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  parentSignal?: AbortSignal,
): Promise<Response | null> {
  const controller = new AbortController();
  const relay = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) controller.abort(parentSignal.reason);
  else parentSignal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('lexara_authoritative_lookup_timeout')), DIRECT_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', relay);
  }
}

async function lookupBop(
  subject: LexaraBackgroundSubject,
  signal?: AbortSignal,
): Promise<LexaraAuthoritativeEvidence[]> {
  const name = splitPersonName(subject.name);
  if (!name) return [];
  const body = new URLSearchParams({
    todo: 'query',
    output: 'json',
    nameFirst: name.first,
    nameMiddle: name.middle,
    nameLast: name.last,
    race: '',
    age: '',
    sex: '',
  });
  const response = await fetchWithDeadline('https://www.bop.gov/PublicInfo/execute/inmateloc', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      accept: 'application/json, text/javascript, */*; q=0.01',
      'x-requested-with': 'XMLHttpRequest',
      origin: 'https://www.bop.gov',
      referer: 'https://www.bop.gov/inmateloc/',
      'user-agent': 'LegalWhat-Lexara/1.0',
    },
    body: body.toString(),
  }, signal);
  if (!response) return [];
  try {
    const payload: any = await response.json();
    if (payload?.Captcha || !Array.isArray(payload?.InmateLocator)) return [];
    const retrievedAt = new Date().toISOString();
    return payload.InmateLocator.slice(0, 8).flatMap((item: any) => {
      const fullName = [item?.nameFirst, item?.nameMiddle, item?.nameLast].filter(Boolean).join(' ').trim();
      if (!fullName) return [];
      const content = [
        `Federal Bureau of Prisons inmate record for ${fullName}.`,
        item?.inmateNum ? `Register number: ${item.inmateNum}.` : '',
        item?.faclName || item?.faclType ? `Facility: ${[item?.faclName, item?.faclType].filter(Boolean).join(' ')}.` : '',
        item?.age ? `Age: ${item.age}.` : '',
        item?.actRelDate || item?.projRelDate ? `Release date/status date: ${item?.actRelDate || item?.projRelDate}.` : '',
        item?.releaseCode ? `Release code: ${item.releaseCode}.` : '',
      ].filter(Boolean).join(' ');
      return [{
        url: 'https://www.bop.gov/inmateloc/',
        content,
        retrievedAt,
        provider: 'bop-structured',
      }];
    });
  } catch {
    return [];
  }
}

async function lookupNpi(
  subject: LexaraBackgroundSubject,
  jurisdiction?: string,
  signal?: AbortSignal,
): Promise<LexaraAuthoritativeEvidence[]> {
  const name = splitPersonName(subject.name);
  if (!name) return [];
  const url = new URL('https://npiregistry.cms.hhs.gov/api/');
  url.searchParams.set('version', '2.1');
  url.searchParams.set('enumeration_type', 'NPI-1');
  url.searchParams.set('first_name', name.first);
  url.searchParams.set('last_name', name.last);
  url.searchParams.set('limit', '20');
  const state = stateAbbreviation(jurisdiction || subject.location);
  if (state) url.searchParams.set('state', state);

  const response = await fetchWithDeadline(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json', 'user-agent': 'LegalWhat-Lexara/1.0' },
  }, signal);
  if (!response) return [];
  try {
    const payload: any = await response.json();
    if (!Array.isArray(payload?.results)) return [];
    const retrievedAt = new Date().toISOString();
    return payload.results.slice(0, 8).flatMap((item: any) => {
      const basic = item?.basic || {};
      const fullName = [basic?.first_name, basic?.middle_name, basic?.last_name].filter(Boolean).join(' ').trim();
      if (!fullName) return [];
      const taxonomies = Array.isArray(item?.taxonomies)
        ? item.taxonomies.slice(0, 5).map((taxonomy: any) =>
            [taxonomy?.desc, taxonomy?.state ? `state ${taxonomy.state}` : '', taxonomy?.license ? `license number ${taxonomy.license}` : '']
              .filter(Boolean).join(', '))
        : [];
      const addresses = Array.isArray(item?.addresses)
        ? item.addresses.slice(0, 3).map((address: any) =>
            [address?.address_1, address?.city, address?.state, address?.postal_code].filter(Boolean).join(', '))
        : [];
      const content = [
        `CMS NPPES healthcare provider record for ${fullName}.`,
        item?.number ? `NPI: ${item.number}.` : '',
        basic?.credential ? `Credential listed by NPPES: ${basic.credential}.` : '',
        taxonomies.length ? `Taxonomy/specialty: ${taxonomies.join('; ')}.` : '',
        addresses.length ? `Practice/address records: ${addresses.join('; ')}.` : '',
        'NPI issuance does not itself verify professional licensure.',
      ].filter(Boolean).join(' ');
      return [{
        url: url.toString(),
        content,
        retrievedAt,
        provider: 'cms-npi-api',
      }];
    });
  } catch {
    return [];
  }
}

async function lookupCourtListener(
  subject: LexaraBackgroundSubject,
  signal?: AbortSignal,
): Promise<LexaraAuthoritativeEvidence[]> {
  const url = new URL('https://www.courtlistener.com/');
  url.searchParams.set('q', `"${subject.name}"`);
  url.searchParams.set('type', 'r');
  const response = await fetchWithDeadline(url.toString(), {
    method: 'GET',
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'LegalWhat-Lexara/1.0' },
  }, signal);
  if (!response) return [];
  try {
    const html = (await response.text()).slice(0, 500_000);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120_000);
    if (!text) return [];
    return [{
      url: url.toString(),
      content: text,
      retrievedAt: new Date().toISOString(),
      provider: 'courtlistener-direct',
    }];
  } catch {
    return [];
  }
}

function shouldUseNpi(fact: LexaraRequestedFact, categories: readonly LexaraSourceCategory[]): boolean {
  // NPPES is authoritative for NPI/provider identity data, not professional licensure.
  return fact === 'healthcare-professional'
    || categories.includes('healthcare-professional') && fact !== 'professional-license';
}

export async function lookupLexaraAuthoritativeSources(input: {
  subject: LexaraBackgroundSubject;
  requestedFact: LexaraRequestedFact;
  categories: readonly LexaraSourceCategory[];
  jurisdiction?: string;
  signal?: AbortSignal;
}): Promise<LexaraAuthoritativeEvidence[]> {
  const jobs: Array<Promise<LexaraAuthoritativeEvidence[]>> = [];
  if (input.requestedFact === 'incarceration') {
    jobs.push(lookupBop(input.subject, input.signal));
  }
  if (shouldUseNpi(input.requestedFact, input.categories)) {
    jobs.push(lookupNpi(input.subject, input.jurisdiction, input.signal));
  }
  if (['court-record', 'criminal-arrest', 'bankruptcy-financial'].includes(input.requestedFact)) {
    jobs.push(lookupCourtListener(input.subject, input.signal));
  }
  if (!jobs.length) return [];

  const settled = await Promise.allSettled(jobs);
  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
