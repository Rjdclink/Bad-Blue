const fs=require('fs');
const p='server/services/pantheon/PantheonSovereignSourceRegistry.ts';
const s=fs.readFileSync(p,'utf8');
const required=['PANTHEON_BACKGROUND_CATEGORIES','buildPantheonCategoryTargets','buildPantheonBackgroundRegistryTargets','limit = 300'];
for(const token of required){if(!s.includes(token)){console.error('missing '+token);process.exit(1);}}
const people=fs.readFileSync('server/peopleSearch.ts','utf8');
if(!people.includes('buildPantheonBackgroundRegistryTargets')){console.error('registry not wired');process.exit(1);}
console.log('Pantheon sovereign source registry wiring verified');
