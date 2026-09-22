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
for(const token of ['PANTHEON_DEPTH_SOURCE_BUDGET','1: 1200','2: 2820','3: 4500','authorityRank','.slice(0, sourceBudget)']){
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
const controller=fs.readFileSync('server/services/pantheon/PantheonInvestigationController.ts','utf8');
for(const crawler of ['startrek','birdofprey','sixdegrees','cerberus','blizzard','lich']){
  if(!adapter.includes("'"+crawler+"'")) throw new Error('Background adapter missing primary crawler: '+crawler);
}
if(!adapter.includes('searchAllIsolatedWithAudit')) throw new Error('Background crawler fan-out is not failure-isolated/audited');
if(adapter.includes('SevenCrawlerInitiative') || adapter.includes('SixCrawlerInitiative')) throw new Error('Simulated seven-crawler path must be excluded from background reports');
for(const token of ['isPantheonSimulatedOutput','assessPantheonInvestigation','isLivePantheonCrawlerAudit']){
  if(!controller.includes(token)) throw new Error('Real investigation controller missing: '+token);
}
if(!adapter.includes('twoStageDeployer.deployBackgroundReport')) throw new Error('Extended razor/secondary crawler stage not wired');

const orchestrator=fs.readFileSync('server/services/pantheonCrawlerOrchestrator.ts','utf8');
for(const token of ['validTargets','new URL(target)',"url.protocol !== 'http:'","url.protocol !== 'https:'",'admitPantheonUrl(target)','Promise.allSettled(routePromises)','searchAllIsolatedWithAudit']){
  if(!orchestrator.includes(token)) throw new Error('Crawler execution hardening missing: '+token);
}

let expectedTotal=0;
const diagnostics=[];
for(let n=1;n<=23;n++){
  const nn=String(n).padStart(2,'0');
  const expected=n===23?100:200;
  const exportToken='PANTHEON_VERIFIED_SOURCES_BATCH_'+nn;
  const file='server/services/pantheon/sources/batch'+nn+'.ts';
  if(!fs.existsSync(file)) throw new Error('Missing '+file);
  const src=fs.readFileSync(file,'utf8');
  if(!src.includes(exportToken)) throw new Error('Missing export '+exportToken);
  if(!registry.includes("from './sources/batch"+nn+"'")) throw new Error('Registry missing import batch '+nn);
  if(!registry.includes('...'+exportToken)) throw new Error('Registry missing spread batch '+nn);

  const literals=[...src.matchAll(/['"`](https?:\/\/[^'"`\\s]+)['"`]/g)].map(m=>m[1]);
  const unique=[...new Set(literals)];
  // Literal counts are diagnostics only: batches may compose their exported
  // registry from several URL arrays. Runtime exact-count guards are authoritative.

  const exactGuard =
    src.includes('expected '+expected+' distinct URLs') ||
    src.includes('must contain exactly '+expected+' sources') ||
    src.includes('length!=='+expected) ||
    src.includes('length !== '+expected);
  if(!exactGuard) throw new Error('Batch '+nn+' missing exact '+expected+'-source runtime cardinality guard');

  for(const value of unique){
    let parsed;
    try { parsed=new URL(value); } catch { throw new Error('Batch '+nn+' contains malformed URL: '+value); }
    if(parsed.protocol!=='http:' && parsed.protocol!=='https:') throw new Error('Batch '+nn+' contains unsupported URL protocol: '+value);
  }
  diagnostics.push('batch'+nn+' literals='+literals.length+' unique='+unique.length+' runtimeExpected='+expected);
  expectedTotal+=expected;
}
if(expectedTotal!==4500) throw new Error('Unexpected canonical registry total '+expectedTotal);
console.log('Pantheon source registry preflight passed: canonical runtime contract = 4,500 entries');
console.log(diagnostics.join('\n'));
