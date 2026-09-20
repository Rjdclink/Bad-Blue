/**
 * SPECTRA source registry.
 *
 * Central, retrieval-oriented catalog for source families discovered during the
 * 2026-09-20 source expansion. Priority is capability/target dependent rather
 * than a rigid global ordering. The orchestrator should select applicable
 * families from the clues it actually has, run independent families in
 * parallel, and preserve provenance/failure telemetry.
 *
 * This catalog contains discovery endpoints and source families. It does not
 * contain credentials. Providers requiring configured credentials are marked
 * "configured"; direct web/search sources are "discoverable".
 */
export type SpectraSourceTier = 'P0' | 'P1' | 'P2' | 'P3';
export type SpectraSourceMode = 'discoverable' | 'configured' | 'local';

export interface SpectraSourceDefinition {
  id: string;
  label: string;
  tier: SpectraSourceTier;
  modes: SpectraSourceMode[];
  clues: string[];
  capabilities: string[];
  domains?: string[];
}

const source = (
  id: string, label: string, tier: SpectraSourceTier,
  clues: string[], capabilities: string[], domains: string[] = [],
  modes: SpectraSourceMode[] = ['discoverable'],
): SpectraSourceDefinition => ({ id, label, tier, clues, capabilities, domains, modes });

export const SPECTRA_SOURCE_REGISTRY: SpectraSourceDefinition[] = [
  source('identity-people-search','People/identity resolution','P0',['name','phone','email','address','username'],['identity','address-history','associates'],['fastpeoplesearch.com','truepeoplesearch.com','whitepages.com','spokeo.com','pipl.com','peekyou.com','familytreenow.com','zabasearch.com','searchbug.com','infotracer.com','socialcatfish.com','usersearch.org']),
  source('public-records','Public records and government indexes','P0',['name','address','phone','location'],['public-records','address','events','associates'],['usa.gov','archives.gov','bop.gov','vinelink.com','judyrecords.com','unicourt.com','voterrecords.com','familysearch.org']),
  source('maps-geocoding','Maps, geocoding and place intelligence','P0',['address','location','coordinates','landmark'],['geocode','reverse-geocode','map','places'],['openstreetmap.org','nominatim.openstreetmap.org','overpass-turbo.eu','mapillary.com','kartaview.org','google.com/maps','bing.com/maps','maps.apple.com','arcgis.com']),
  source('social-discovery','Social/profile discovery','P0',['name','username','email','phone','image'],['profiles','posts','location-tags','relationships'],['facebook.com','instagram.com','x.com','tiktok.com','linkedin.com','reddit.com','youtube.com','pinterest.com','tumblr.com','medium.com','mastodon.social','bsky.app','github.com','gitlab.com','twitch.tv','steamcommunity.com','soundcloud.com','last.fm','flickr.com','strava.com']),
  source('username-enumeration','Username enumeration','P0',['username','name','email'],['profiles','identity-correlation'],['whatsmyname.app','namechk.com','sherlock-project.github.io','blackbird-osint.herokuapp.com']),
  source('email-intelligence','Email intelligence','P0',['email','name'],['identity','accounts','domain-correlation'],['epieos.com','hunter.io','gravatar.com']),
  source('phone-intelligence','Phone intelligence','P0',['phone','name'],['carrier','identity','accounts'],['truecaller.com','numlookup.com','searchpeoplefree.com']),
  source('reverse-image','Reverse image and visual discovery','P0',['image','name','username'],['reverse-image','visual-match','profile-discovery'],['images.google.com','lens.google.com','tineye.com','bing.com/visualsearch','yandex.com/images']),
  source('image-geolocation','Image/video geolocation','P0',['image','video','landmark'],['visual-geolocation','landmarks','scene-correlation'],['mapillary.com','kartaview.org','geotastic.net','geospy.ai','picarta.ai']),
  source('metadata','Local media/document metadata','P0',['image','video','document'],['exif','xmp','iptc','gps','timestamps'],[],['local']),
  source('property-address','Property/address records','P1',['address','name','location'],['property','ownership','address-history'],['regrid.com','countyoffice.org','propertyshark.com','homemetry.com']),
  source('business-professional','Business/professional records','P1',['name','email','phone','address','company'],['employment','business','professional-address'],['opencorporates.com','sec.gov','bbb.org','crunchbase.com','apollo.io','kompass.com']),
  source('court-legal','Court/legal records','P1',['name','location','address'],['court-records','events','jurisdiction'],['pacer.uscourts.gov','courtlistener.com','unicourt.com','judyrecords.com']),
  source('news-web','News and general web discovery','P1',['name','username','phone','email','address','location'],['mentions','events','location-context'],['google.com','bing.com','duckduckgo.com','news.google.com']),
  source('archives','Web/archive history','P1',['url','username','name','domain'],['historical-pages','historical-profiles'],['web.archive.org','archive.today']),
  source('documents','Documents and indexed files','P1',['name','email','phone','address'],['documents','metadata','mentions'],['google.com','bing.com','archive.org']),
  source('transportation','Transportation/public movement context','P2',['vehicle','location','identifier'],['transport-context','vehicle-records'],['faa.gov','flightradar24.com','marinetraffic.com','vesselfinder.com']),
  source('weather-sun','Environmental corroboration','P2',['timestamp','image','location'],['weather','sun-angle','temporal-corroboration'],['weather.gov','timeanddate.com','meteostat.net']),
  source('satellite-imagery','Satellite/aerial context','P2',['location','coordinates','image'],['satellite','aerial','terrain'],['earth.google.com','sentinel-hub.com','zoom.earth','usgs.gov']),
  source('street-imagery','Street-level imagery','P2',['location','coordinates','landmark'],['street-view','visual-corroboration'],['mapillary.com','kartaview.org','google.com/maps']),
  source('genealogy-obituaries','Genealogy/obituary relationship pivots','P2',['name','relative','location'],['associates','historical-address','relationships'],['familysearch.org','findagrave.com','legacy.com','ancestry.com']),
  source('licenses-registries','Licenses and registries','P2',['name','location','profession'],['license','address','identity'],['nursys.com','fsmb.org','verify.tn.gov']),
  source('campaign-public-filings','Public filing indexes','P2',['name','address','employer'],['filings','address','employment'],['fec.gov']),
  source('open-data','Government open-data portals','P2',['name','address','location'],['datasets','records','geospatial'],['data.gov','catalog.data.gov']),
  source('osint-aggregators','OSINT aggregation/discovery','P1',['name','username','email','phone','domain','address'],['source-discovery','identity-correlation'],['osintframework.com','osintdirectory.com','osintguide.com','maxintel.org','osintyourself.com','spiderfoot.net','maltego.com','lampyre.io']),
  source('web-crawlers','Crawler/search execution','P0',['url','name','username','email','phone','address'],['crawl','extract','discover'],['firecrawl.dev','apify.com'],['configured']),
  source('browser-extraction','Browser extraction','P1',['url'],['render','extract','dynamic-pages'],[],['local']),
  source('graph-analysis','Evidence graph analysis','P0',['any'],['graph','correlation','dedupe','pivot'],[],['local']),
  source('timeline-analysis','Temporal evidence analysis','P0',['timestamp','event','location'],['timeline','recency','contradiction'],[],['local']),
  source('geospatial-fusion','Geospatial evidence fusion','P0',['coordinates','address','location','image'],['fusion','confidence','candidate-regions'],[],['local']),
];

const TIER_WEIGHT: Record<SpectraSourceTier, number> = { P0: 4, P1: 3, P2: 2, P3: 1 };

export function selectSpectraSources(clues: Iterable<string>, limit = 30): SpectraSourceDefinition[] {
  const clueSet = new Set([...clues].map(v => v.toLowerCase()));
  return SPECTRA_SOURCE_REGISTRY
    .map(entry => ({
      entry,
      score: TIER_WEIGHT[entry.tier] * 10 +
        entry.clues.reduce((n, clue) => n + (clueSet.has(clue) || clue === 'any' ? 4 : 0), 0),
    }))
    .filter(({ score }) => score > 10)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, Math.max(1, limit))
    .map(({ entry }) => entry);
}

export function spectraDiscoveryDomains(clues: Iterable<string>, limit = 30): string[] {
  return [...new Set(selectSpectraSources(clues, limit).flatMap(entry => entry.domains || []))];
}
