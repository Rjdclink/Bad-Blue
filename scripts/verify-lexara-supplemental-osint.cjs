const fs=require('fs');
const supplement=fs.readFileSync('server/lexara/LexaraSupplementalOsintSources.ts','utf8');
const boundary=fs.readFileSync('server/lexara/LexaraBackgroundResearchBoundary.ts','utf8');
const registry=fs.readFileSync('server/services/pantheon/PantheonSovereignSourceRegistry.ts','utf8');

for(const token of [
  'LEXARA_EAGLE_EYE_KEYLESS_SOURCES',
  'LEXARA_MAX_INTEL_QUERY_HINTS',
  'getLexaraSupplementalQueryHints',
  'getLexaraSupplementalSources',
  'https://www.sec.gov/edgar/search/',
  'https://geocoding.geo.census.gov/geocoder/',
  'https://echo.epa.gov/',
  'https://www.fema.gov/api/open/',
  'https://vpic.nhtsa.dot.gov/api/',
]) if(!supplement.includes(token)) throw new Error('Supplemental OSINT invariant missing: '+token);

for(const forbidden of [
  'https://api.census.gov/data/',
  'https://nominatim.openstreetmap.org/',
]) if(supplement.includes(forbidden)) throw new Error('Restricted/keyed source must not enter keyless fanout: '+forbidden);

if(!boundary.includes('getLexaraSupplementalQueryHints') || !boundary.includes('getLexaraSupplementalSources')) {
  throw new Error('Lexara background boundary does not expose supplemental source planning');
}
if(!registry.includes('getLexaraSupplementalSources([category])') || !registry.includes('getLexaraSupplementalQueryHints([category])')) {
  throw new Error('Supplemental source planning is not wired into category target generation');
}
if(!registry.includes('...(KEYLESS_CATEGORY_SOURCES[category] || []), ...supplementalSources')) {
  throw new Error('Supplemental sources replace rather than extend existing source inventory');
}
console.log('Lexara Eagle Eye + Max Intel supplemental integration verification passed.');
