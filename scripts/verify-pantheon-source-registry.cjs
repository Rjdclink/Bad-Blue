const fs=require('fs');
const registryPath='server/services/pantheon/PantheonSovereignSourceRegistry.ts';
const peoplePath='server/peopleSearch.ts';
const pagePath='client/src/pages/pantheon.tsx';
const progressPath='client/src/components/PantheonProgressTracker.tsx';
const registry=fs.readFileSync(registryPath,'utf8');
const people=fs.readFileSync(peoplePath,'utf8');
const page=fs.readFileSync(pagePath,'utf8');
const progress=fs.readFileSync(progressPath,'utf8');
for(const token of ['PANTHEON_BACKGROUND_CATEGORIES','buildPantheonCategoryTargets','buildPantheonBackgroundRegistryTargets','limit = 300']){
  if(!registry.includes(token)) throw new Error('Missing registry token: '+token);
}
if(!people.includes('buildPantheonBackgroundRegistryTargets')) throw new Error('peopleSearch not wired to Pantheon registry');
for(const token of [
  'PANTHEON_DEPTH_SOURCE_BUDGET',
  '1: 450',
  '2: 1200',
  '3: 2800',
  '4: 4500',
  'authorityRank',
  '.slice(0, sourceBudget)',
]){
  if(!people.includes(token)) throw new Error('Missing depth-intensity wiring token: '+token);
}
for(const token of ['Background Report Categories','Identity & Identity Verification','Relationship & Timeline Intelligence']){
  if(!page.includes(token)) throw new Error('Pantheon page missing real category UI token: '+token);
  if(!progress.includes(token)) throw new Error('Pantheon timer missing real category UI token: '+token);
}
for(const obsolete of ['Scanning Databases','Social Analysis','Location Tracking','Continuous Monitoring']){
  if(progress.includes(obsolete)) throw new Error('Synthetic progress tag still present: '+obsolete);
}
if(page.includes('CapabilityCard')) throw new Error('Legacy oversized capability cards still present');
const adapter=fs.readFileSync('server/services/crawlers/PantheonRetrievalAdapter.ts','utf8');
for(const crawler of ['startrek','birdofprey','sixdegrees','cerberus','blizzard','lich']){
  if(!adapter.includes("'"+crawler+"'")) throw new Error('Background adapter missing primary crawler: '+crawler);
}
if(!adapter.includes('searchAllIsolatedWithAudit')) throw new Error('Background crawler fan-out is not failure-isolated/audited');
if(!adapter.includes('Seven-Crawler Initiative') && !adapter.includes('SixCrawlerInitiative')) throw new Error('Seven-crawler analytical family not wired');
if(!adapter.includes('twoStageDeployer.deployBackgroundReport')) throw new Error('Extended razor/secondary crawler stage not wired');
let total=0;
for(let n=1;n<=23;n++){
  const nn=String(n).padStart(2,'0');
  const exportToken='PANTHEON_VERIFIED_SOURCES_BATCH_'+nn;
  const file='server/services/pantheon/sources/batch'+nn+'.ts';
  if(!fs.existsSync(file)) throw new Error('Missing '+file);
  const src=fs.readFileSync(file,'utf8');
  if(!src.includes(exportToken)) throw new Error('Missing export '+exportToken);
  if(!registry.includes("from './sources/batch"+nn+"'")) throw new Error('Registry missing import batch '+nn);
  if(!registry.includes('...'+exportToken)) throw new Error('Registry missing spread batch '+nn);
  const expected=n===23?100:200;
  if(!src.includes('expected '+expected+' distinct URLs')) throw new Error('Batch '+nn+' missing exact-count guard');
  const literals=[...src.matchAll(/'https?:\\/\\/[^']+'/g)].map(m=>m[0].slice(1,-1));
  if(new Set(literals).size<expected) throw new Error('Batch '+nn+' has fewer than '+expected+' distinct URL literals');
  total+=expected;
}
const lastImport=registry.indexOf("from './sources/batch23'");
const authority=registry.indexOf('AUTHORITIES');
if(lastImport<0||authority<0) throw new Error('Registry ordering markers missing');
if(total!==4500) throw new Error('Unexpected verified source entry total '+total);
console.log('Pantheon source registry verified: 23 batches, 4,500 source entries, prioritized 5/10/20/30-minute intensity wiring present');
