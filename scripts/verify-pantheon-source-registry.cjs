const fs=require('fs');
const registry=fs.readFileSync('server/services/pantheon/PantheonSovereignSourceRegistry.ts','utf8');
const people=fs.readFileSync('server/peopleSearch.ts','utf8');
for(const forbidden of ['PANTHEON_VERIFIED_SOURCE_INVENTORY','PANTHEON_EXECUTABLE_SOURCE_INVENTORY','PANTHEON_DEPTH_SOURCE_BUDGET','4500','4,500','batch01','batch23']){
  if(registry.includes(forbidden)||people.includes(forbidden)) throw new Error('Legacy Pantheon registry token remains: '+forbidden);
}
for(const required of ['buildPantheonCategoryTargets','buildPantheonBackgroundRegistryTargets','perCategory=10','KEYLESS_CATEGORY_SOURCES']){
  if(!registry.includes(required)) throw new Error('Missing dynamic-seed registry token: '+required);
}
if(!people.includes('buildPantheonBackgroundRegistryTargets(name, location, 10)')) throw new Error('People search is not using ten category seeds');
console.log('Pantheon legacy 4,500-source registry removal verified; dynamic ten-seed/category handoff remains wired.');
