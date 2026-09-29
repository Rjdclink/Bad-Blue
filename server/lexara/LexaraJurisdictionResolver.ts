export interface ResolvedJurisdiction {
  display: string; locality?: string; county?: string; state?: string; country?: string;
  latitude?: number; longitude?: number; providers: string[];
}
type Candidate = Omit<ResolvedJurisdiction, 'display' | 'providers'> & { provider: string };
const TIMEOUT_MS = 2500;

async function getJson(url: string, headers: Record<string,string> = {}): Promise<any | null> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { const response = await fetch(url, { headers, signal: controller.signal }); return response.ok ? await response.json() : null; }
  catch { return null; } finally { clearTimeout(timer); }
}
function normalize(value?: string): string {
  return (value || '').toLowerCase().replace(/\b(county|parish|borough|municipality|city|town|village)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function same(a?: string,b?: string): boolean { return !!a && !!b && normalize(a) === normalize(b); }

function extractLocationPhrase(text: string, state?: string): string | null {
  if (!text.trim()) return null;
  if (state) {
    const escaped = state.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp('\\b(?:in|at|within|from|near|of)\\s+([A-Z][A-Za-z.\'’ -]{1,60}),?\\s+' + escaped + '\\b', 'i'),
      new RegExp('\\b([A-Z][A-Za-z.\'’ -]{1,60}\\s+(?:County|Parish|Borough|Township)),?\\s+' + escaped + '\\b', 'i'),
      new RegExp('\\b([A-Z][A-Za-z.\'’ -]{1,60}),\\s*' + escaped + '\\b', 'i'),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match?.[1]) return match[1].trim() + ', ' + state;
    }
  }
  const explicit = /\b(?:in|at|within|from|near|of)\s+([A-Z][A-Za-z.'’ -]{1,60}\s+(?:County|Parish|Borough|Township))(?:,\s*([A-Z][A-Za-z.'’ -]+))?/i.exec(text);
  return explicit ? [explicit[1], explicit[2] || state].filter(Boolean).join(', ') : null;
}

async function geonames(query: string): Promise<Candidate | null> {
  const username = process.env.GEONAMES_USERNAME?.trim(); if (!username) return null;
  const data = await getJson('https://secure.geonames.org/searchJSON?q=' + encodeURIComponent(query) + '&country=US&maxRows=5&featureClass=P&featureClass=A&username=' + encodeURIComponent(username));
  const x = data?.geonames?.[0]; if (!x) return null;
  return { provider:'geonames', locality:x.fcl === 'P' ? x.name : undefined, county:x.adminName2 || undefined, state:x.adminName1 || undefined, country:x.countryName || 'United States', latitude:Number(x.lat), longitude:Number(x.lng) };
}
async function nominatim(query: string): Promise<Candidate | null> {
  const data = await getJson('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=us&limit=3&q=' + encodeURIComponent(query), {'User-Agent':'LegalWhat/1.0 jurisdiction-resolver'});
  const x=data?.[0], a=x?.address; if(!x||!a) return null;
  return { provider:'nominatim', locality:a.city||a.town||a.village||a.municipality||a.hamlet, county:a.county, state:a.state, country:a.country, latitude:Number(x.lat), longitude:Number(x.lon) };
}
async function arcgis(query: string): Promise<Candidate | null> {
  const data=await getJson('https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&countryCode=USA&maxLocations=3&outFields=City,Subregion,Region,Country&singleLine=' + encodeURIComponent(query));
  const x=data?.candidates?.[0], a=x?.attributes; if(!x) return null;
  return { provider:'arcgis', locality:a?.City, county:a?.Subregion, state:a?.Region, country:a?.Country||'USA', latitude:x.location?.y, longitude:x.location?.x };
}
async function census(candidate: Candidate): Promise<Candidate | null> {
  if (!Number.isFinite(candidate.longitude) || !Number.isFinite(candidate.latitude)) return null;
  const data=await getJson('https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=' + candidate.longitude + '&y=' + candidate.latitude + '&benchmark=Public_AR_Current&vintage=Current_Current&format=json');
  const g=data?.result?.geographies; if(!g) return null;
  const county=g.Counties?.[0]?.NAME;
  const place=(g['Incorporated Places']?.[0] || g['Census Designated Places']?.[0])?.NAME;
  const state=g.States?.[0]?.NAME;
  if(!county && !place && !state) return null;
  return {provider:'census',locality:place,county,state,country:'United States',latitude:candidate.latitude,longitude:candidate.longitude};
}

export async function resolveUSJurisdiction(text:string, fallbackState?:string):Promise<ResolvedJurisdiction|null>{
  const query=extractLocationPhrase(text,fallbackState);
  if(!query) return fallbackState ? {display:fallbackState,state:fallbackState,country:'United States',providers:['existing-state-detector']} : null;

  const base=(await Promise.all([geonames(query),nominatim(query),arcgis(query)])).filter(Boolean) as Candidate[];
  if(!base.length) return fallbackState ? {display:fallbackState,state:fallbackState,country:'United States',providers:['existing-state-detector']} : null;

  const censusChecks=(await Promise.all(base.map(census))).filter(Boolean) as Candidate[];
  const candidates=[...base,...censusChecks];
  const agreed=base.filter(c=>base.some(o=>o!==c && same(c.state,o.state) && (same(c.locality,o.locality) || same(c.county,o.county))));
  const censusConfirmed=base.filter(c=>censusChecks.some(o=>same(c.state,o.state) && (same(c.locality,o.locality) || same(c.county,o.county))));
  const verified=[...new Set([...agreed,...censusConfirmed])];

  if(!verified.length) {
    return fallbackState ? {display:fallbackState,state:fallbackState,country:'United States',providers:['existing-state-detector']} : null;
  }

  const best=verified[0];
  const locality=candidates.map(c=>c.locality).find(v=>v && verified.filter(c=>same(c.locality,v)).length>=2) || best.locality;
  const county=candidates.map(c=>c.county).find(v=>v && candidates.filter(c=>same(c.county,v)).length>=2) || best.county;
  const state=candidates.map(c=>c.state).find(v=>v && candidates.filter(c=>same(c.state,v)).length>=2) || best.state || fallbackState;
  const display=[locality,county,state].filter((v,i,a)=>v && a.findIndex(x=>same(x as string,v as string))===i).join(', ');
  return {display:display||state||query,locality,county,state,country:'United States',latitude:best.latitude,longitude:best.longitude,providers:[...new Set(candidates.map(c=>c.provider))]};
}
