export type LexaraSourceCategory =
  | 'identity'
  | 'contacts-addresses'
  | 'relationships'
  | 'social-online'
  | 'public-images'
  | 'education'
  | 'vital-records'
  | 'professional-license'
  | 'healthcare-professional'
  | 'employment'
  | 'property'
  | 'transportation'
  | 'business'
  | 'courts'
  | 'criminal-records'
  | 'law-enforcement'
  | 'corrections'
  | 'probation-parole'
  | 'warrants'
  | 'sex-offender'
  | 'financial-public'
  | 'financial-professional'
  | 'sanctions-discipline'
  | 'intellectual-property'
  | 'domain-web'
  | 'news-history'
  | 'relationship-timeline'
  | 'government-public'
  | 'general-public-records';

export type LexaraSourceLookupMode = 'api' | 'structured-form' | 'direct-search' | 'interactive' | 'discovery';

export interface LexaraPublicSource {
  id: string;
  root: string;
  categories: readonly LexaraSourceCategory[];
  queryHints: readonly string[];
  authority: 'primary' | 'secondary' | 'discovery' | 'archive';
  jurisdiction: string;
  lookupMode?: LexaraSourceLookupMode;
  // Public, source-specific discovery terms; never grants credentials or gated API access.
  searchAliases?: readonly string[];
}

export const LEXARA_PUBLIC_SOURCES: readonly LexaraPublicSource[] = [
  { id:'cdc-vital-records', root:'https://www.cdc.gov/nchs/w2w/index.htm', categories:['vital-records','identity'], queryHints:['birth record','date of birth','marriage record','divorce record','death record','vital records office'], authority:'primary', jurisdiction:'US' },
  { id:'nursys-license', root:'https://www.nursys.com/', categories:['professional-license','healthcare-professional'], queryHints:['nursing license','RN license','LPN license','APRN license','discipline'], authority:'primary', jurisdiction:'US', lookupMode:'interactive' },
  { id:'careeronestop-license-finder', root:'https://www.careeronestop.org/Toolkit/Training/find-licenses.aspx', categories:['professional-license','employment'], queryHints:['state occupational license','licensing agency','license finder'], authority:'primary', jurisdiction:'US' },
  { id:'ncsbn-license-verification', root:'https://www.ncsbn.org/nursing-regulation/licensure/license-verification.page', categories:['professional-license','healthcare-professional'], queryHints:['nurse license verification','board of nursing','Nursys QuickConfirm'], authority:'primary', jurisdiction:'US', lookupMode:'interactive' },
  { id:'cms-npi-registry', root:'https://npiregistry.cms.hhs.gov/', categories:['healthcare-professional','employment','identity'], queryHints:['NPI registry','healthcare provider','taxonomy','practice address'], authority:'primary', jurisdiction:'US', lookupMode:'api' },
  { id:'oig-leie', root:'https://exclusions.oig.hhs.gov/', categories:['healthcare-professional','sanctions-discipline','employment'], queryHints:['OIG exclusion','LEIE','healthcare exclusion'], authority:'primary', jurisdiction:'US' },
  { id:'finra-brokercheck', root:'https://brokercheck.finra.org/', categories:['financial-professional','professional-license','employment','sanctions-discipline'], queryHints:['BrokerCheck','CRD','broker registration','employment history','regulatory action'], authority:'primary', jurisdiction:'US' },
  { id:'ofac-sanctions', root:'https://ofac.treasury.gov/sanctions-list-service', categories:['sanctions-discipline','government-public'], queryHints:['OFAC sanctions','SDN','sanctions list'], authority:'primary', jurisdiction:'US' },
  { id:'sec-edgar', root:'https://www.sec.gov/search-filings', categories:['business','employment','financial-professional'], queryHints:['SEC EDGAR','company filing','officer','director','ownership filing'], authority:'primary', jurisdiction:'US' },
  { id:'sam-entity', root:'https://sam.gov/', categories:['business','government-public','sanctions-discipline'], queryHints:['SAM entity','federal registration','exclusions'], authority:'primary', jurisdiction:'US' },
  { id:'usaspending', root:'https://www.usaspending.gov/', categories:['business','employment','government-public'], queryHints:['federal awards','recipient','government contract'], authority:'primary', jurisdiction:'US', lookupMode:'api' },
  { id:'irs-teos', root:'https://apps.irs.gov/app/eos/', categories:['business','government-public'], queryHints:['tax exempt organization','Form 990','nonprofit'], authority:'primary', jurisdiction:'US' },
  { id:'courtlistener', root:'https://www.courtlistener.com/', categories:['courts','criminal-records','law-enforcement','financial-public','general-public-records'], queryHints:['CourtListener','RECAP','court docket','case law'], authority:'secondary', jurisdiction:'US', lookupMode:'direct-search' },
  { id:'bop-inmate-locator', root:'https://www.bop.gov/inmateloc/', categories:['corrections','criminal-records','general-public-records'], queryHints:['federal inmate','BOP inmate locator','custody','facility'], authority:'primary', jurisdiction:'US', lookupMode:'structured-form' },
  { id:'usagov-corrections', root:'https://www.usa.gov/state-corrections', categories:['corrections','probation-parole','government-public'], queryHints:['state department of corrections','state inmate locator'], authority:'primary', jurisdiction:'US' },
  { id:'usagov-state-local', root:'https://www.usa.gov/state-local-governments', categories:['professional-license','contacts-addresses','property','business','courts','criminal-records','law-enforcement','corrections','probation-parole','warrants','sex-offender','financial-public','government-public','general-public-records'], queryHints:['state agency','county government','local government','state court','licensing board','county recorder'], authority:'primary', jurisdiction:'US' },
  { id:'vinelink', root:'https://www.vinelink.com/', categories:['corrections','probation-parole','law-enforcement','general-public-records'], queryHints:['custody status','jail','victim notification'], authority:'primary', jurisdiction:'US' },
  { id:'census-geocoder', root:'https://geocoding.geo.census.gov/geocoder/', categories:['property','identity'], queryHints:['Census geocoder','address','county','census tract'], authority:'primary', jurisdiction:'US' },
  { id:'epa-echo', root:'https://echo.epa.gov/', categories:['property','business','government-public'], queryHints:['EPA ECHO','facility','enforcement','environmental'], authority:'primary', jurisdiction:'US' },
  { id:'openfema', root:'https://www.fema.gov/api/open/', categories:['property','government-public'], queryHints:['OpenFEMA','disaster','flood','claims'], authority:'primary', jurisdiction:'US' },
  { id:'nhtsa-vpic', root:'https://vpic.nhtsa.dot.gov/api/', categories:['transportation','general-public-records'], queryHints:['NHTSA vPIC','VIN','vehicle'], authority:'primary', jurisdiction:'US', lookupMode:'api' },
  { id:'uspto-patents', root:'https://www.uspto.gov/patents/search/patent-public-search', categories:['intellectual-property','business'], queryHints:['USPTO patent','inventor','assignee'], authority:'primary', jurisdiction:'US' },
  { id:'uspto-trademarks', root:'https://www.uspto.gov/trademarks/search', categories:['intellectual-property','business'], queryHints:['USPTO trademark','owner','registrant'], authority:'primary', jurisdiction:'US' },
  { id:'icann-rdap', root:'https://lookup.icann.org/en', categories:['domain-web','identity','business'], queryHints:['RDAP','domain registration','registrar'], authority:'primary', jurisdiction:'global' },
  { id:'iana-rdap-bootstrap', root:'https://data.iana.org/rdap/dns.json', categories:['domain-web'], queryHints:['IANA RDAP bootstrap','authoritative RDAP'], authority:'primary', jurisdiction:'global' },
  { id:'cisa-advisories', root:'https://www.cisa.gov/news-events/cybersecurity-advisories', categories:['domain-web','news-history'], queryHints:['cybersecurity advisory','public breach notice'], authority:'primary', jurisdiction:'US' },
  { id:'hibp-breach-directory', root:'https://haveibeenpwned.com/PwnedWebsites', categories:['domain-web','news-history'], queryHints:['public breach directory','breach notice'], authority:'secondary', jurisdiction:'global' },
  { id:'lookups-io', root:'https://lookups.io/', categories:['identity','contacts-addresses','relationships','social-online','general-public-records'], queryHints:['Lookups.io people search','reverse phone lookup','reverse address lookup','email lookup','aliases','age','relatives and associates'], authority:'discovery', jurisdiction:'US', lookupMode:'discovery' },
  { id:'wikidata', root:'https://www.wikidata.org/', categories:['identity','relationships','social-online','education','business','government-public','news-history','relationship-timeline'], queryHints:['Wikidata','public knowledge graph','identity relationship'], authority:'secondary', jurisdiction:'global' },
  { id:'wikidata-query', root:'https://query.wikidata.org/', categories:['identity','relationships','social-online','education','business','government-public','news-history','relationship-timeline'], queryHints:['Wikidata query','public knowledge graph'], authority:'secondary', jurisdiction:'global' },
  { id:'commoncrawl-index', root:'https://index.commoncrawl.org/', categories:['news-history','relationship-timeline','domain-web','social-online','education','employment','business'], queryHints:['historical web page','archived page','former employer','old profile'], authority:'archive', jurisdiction:'global' },
  { id:'nsopw', root:'https://www.nsopw.gov/', categories:['sex-offender','criminal-records','law-enforcement'], queryHints:['national sex offender public website','sex offender registry','offender search'], authority:'primary', jurisdiction:'US' },
  { id:'pacer-court-records', root:'https://pacer.uscourts.gov/', categories:['courts','criminal-records','financial-public'], queryHints:['PACER','federal court docket','bankruptcy court'], authority:'primary', jurisdiction:'US' },
  { id:'fec-data', root:'https://www.fec.gov/data/receipts/individual-contributions/', categories:['government-public','general-public-records'], queryHints:['campaign contribution','FEC individual contribution'], authority:'primary', jurisdiction:'US', lookupMode:'api' },
  { id:'senate-lobbying', root:'https://lda.senate.gov/system/public/', categories:['government-public','business'], queryHints:['lobbying disclosure','lobbyist','client'], authority:'primary', jurisdiction:'US' },
  { id:'nmls-consumer-access', root:'https://www.nmlsconsumeraccess.org/', categories:['professional-license','financial-professional','employment'], queryHints:['NMLS','mortgage loan originator','license'], authority:'primary', jurisdiction:'US' },
  // Supplemental public discovery only; interactive and subscription sources remain gated.
  {"id":"vlex-fastcase","root":"https://us.vlex.com/fastcase-library","categories":["courts"],"queryHints":["Fastcase","vLex Fastcase","legal research library","case law"],"authority":"secondary","jurisdiction":"US","lookupMode":"interactive","searchAliases":["fastcase","vlex fastcase"]},
  {"id":"justia-case-law","root":"https://law.justia.com/","categories":["courts"],"queryHints":["Justia","case law","state appellate opinions"],"authority":"secondary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["justia"]},
  {"id":"findlaw-case-law","root":"https://caselaw.findlaw.com/","categories":["courts"],"queryHints":["FindLaw","case law","court opinions"],"authority":"secondary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["findlaw"]},
  {"id":"google-scholar-cases","root":"https://scholar.google.com/","categories":["courts","education"],"queryHints":["Google Scholar","case law","legal scholarship"],"authority":"secondary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["google scholar"]},
  {"id":"govinfo","root":"https://www.govinfo.gov/","categories":["government-public","courts"],"queryHints":["GovInfo","federal statutes","official publications","United States Code"],"authority":"primary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["govinfo"]},
  {"id":"congress-legislation","root":"https://www.congress.gov/","categories":["government-public"],"queryHints":["Congress.gov","congressional bills","federal legislative history"],"authority":"primary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["congress.gov","congressional bills"]},
  {"id":"state-legislatures-directory","root":"https://www.ncsl.org/","categories":["government-public","courts"],"queryHints":["NCSL state legislature directory","state statutes","legislative websites"],"authority":"secondary","jurisdiction":"US","lookupMode":"discovery","searchAliases":["state legislature directory","state legislative websites"]},
  {"id":"federal-courts","root":"https://www.uscourts.gov/court-records","categories":["courts","government-public"],"queryHints":["US Courts","federal court records","federal court forms","court procedures"],"authority":"primary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["federal court records","us courts website"]},
  {"id":"state-court-directory","root":"https://www.justice.gov/jmd/ls/state","categories":["courts","government-public"],"queryHints":["NCSC","state court websites","state court directories"],"authority":"secondary","jurisdiction":"US","lookupMode":"discovery","searchAliases":["state court websites","ncsc"]},
  {"id":"cornell-lii","root":"https://www.law.cornell.edu/","categories":["courts","government-public"],"queryHints":["Cornell LII","Legal Information Institute","statutes","federal rules"],"authority":"secondary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["cornell lii","legal information institute"]},
  {"id":"ecfr","root":"https://www.ecfr.gov/","categories":["government-public"],"queryHints":["eCFR","federal regulations","Code of Federal Regulations"],"authority":"primary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["ecfr","code of federal regulations"]},
  {"id":"federal-register","root":"https://www.federalregister.gov/","categories":["government-public","news-history"],"queryHints":["Federal Register","agency rules","federal rulemaking notices"],"authority":"primary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["federal register"]},
  {"id":"caselaw-access-project","root":"https://case.law/","categories":["courts"],"queryHints":["Harvard Caselaw Access Project","historic case law","historical court opinions"],"authority":"archive","jurisdiction":"US","lookupMode":"discovery","searchAliases":["caselaw access project","harvard caselaw"]},
  {"id":"openjurist","root":"https://openjurist.org/","categories":["courts"],"queryHints":["OpenJurist","federal case opinions","law library"],"authority":"secondary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["openjurist"]},
  {"id":"leagle","root":"https://www.leagle.com/","categories":["courts"],"queryHints":["Leagle","appellate opinions","case law"],"authority":"secondary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["leagle"]},
  {"id":"lawdiver","root":"https://lawdiver.com/","categories":["courts"],"queryHints":["LawDiver","free legal case search","court opinions"],"authority":"secondary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["lawdiver"]},
  {"id":"fdic-bankfind","root":"https://banks.data.fdic.gov/bankfind-suite/","categories":["business","financial-public","financial-professional"],"queryHints":["FDIC BankFind","bank charter","bank branch","bank institution history"],"authority":"primary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["fdic bankfind","bankfind"]},
  {"id":"netr-public-records","root":"https://publicrecords.netronline.com/","categories":["property","financial-public","general-public-records"],"queryHints":["NETR Online","county assessor","property tax","recorder","land deeds"],"authority":"discovery","jurisdiction":"US","lookupMode":"discovery","searchAliases":["netr","netr online"]},
  {"id":"opencorporates","root":"https://opencorporates.com/","categories":["business","government-public"],"queryHints":["OpenCorporates","business officers","business entity register"],"authority":"secondary","jurisdiction":"US","lookupMode":"interactive","searchAliases":["opencorporates"]},
  {"id":"wayback-machine","root":"https://web.archive.org/","categories":["news-history","domain-web","relationship-timeline","business"],"queryHints":["Wayback Machine","archived websites","historical web pages","site history"],"authority":"archive","jurisdiction":"US","lookupMode":"discovery","searchAliases":["wayback machine","internet archive"]},
  {"id":"reuters","root":"https://www.reuters.com/","categories":["news-history"],"queryHints":["Reuters","news reporting","current events"],"authority":"secondary","jurisdiction":"US","lookupMode":"discovery","searchAliases":["reuters"]},
  {"id":"associated-press","root":"https://apnews.com/","categories":["news-history"],"queryHints":["Associated Press","AP News","current news"],"authority":"secondary","jurisdiction":"US","lookupMode":"discovery","searchAliases":["associated press","ap news"]},
  {"id":"nass-corporate-registration","root":"https://www.nass.org/business-services/corporate-registration","categories":["business","financial-public","government-public"],"queryHints":["NASS corporate registration","state secretaries of state","business registrations","UCC filings"],"authority":"primary","jurisdiction":"US","lookupMode":"discovery","searchAliases":["nass","corporate registration"]},
  {"id":"justice-press-releases","root":"https://www.justice.gov/news","categories":["news-history","criminal-records","courts","government-public"],"queryHints":["Department of Justice","DOJ press releases","federal enforcement"],"authority":"primary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["doj press releases","justice department news"]},
  {"id":"library-of-congress","root":"https://www.loc.gov/","categories":["news-history","government-public","education"],"queryHints":["Library of Congress","historical newspapers","legal history","Congressional documents"],"authority":"primary","jurisdiction":"US","lookupMode":"direct-search","searchAliases":["library of congress"]},
  { id:'whitepages', root:'https://www.whitepages.com/', categories:['identity','contacts-addresses','relationships','property','general-public-records'], queryHints:['Whitepages','people search','reverse phone lookup','reverse address lookup'], authority:'discovery', jurisdiction:'US', lookupMode:'discovery', searchAliases:['whitepages'] },
  { id:'yellowpages', root:'https://www.yellowpages.com/', categories:['business','contacts-addresses','employment','general-public-records'], queryHints:['Yellow Pages','local business directory','business phone number','business address'], authority:'discovery', jurisdiction:'US', lookupMode:'discovery', searchAliases:['yellow pages','yellowpages'] },
  { id:'who-is', root:'https://www.who.is/whois', categories:['domain-web','business'], queryHints:['Who.is','WHOIS','domain registration','RDAP','registrar'], authority:'secondary', jurisdiction:'global', lookupMode:'direct-search', searchAliases:['who.is','whois lookup'] },
] as const;

export const LEXARA_CATEGORY_QUERY_HINTS: Readonly<Record<LexaraSourceCategory, readonly string[]>> = {
  identity: ['identity','date of birth','age','public record'],
  'contacts-addresses': ['phone','email','address','residence','public directory','reverse address'],
  relationships: ['relative','family','associate','household','spouse','relationship'],
  'social-online': ['social media profile','username','online account','web profile'],
  'public-images': ['public photo','image','portrait','news photo'],
  education: ['education','school','college','university','degree','alumni'],
  'vital-records': ['birth record','date of birth','marriage record','divorce record','death record','vital records'],
  'professional-license': ['professional license','license verification','licensure','credential','discipline','state licensing board'],
  'healthcare-professional': ['NPI','healthcare provider','nursing license','medical license','discipline','exclusion'],
  employment: ['employment','employer','staff directory','professional profile','occupation','work history'],
  property: ['county assessor','county recorder','property tax','deed','parcel','ownership'],
  transportation: ['vehicle','VIN','NHTSA','vehicle title','transportation record'],
  business: ['business registry','company officer','SEC EDGAR','registered agent','government contracts'],
  courts: ['court record','docket','case filing','RECAP','judgment'],
  'criminal-records': ['criminal record','charge','conviction','offense','court docket'],
  'law-enforcement': ['arrest','booking','police','sheriff','law enforcement record'],
  corrections: ['inmate locator','state DOC','county jail roster','custody status','BOP'],
  'probation-parole': ['probation','parole','supervision','community supervision'],
  warrants: ['warrant','wanted person','fugitive','sheriff warrant'],
  'sex-offender': ['sex offender registry','NSOPW','registered offender'],
  'financial-public': ['bankruptcy','lien','judgment','UCC','financial public record'],
  'financial-professional': ['FINRA BrokerCheck','investment adviser','broker registration','CRD'],
  'sanctions-discipline': ['disciplinary action','exclusion','OFAC','OIG LEIE','SAM exclusion'],
  'intellectual-property': ['USPTO patent','USPTO trademark','inventor','assignee','owner'],
  'domain-web': ['RDAP','domain registration','web footprint','website','certificate transparency'],
  'news-history': ['news archive','historical','former','previous','archive','Common Crawl'],
  'relationship-timeline': ['timeline','chronology','relationship history','event sequence','corroboration'],
  'government-public': ['government employee','public office','federal award','government contract'],
  'general-public-records': ['public records','official registry','government database'],
};

export function getLexaraPublicSources(
  categories: readonly LexaraSourceCategory[] = [],
  jurisdiction?: string,
): LexaraPublicSource[] {
  const wanted = new Set(categories.length ? categories : ['general-public-records'] as LexaraSourceCategory[]);
  const normalizedJurisdiction = String(jurisdiction || '').toUpperCase();
  return LEXARA_PUBLIC_SOURCES.filter(source =>
    source.categories.some(category => wanted.has(category))
    && (source.jurisdiction === 'US' || source.jurisdiction === 'global'
      || !normalizedJurisdiction || normalizedJurisdiction.includes(source.jurisdiction.toUpperCase()))
  );
}

export function getLexaraSourceQueryHints(categories: readonly LexaraSourceCategory[] = []): string[] {
  return [...new Set(categories.flatMap(category => LEXARA_CATEGORY_QUERY_HINTS[category] || []))].slice(0, 16);
}

export function buildLexaraSourceQueries(input: {
  query: string;
  subject?: string;
  requestedFact?: string;
  categories?: readonly LexaraSourceCategory[];
  jurisdiction?: string;
}): string[] {
  const categories = input.categories || [];
  const hints = getLexaraSourceQueryHints(categories);
  const sources = getLexaraPublicSources(categories, input.jurisdiction);
  const identity = input.subject ? `"${input.subject}"` : '';
  const jurisdiction = input.jurisdiction || '';
  const base = [input.query, identity, jurisdiction].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const hinted = [base, ...hints.slice(0, 4)].filter(Boolean).join(' ');
  const jurisdictionOfficial = [
    identity || input.query,
    input.requestedFact || hints.slice(0, 2).join(' '),
    jurisdiction,
    'official state agency board registry public record',
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const official = sources.filter(source => source.lookupMode !== 'discovery').slice(0, 2).map(source => {
    try {
      return `site:${new URL(source.root).hostname} ${identity || input.query} ${input.requestedFact || hints.slice(0, 2).join(' ')} ${jurisdiction}`.replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  }).filter(Boolean);
  const discovery = sources.filter(source => source.lookupMode === 'discovery').slice(0, 1).map(source => {
    try {
      return `site:${new URL(source.root).hostname} ${identity || input.query} ${input.requestedFact || hints.slice(0, 2).join(' ')} ${jurisdiction}`.replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  }).filter(Boolean);
  // Explicit source requests must reach that public website even in first-useful
  // searches, which only execute the first two planned query variants.
  // A site: query discovers public material; it does not log in or bypass paywalls.
  const requestedSourceName = input.query.toLowerCase();
  const namedSource = LEXARA_PUBLIC_SOURCES.find(source =>
    source.searchAliases?.some(alias => alias.length >= 4 && requestedSourceName.includes(alias.toLowerCase()))
  );
  let namedSourceQuery = '';
  if (namedSource) {
    try {
      namedSourceQuery = `site:${new URL(namedSource.root).hostname} ${identity || input.query} ${jurisdiction}`.replace(/\s+/g, ' ').trim();
    } catch {
      // Invalid source roots never stop the rest of the public-source discovery.
    }
  }
  const fact = input.requestedFact && input.requestedFact !== 'none' ? input.requestedFact.replace(/-/g, ' ') : '';
  // Live discovery uses the first two variants. Keep both focused on the fact,
  // and let the unquoted variant find records that omit middle names. Identity
  // matching still happens after retrieval; this does not accept namesakes.
  const focused = identity && fact ? [identity, fact, jurisdiction].filter(Boolean).join(' ') : base;
  const relaxed = identity && fact ? [input.subject, fact, jurisdiction].filter(Boolean).join(' ') : hinted;
  return [...new Set([focused, namedSourceQuery, relaxed, jurisdictionOfficial, ...official, ...discovery, hinted].filter(Boolean))].slice(0, 6);
}
