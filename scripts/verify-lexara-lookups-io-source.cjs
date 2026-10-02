const fs = require('fs');

const registry = fs.readFileSync('server/lexara/LexaraPublicSourceRegistry.ts', 'utf8');
const mesh = fs.readFileSync('server/lexara/LegalProviderMesh.ts', 'utf8');

for (const token of [
  "id:'lookups-io'",
  "root:'https://lookups.io/'",
  "authority:'discovery'",
  "lookupMode:'discovery'",
  "'identity'",
  "'contacts-addresses'",
  "'relationships'",
  "'social-online'",
]) {
  if (!registry.includes(token)) throw new Error('Lookups.io registry invariant missing: ' + token);
}

if (!registry.includes("source.lookupMode !== 'discovery'")) {
  throw new Error('Discovery sources must not replace official source-specific queries');
}
if (!registry.includes("source.lookupMode === 'discovery'")) {
  throw new Error('Lookups.io discovery query is not being generated');
}
if (!registry.includes("slice(0, 6)")) {
  throw new Error('Discovery query must remain additive to the existing five-query plan');
}
if (!mesh.includes(".filter(source => source.authority !== 'discovery')")) {
  throw new Error('Discovery sources must not be ranked as preferred official evidence');
}
if (!mesh.includes("const uniqueVariants=[...new Set(variants)].slice(0,6);")) {
  throw new Error('Lexara discovery mesh is not accepting the additive Lookups.io query');
}

for (const preserved of [
  "tavily(",
  "duckDuckGoInstantAnswer(",
  "searxng(",
  "ddgs(",
  "openserp(",
  "serpApi(",
  "scrapingBee(",
]) {
  if (!mesh.includes(preserved)) throw new Error('Existing search lane missing: ' + preserved);
}

console.log('Lexara Lookups.io additive discovery integration verification passed.');
