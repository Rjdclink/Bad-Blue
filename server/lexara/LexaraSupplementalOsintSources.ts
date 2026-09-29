/**
 * Supplemental public-source discovery inspired by the MIT-licensed Eagle Eye
 * source inventory and Max Intel's public-source catalog.
 *
 * This module does not call either project as a required service. It contributes
 * query hints and authoritative/keyless source roots to Lexara's existing
 * discovery -> crawler -> evidence pipeline.
 */
export interface LexaraSupplementalSource {
  id: string;
  root: string;
  categories: readonly string[];
  queryHints: readonly string[];
  authority: 'primary' | 'secondary' | 'discovery';
  jurisdiction: string;
}

export const LEXARA_EAGLE_EYE_KEYLESS_SOURCES: readonly LexaraSupplementalSource[] = [
  { id:'eagleeye-sec-edgar', root:'https://www.sec.gov/edgar/search/', categories:['business','corporate','securities'], queryHints:['SEC EDGAR','company filings','officer filings'], authority:'primary', jurisdiction:'US' },
  { id:'eagleeye-census-geocoder', root:'https://geocoding.geo.census.gov/geocoder/', categories:['residence','property','geography'], queryHints:['Census geocoder','address census tract'], authority:'primary', jurisdiction:'US' },
  { id:'eagleeye-epa-echo', root:'https://echo.epa.gov/', categories:['property','business','regulatory'], queryHints:['EPA ECHO','facility enforcement','environmental violations'], authority:'primary', jurisdiction:'US' },
  { id:'eagleeye-openfema', root:'https://www.fema.gov/api/open/', categories:['property','geography'], queryHints:['OpenFEMA','disaster declarations','flood claims'], authority:'primary', jurisdiction:'US' },
  { id:'eagleeye-nhtsa-vpic', root:'https://vpic.nhtsa.dot.gov/api/', categories:['transportation'], queryHints:['NHTSA vPIC','VIN decode','vehicle'], authority:'primary', jurisdiction:'US' },
  { id:'eagleeye-nominatim', root:'https://nominatim.openstreetmap.org/', categories:['residence','property','geography'], queryHints:['OpenStreetMap','Nominatim','address'], authority:'secondary', jurisdiction:'global' },
] as const;

// Max Intel is deliberately used as a catalog blueprint, never as a runtime
// dependency. These hints broaden the existing search lanes toward public
// records, registries and authoritative datasets cataloged by Max Intel.
export const LEXARA_MAX_INTEL_QUERY_HINTS: Readonly<Record<string, readonly string[]>> = {
  identity: ['public records','professional license','political donations'],
  residence: ['reverse address','property records','ownership history','county assessor'],
  contacts: ['reverse phone','reverse email','public directory'],
  social: ['social media profile','username'],
  usernames: ['username profile'],
  business: ['corporate registry','SEC EDGAR','state business registry','nonprofit IRS 990','government contracts'],
  corporate: ['corporate registry','SEC EDGAR','registered agent','company officers'],
  property: ['county assessor','property tax','deed','parcel','ownership history'],
  transportation: ['NHTSA VIN','vehicle registration','recall'],
  courts: ['court records','court docket','CourtListener RECAP'],
  'civil-litigation': ['civil court docket','judgment','lawsuit'],
  criminal: ['criminal court records','inmate locator','offender registry'],
  corrections: ['inmate locator','BOP','state DOC','county jail roster'],
  'vital-records': ['obituary','death record','marriage record','divorce record','cemetery'],
  nonprofits: ['IRS 990','nonprofit registry'],
  'government-contracting': ['USAspending','SAM.gov'],
  regulatory: ['OSHA','EPA','FDA enforcement'],
  'intellectual-property': ['USPTO patent','trademark'],
  'domain-web': ['RDAP','WHOIS','DNS','certificate transparency'],
  news: ['news archive','web archive'],
  historical: ['Wayback Machine','web archive'],
};

export function getLexaraSupplementalQueryHints(categories: readonly string[] = []): string[] {
  const selected = categories.flatMap(category => LEXARA_MAX_INTEL_QUERY_HINTS[category] || []);
  return [...new Set(selected)].slice(0, 12);
}

export function getLexaraSupplementalSources(categories: readonly string[] = []): LexaraSupplementalSource[] {
  if (!categories.length) return [...LEXARA_EAGLE_EYE_KEYLESS_SOURCES];
  const wanted = new Set(categories);
  return LEXARA_EAGLE_EYE_KEYLESS_SOURCES.filter(source => source.categories.some(category => wanted.has(category)));
}
