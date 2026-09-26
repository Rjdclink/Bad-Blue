const fs=require('fs');
const registry=fs.readFileSync('server/services/pantheon/PantheonAdvancedRetrievalRegistry.ts','utf8');
const escalation=fs.readFileSync('server/services/pantheon/PantheonRetrievalEscalation.ts','utf8');
for(const token of ['CAPSOLVER_API_KEY','CAPMONSTER_API_KEY','SADCAPTCHA_API_KEY','BOTRIGHT_SERVICE_URL','SCRAPLING_SERVICE_URL','SPYDRA_SERVICE_URL']) {
  if(!registry.includes(token)) throw new Error('Advanced retrieval registry missing '+token);
}
for(const token of ["'advanced-browser'","'authorized-challenge-workflow'","lanes: ['browser-render', 'advanced-browser', 'structured-extraction']","lanes: ['authorized-challenge-workflow', 'stop']"]) {
  if(!escalation.includes(token)) throw new Error('Advanced retrieval escalation missing '+token);
}
console.log('Pantheon advanced retrieval capability verification passed.');
