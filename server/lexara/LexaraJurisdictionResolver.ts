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
function extractLocationPhrase(text: string, state?: string): string | null {
  if (state) {
    const escapedState = state.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    const withState = new RegExp('\\b([A-Z][A-Za-z.\'’ -]{1,60}),?\\s+' + escapedState + '\\b', 'i').exec(text);
    if (withState) return withState[1].trim() + ', ' + state;
  }
  const county = /\b([A-Z][A-Za-z.'’ -]{1,60}\s+County)(?:,\s*([A-Z][A-Za-z.'’ -]+))?/i.exec(text);
  if (county) return [county[1], county[2] || state].filter(Boolean).join(', ');
  return null;
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
function same(a?:string,b?:string){return !!a&&!!b&&a.toLowerCase().replace(/\s+county$/,'')===b.toLowerCase().replace(/\s+county$/,'');}
export async function resolveUSJurisdiction(text:string, fallbackState?:string):Promise<ResolvedJurisdiction|null>{
  const query=extractLocationPhrase(text,fallbackState);
  if(!query) return fallbackState ? {display:fallbackState,state:fallbackState,country:'United States',providers:['existing-state-detector']} : null;
  const candidates=(await Promise.all([geonames(query),nominatim(query),arcgis(query)])).filter(Boolean) as Candidate[];
  if(!candidates.length) return fallbackState ? {display:fallbackState,state:fallbackState,country:'United States',providers:['existing-state-detector']} : null;
  const best=candidates.find(c=>candidates.some(o=>o!==c&&same(c.locality,o.locality)&&same(c.state,o.state))) || candidates[0];
  const county=candidates.map(c=>c.county).find(v=>v&&candidates.filter(c=>same(c.county,v)).length>=2) || best.county;
  const state=candidates.map(c=>c.state).find(v=>v&&candidates.filter(c=>same(c.state,v)).length>=2) || best.state || fallbackState;
  const locality=best.locality;
  const display=[locality,county,state].filter((v,i,a)=>v&&a.findIndex(x=>same(x as string,v as string))===i).join(', ');
  return {display:display||state||query,locality,county,state,country:best.country||'United States',latitude:best.latitude,longitude:best.longitude,providers:candidates.map(c=>c.provider)};
}
