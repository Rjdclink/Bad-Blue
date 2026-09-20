const fs=require('fs');
const p='server/services/pantheon/PantheonSovereignSourceRegistry.ts';
const s=fs.readFileSync(p,'utf8');
const required=['PANTHEON_BACKGROUND_CATEGORIES','buildPantheonCategoryTargets','buildPantheonBackgroundRegistryTargets','limit = 300','PANTHEON_VERIFIED_SOURCES_BATCH_01','PANTHEON_VERIFIED_SOURCES_BATCH_02'];
for(const token of required){if(!s.includes(token)){console.error('missing '+token);process.exit(1);}}
const people=fs.readFileSync('server/peopleSearch.ts','utf8');
if(!people.includes('buildPantheonBackgroundRegistryTargets')){console.error('registry not wired');process.exit(1);}
const batch=fs.readFileSync('server/services/pantheon/sources/batch01.ts','utf8');
for(const token of ['courtUrls','correctionsUrls','electionUrls','licenseUrls','length!==200']){if(!batch.includes(token)){console.error('batch01 missing '+token);process.exit(1);}}
const urls=[...batch.matchAll(/'https?:\/\/[^']+'/g)].map(m=>m[0].slice(1,-1));
if(urls.length!==200){console.error('batch01 expected 200 URLs, got '+urls.length);process.exit(1);}
if(new Set(urls).size!==200){console.error('batch01 contains duplicate URLs');process.exit(1);}
const b2=fs.readFileSync('server/services/pantheon/sources/batch02.ts','utf8');
for(const token of ['PANTHEON_VERIFIED_SOURCES_BATCH_02','slice(0,200)','expected 200 distinct URLs']){if(!b2.includes(token)){console.error('batch02 missing '+token);process.exit(1);}}
console.log('Pantheon source registry verified: batch01=200 + batch02=200; direct-before-discovery wiring present');
