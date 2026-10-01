import * as cheerio from 'cheerio';
import type { ResolvedJurisdiction } from './LexaraJurisdictionResolver';

export type JurisdictionSystem = 'federal' | 'state' | 'mixed' | 'local' | 'unknown';

export interface JurisdictionOfficialResource {
  title: string;
  url: string;
  host: string;
  kind: 'federal-circuit' | 'federal-district' | 'state-judiciary' | 'state-appellate' | 'state-trial' | 'rules' | 'forms' | 'laws' | 'directory';
}

export interface JurisdictionAuthorityProfile {
  display: string;
  stateName?: string;
  stateCode?: string;
  county?: string;
  locality?: string;
  system: JurisdictionSystem;
  federalCircuit?: string;
  federalCircuitNumber?: string;
  explicitCourt?: string;
  officialDirectoryUrl?: string;
  officialResources: JurisdictionOfficialResource[];
  preferredOfficialDomains: string[];
  researchHints: string[];
  needsCourtClarification: boolean;
  confidence: 'verified-locality' | 'state-resolved' | 'state-only' | 'unresolved';
  generatedAt: string;
}

const STATE_CODES: Record<string, string> = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA','colorado':'CO','connecticut':'CT','delaware':'DE',
  'district of columbia':'DC','florida':'FL','georgia':'GA','hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA',
  'kansas':'KS','kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA','michigan':'MI','minnesota':'MN',
  'mississippi':'MS','missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ',
  'new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK','oregon':'OR',
  'pennsylvania':'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT',
  'vermont':'VT','virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY',
  'puerto rico':'PR','virgin islands':'VI','u.s. virgin islands':'VI','guam':'GU','northern mariana islands':'MP',
  'american samoa':'AS'
};

const CODE_TO_STATE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_CODES).map(([name, code]) => [
    code,
    name.replace(/\b\w/g, char => char.toUpperCase())
  ])
);

const CIRCUIT_BY_CODE: Record<string, { name: string; number: string }> = {
  ME:{name:'First Circuit',number:'1'}, MA:{name:'First Circuit',number:'1'}, NH:{name:'First Circuit',number:'1'}, PR:{name:'First Circuit',number:'1'}, RI:{name:'First Circuit',number:'1'},
  CT:{name:'Second Circuit',number:'2'}, NY:{name:'Second Circuit',number:'2'}, VT:{name:'Second Circuit',number:'2'},
  DE:{name:'Third Circuit',number:'3'}, NJ:{name:'Third Circuit',number:'3'}, PA:{name:'Third Circuit',number:'3'}, VI:{name:'Third Circuit',number:'3'},
  MD:{name:'Fourth Circuit',number:'4'}, NC:{name:'Fourth Circuit',number:'4'}, SC:{name:'Fourth Circuit',number:'4'}, VA:{name:'Fourth Circuit',number:'4'}, WV:{name:'Fourth Circuit',number:'4'},
  LA:{name:'Fifth Circuit',number:'5'}, MS:{name:'Fifth Circuit',number:'5'}, TX:{name:'Fifth Circuit',number:'5'},
  KY:{name:'Sixth Circuit',number:'6'}, MI:{name:'Sixth Circuit',number:'6'}, OH:{name:'Sixth Circuit',number:'6'}, TN:{name:'Sixth Circuit',number:'6'},
  IL:{name:'Seventh Circuit',number:'7'}, IN:{name:'Seventh Circuit',number:'7'}, WI:{name:'Seventh Circuit',number:'7'},
  AR:{name:'Eighth Circuit',number:'8'}, IA:{name:'Eighth Circuit',number:'8'}, MN:{name:'Eighth Circuit',number:'8'}, MO:{name:'Eighth Circuit',number:'8'}, NE:{name:'Eighth Circuit',number:'8'}, ND:{name:'Eighth Circuit',number:'8'}, SD:{name:'Eighth Circuit',number:'8'},
  AK:{name:'Ninth Circuit',number:'9'}, AZ:{name:'Ninth Circuit',number:'9'}, CA:{name:'Ninth Circuit',number:'9'}, GU:{name:'Ninth Circuit',number:'9'}, HI:{name:'Ninth Circuit',number:'9'}, ID:{name:'Ninth Circuit',number:'9'}, MT:{name:'Ninth Circuit',number:'9'}, NV:{name:'Ninth Circuit',number:'9'}, OR:{name:'Ninth Circuit',number:'9'}, WA:{name:'Ninth Circuit',number:'9'}, MP:{name:'Ninth Circuit',number:'9'},
  CO:{name:'Tenth Circuit',number:'10'}, KS:{name:'Tenth Circuit',number:'10'}, NM:{name:'Tenth Circuit',number:'10'}, OK:{name:'Tenth Circuit',number:'10'}, UT:{name:'Tenth Circuit',number:'10'}, WY:{name:'Tenth Circuit',number:'10'},
  AL:{name:'Eleventh Circuit',number:'11'}, FL:{name:'Eleventh Circuit',number:'11'}, GA:{name:'Eleventh Circuit',number:'11'},
  DC:{name:'District of Columbia Circuit',number:'DC'}
};

const DIRECTORY_CACHE = new Map<string, { expiresAt: number; resources: JurisdictionOfficialResource[] }>();
const DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;
const DIRECTORY_TIMEOUT_MS = 1600;

function normalizeState(value?: string): { name?: string; code?: string } {
  let raw = String(value || '').trim();
  if (!raw) return {};
  const federalPlus = /^federal\s*(?:\+|\/|and)\s*(.+)$/i.exec(raw);
  if (federalPlus?.[1]) raw = federalPlus[1].trim();
  if (/^federal$/i.test(raw)) return {};
  const upper = raw.toUpperCase();
  if (CODE_TO_STATE[upper]) return { name: CODE_TO_STATE[upper], code: upper };
  const normalized = raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const code = STATE_CODES[normalized];
  return code ? { name: CODE_TO_STATE[code], code } : { name: raw };
}

function stateSlug(stateName?: string): string | undefined {
  if (!stateName) return undefined;
  return stateName.toLowerCase()
    .replace(/^u\.s\.\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferSystem(prompt: string): JurisdictionSystem {
  const text = String(prompt || '');
  const federal = /\b(?:federal|u\.s\. district|u\.s\. court|united states court|u\.s\.c\.|constitution|section 1983|§\s*1983|federal rules?|bankrupt|immigration|habeas|2254|2255)\b/i.test(text);
  const local = /\b(?:city|municipal|county|ordinance|zoning|local rule|local court|traffic ordinance)\b/i.test(text);
  const state = /\b(?:state law|state court|state statute|family law|divorce|custody|probate|landlord|tenant|eviction|state criminal|state charge)\b/i.test(text);
  if (federal && (state || local)) return 'mixed';
  if (federal) return 'federal';
  if (local) return 'local';
  if (state) return 'state';
  return 'unknown';
}

function explicitCourtFromPrompt(prompt: string): string | undefined {
  const text = String(prompt || '').replace(/\s+/g, ' ').trim();
  const patterns = [
    /\b((?:United States|U\.S\.)\s+(?:District|Bankruptcy|Court of Appeals)\s+Court[^,.!?]{0,100})/i,
    /\b((?:Northern|Southern|Eastern|Western|Middle|Central)\s+District\s+of\s+[A-Z][A-Za-z .'-]{2,50})/i,
    /\b([A-Z][A-Za-z .'-]{2,60}\s+(?:Supreme Court|Court of Appeals|District Court|Circuit Court|Superior Court|County Court|Municipal Court|Family Court|Probate Court))/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().slice(0, 180);
  }
  return undefined;
}

function safeHost(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function officialish(url: string, title: string): boolean {
  const host = safeHost(url);
  if (!host) return false;
  if (/findlaw|justia|westlaw|lexis|lawyers|bar\.org|facebook|linkedin|youtube/.test(host)) return false;
  if (host.endsWith('.gov') || host.endsWith('.uscourts.gov') || host.endsWith('.us')) return true;
  return /\b(?:judicial branch|state judiciary|supreme court|court of appeals|district courts?|court rules?|court forms?)\b/i.test(title);
}

function resourceKind(title: string, url: string): JurisdictionOfficialResource['kind'] {
  const text = title.toLowerCase();
  const host = safeHost(url) || '';
  if (host.endsWith('.uscourts.gov') && /district/.test(text)) return 'federal-district';
  if (/circuit/.test(text) && host.endsWith('.uscourts.gov')) return 'federal-circuit';
  if (/forms?/.test(text)) return 'forms';
  if (/rules?/.test(text)) return 'rules';
  if (/code|statute|legislature|laws?/.test(text)) return 'laws';
  if (/supreme|appeals?/.test(text)) return 'state-appellate';
  if (/district court|trial court|lower court|county court|municipal court/.test(text)) return 'state-trial';
  if (/judicial branch|state judiciary|judiciary/.test(text)) return 'state-judiciary';
  return 'directory';
}

async function fetchStateDirectory(
  stateName: string,
  signal?: AbortSignal
): Promise<{ url: string; resources: JurisdictionOfficialResource[] }> {
  const slug = stateSlug(stateName);
  const root = 'https://www.justice.gov/jmd/ls/state';
  if (!slug) return { url: root, resources: [] };
  const directoryUrl = root + '/' + slug;
  const cached = DIRECTORY_CACHE.get(slug);
  if (cached && cached.expiresAt > Date.now()) {
    return { url: directoryUrl, resources: cached.resources };
  }

  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', relayAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('jurisdiction directory timeout')), DIRECTORY_TIMEOUT_MS);
  try {
    const response = await fetch(directoryUrl, {
      headers: { Accept: 'text/html', 'User-Agent': 'LegalWhat/1.0 jurisdiction-authority' },
      signal: controller.signal
    });
    if (!response.ok) return { url: directoryUrl, resources: [] };
    const html = await response.text();
    const $ = cheerio.load(html);
    const resources: JurisdictionOfficialResource[] = [];
    const seen = new Set<string>();
    $('a[href]').each((_index, element) => {
      const title = $(element).text().replace(/\s+/g, ' ').trim();
      const href = String($(element).attr('href') || '').trim();
      if (!title || !href) return;
      let url: string;
      try {
        url = new URL(href, directoryUrl).toString();
      } catch {
        return;
      }
      if (!officialish(url, title)) return;
      const host = safeHost(url);
      if (!host || seen.has(url)) return;
      seen.add(url);
      resources.push({
        title: title.slice(0, 200),
        url,
        host,
        kind: resourceKind(title, url)
      });
    });
    const limited = resources.slice(0, 36);
    DIRECTORY_CACHE.set(slug, {
      expiresAt: Date.now() + DIRECTORY_TTL_MS,
      resources: limited
    });
    return { url: directoryUrl, resources: limited };
  } catch {
    return { url: directoryUrl, resources: [] };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relayAbort);
  }
}

export async function resolveJurisdictionAuthorityProfile(
  prompt: string,
  resolved: ResolvedJurisdiction | null,
  fallbackState?: string,
  signal?: AbortSignal
): Promise<JurisdictionAuthorityProfile | null> {
  const state = normalizeState(resolved?.state || fallbackState);
  const display = resolved?.display || state.name || fallbackState || '';
  if (!display && !state.code) return null;

  const circuit = state.code ? CIRCUIT_BY_CODE[state.code] : undefined;
  const system = inferSystem(prompt);
  const explicitCourt = explicitCourtFromPrompt(prompt);
  const directory = state.name
    ? await fetchStateDirectory(state.name, signal)
    : { url: undefined, resources: [] as JurisdictionOfficialResource[] };
  const federalDistricts = directory.resources.filter(resource => resource.kind === 'federal-district');

  const officialResources: JurisdictionOfficialResource[] = [
    ...(directory.url ? [{
      title: (state.name || display) + ' court resources — U.S. Department of Justice',
      url: directory.url,
      host: 'justice.gov',
      kind: 'directory' as const
    }] : []),
    {
      title: 'Federal Court Finder',
      url: 'https://www.uscourts.gov/federal-court-finder/find',
      host: 'uscourts.gov',
      kind: 'directory' as const
    },
    {
      title: 'Current Federal Rules of Practice & Procedure',
      url: 'https://www.uscourts.gov/forms-rules/current-rules-practice-procedure',
      host: 'uscourts.gov',
      kind: 'rules' as const
    },
    ...directory.resources
  ];
  const preferredOfficialDomains = [...new Set(
    officialResources.map(resource => resource.host).filter(Boolean)
  )].slice(0, 18);

  const needsFederalDistrict = (system === 'federal' || system === 'mixed')
    && federalDistricts.length > 1
    && !explicitCourt;
  const needsLocalCourt = (system === 'state' || system === 'local' || system === 'mixed')
    && !explicitCourt
    && !resolved?.county
    && !resolved?.locality;

  const researchHints = [
    state.name ? state.name + ' controlling statutes and court rules' : '',
    resolved?.county ? resolved.county + ' local court rules forms filing requirements' : '',
    resolved?.locality ? resolved.locality + ' municipal ordinances and local court' : '',
    circuit ? circuit.name + ' controlling federal precedent' : '',
    system === 'federal' || system === 'mixed'
      ? 'identify the exact U.S. district court before applying district local rules'
      : '',
    system === 'state' || system === 'local' || system === 'mixed'
      ? 'identify the exact state/local trial court before applying local forms or deadlines'
      : ''
  ].filter(Boolean);

  return {
    display,
    stateName: state.name,
    stateCode: state.code,
    county: resolved?.county,
    locality: resolved?.locality,
    system,
    federalCircuit: circuit?.name,
    federalCircuitNumber: circuit?.number,
    explicitCourt,
    officialDirectoryUrl: directory.url,
    officialResources,
    preferredOfficialDomains,
    researchHints,
    needsCourtClarification: needsFederalDistrict || needsLocalCourt,
    confidence: resolved?.county || resolved?.locality
      ? 'verified-locality'
      : state.code
        ? (resolved?.state ? 'state-resolved' : 'state-only')
        : 'unresolved',
    generatedAt: new Date().toISOString()
  };
}

export function formatJurisdictionAuthorityForSystem(
  profile: JurisdictionAuthorityProfile | null
): string {
  if (!profile) return '';
  const resources = profile.officialResources.slice(0, 12)
    .map(resource => '- ' + resource.kind + ': ' + resource.title + ' — ' + resource.url)
    .join('\n');

  return '\n\nAPPLICATION-SUPPLIED JURISDICTION AUTHORITY\n'
    + 'Geography: ' + profile.display + '\n'
    + 'State: ' + (profile.stateName || 'unresolved') + (profile.stateCode ? ' (' + profile.stateCode + ')' : '') + '\n'
    + 'County/locality: ' + ([profile.county, profile.locality].filter(Boolean).join(' / ') || 'not yet established') + '\n'
    + 'Likely legal system for this turn: ' + profile.system + '\n'
    + 'Federal appellate circuit: ' + (profile.federalCircuit || 'not applicable or unresolved') + '\n'
    + 'Explicit court supplied by user: ' + (profile.explicitCourt || 'none') + '\n'
    + 'Court-level clarification still needed: ' + (profile.needsCourtClarification ? 'yes' : 'no') + '\n\n'
    + 'Vetted court-resource starting points:\n' + resources + '\n\n'
    + 'JURISDICTION RULES:\n'
    + '- Geography is not the same thing as subject-matter jurisdiction, personal jurisdiction, venue, or the identity of the filing court.\n'
    + '- Do not invent a trial court, federal district, division, judge, local rule, form, filing requirement, service method, fee, or deadline.\n'
    + '- Federal questions must use controlling Supreme Court and mapped circuit authority, then the exact district local rules when district practice matters.\n'
    + '- State/local questions must use current state statutes/rules and the exact court/local authority when procedure, forms, filing, service, or deadlines depend on the court.\n'
    + '- When multiple trial courts remain plausible and the answer materially depends on which one applies, ask only for the missing court/county/case detail rather than guessing.\n'
    + '- Treat the listed resources as discovery starting points; substantive propositions still require retrieved source support.';
}
