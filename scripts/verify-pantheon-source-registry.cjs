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
if(!people.includes('buildPantheonBackgroundRegistryTargets(name, location, 10)')) throw new Error('People search is not using ten category seeds');
for(const required of ['SEARXNG_URL','DDGS_URL','OPENSERP_URL','GEMINI_API_KEY','GoogleGenAI',"'gemini-google'","'commoncrawl'","'first-party'","'learned'","'serpapi'","'scrapingbee'"]){
  if(!discovery.includes(required)) throw new Error('Dynamic search mesh missing provider: '+required);
}
for(const required of ['searchCourtListener','searchGovInfo','discoverLegalMeshTier3','discoverLegalMeshSupplemental','Firecrawl','OpenRouter']){
  if(!authority.includes(required)) throw new Error('Lexara legal provider mesh missing route: '+required);
}
if(!legalMesh.includes('tavily') || !legalMesh.includes('discoverPantheonSourcesParallel')) throw new Error('Lexara legal mesh is not connected to Tavily + dynamic discovery');
const searchFirst=fs.readFileSync('server/services/pantheon/PantheonSearchFirstDiscovery.ts','utf8');
const categoryWorkflow=fs.readFileSync('server/services/pantheon/PantheonCategoryWorkflow.ts','utf8');
for(const required of ['discoverPantheonSearchFirstCandidates','categoryIndexes','discoverPantheonSourcesParallel']){
  if(!searchFirst.includes(required)) throw new Error('Pantheon search-first discovery missing invariant: '+required);
}
for(const required of ['search_first_candidates_ready','searchFirstCandidates','combinedFreshLedger']){
  if(!categoryWorkflow.includes(required)) throw new Error('Pantheon category workflow is not consuming search-first discovery before registry standby: '+required);
}
if(!legalMesh.includes('gemini-google-grounding') || !legalMesh.includes("tier: 3 as const")){
  throw new Error('Lexara Tier 3 does not preserve Gemini Google grounding as a parallel legal discovery provider');
}
console.log('Pantheon legacy 4,500-source registry removal verified; dynamic search/index mesh and Lexara legal provider mesh remain exclusively wired.');
