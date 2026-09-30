const fs=require('fs');
const registry=fs.readFileSync('server/services/pantheon/PantheonSovereignSourceRegistry.ts','utf8');
const people=fs.readFileSync('server/peopleSearch.ts','utf8');
const spectra=fs.readFileSync('server/services/spectra/SpectraSourceRegistry.ts','utf8');
const investigation=fs.readFileSync('server/lexara/LexaraPantheonInvestigation.ts','utf8');
const discovery=fs.readFileSync('server/services/pantheon/PantheonDiscoveryCoordinator.ts','utf8');
const authority=fs.readFileSync('server/lexara/LexaraAuthorityResearch.ts','utf8');
const legalMesh=fs.readFileSync('server/lexara/LegalProviderMesh.ts','utf8');
for(const forbidden of ['PANTHEON_VERIFIED_SOURCE_INVENTORY','PANTHEON_EXECUTABLE_SOURCE_INVENTORY','PANTHEON_DEPTH_SOURCE_BUDGET','4500','4,500','batch01','batch23']){
  if([registry,people,spectra,investigation,discovery,authority,legalMesh].some(source=>source.includes(forbidden))) throw new Error('Legacy Pantheon registry token remains: '+forbidden);
}
for(const required of ['buildPantheonCategoryTargets','buildPantheonBackgroundRegistryTargets','perCategory=10','KEYLESS_CATEGORY_SOURCES']){
  if(!registry.includes(required)) throw new Error('Missing dynamic-seed registry token: '+required);
}
for(const required of ["'business': [","'corporate': [","'securities': [","https://www.sec.gov/edgar/search/","SEC EDGAR Company Filings"]){
  if(!registry.includes(required)) throw new Error('Missing keyless SEC EDGAR integration token: '+required);
}
if(!people.includes('buildPantheonBackgroundRegistryTargets(name, location, 10)')) throw new Error('People search is not using ten category seeds');
for(const required of ['SEARXNG_URL','DDGS_URL','OPENSERP_URL','GEMINI_API_KEY','GoogleGenAI',"'gemini-google'","'commoncrawl'","'learned'"]){
  if(!discovery.includes(required)) throw new Error('Dynamic search mesh missing provider: '+required);
}
for(const forbidden of ['orchestratedWebSearch','supplementalPantheonDiscovery']){
  if(discovery.includes(forbidden)) throw new Error('Removed shared discovery transport remains: '+forbidden);
}
for(const required of ['pantheonSourceFamily','familyCounts','count >= 2']){
  if(!discovery.includes(required)) throw new Error('Pantheon source-family diversity guard missing: '+required);
}
if(!investigation.includes("target.transport !== 'search-provider'")){
  throw new Error('Pantheon conversational frontier must exclude search-provider result pages');
}
for(const required of ['searchCourtListener','searchGovInfo','discoverLegalMeshTier3','discoverLegalMeshSupplemental']){
  if(!authority.includes(required)) throw new Error('Lexara legal provider mesh missing route: '+required);
}
for(const forbidden of ['orchestratedWebSearch','FIRECRAWL_API_KEY','api.firecrawl.dev']){
  if(authority.includes(forbidden)) throw new Error('Removed Lexara research route remains: '+forbidden);
}
for(const required of ['tavily','SEARXNG_URL','DDGS_URL','OPENSERP_URL']){
  if(!legalMesh.includes(required)) throw new Error('Lexara direct legal discovery lane missing: '+required);
}
for(const forbidden of ['discoverPantheonSourcesParallel','PantheonDiscoveryCoordinator','LexaraBackgroundResearchBoundary']){
  if(legalMesh.includes(forbidden)) throw new Error('Lexara legal mesh still depends on Pantheon: '+forbidden);
}
const searchFirst=fs.readFileSync('server/services/pantheon/PantheonSearchFirstDiscovery.ts','utf8');
const categoryWorkflow=fs.readFileSync('server/services/pantheon/PantheonCategoryWorkflow.ts','utf8');
for(const required of ['discoverPantheonSearchFirstCandidates','discoverPantheonCategoryGapCandidates','CATEGORY_DISCOVERY_HINTS','includePaidFallback: true','categoryIndexes','discoveryLanes','discoverPantheonSourcesParallel']){
  if(!searchFirst.includes(required)) throw new Error('Pantheon search-first discovery missing invariant: '+required);
}
for(const required of ['search_first_candidates_ready','searchFirstCandidates','discoverPantheonCategoryGapCandidates','combinedFreshLedger']){
  if(!categoryWorkflow.includes(required)) throw new Error('Pantheon category workflow is not consuming search-first discovery before registry standby: '+required);
}
if(!legalMesh.includes("tier: 3 as const") || !legalMesh.includes("tier: 5 as const")){
  throw new Error('Lexara direct legal discovery tiers are incomplete');
}
console.log('Pantheon registry remains intact while Lexara legal discovery is independently wired.');

