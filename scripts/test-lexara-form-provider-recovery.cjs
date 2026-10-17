// Search adapter regressions for Lexara official-form discovery; no external HTTP.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
const oldFetch=global.fetch,oldEnv={...process.env};
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lexara-form-search-'));
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json'},
});
(async()=>{
  const mesh=fs.readFileSync(path.join(root,'server/lexara/LegalProviderMesh.ts'),'utf8');
  const extra=[
    'export {ddgs,openserp};',
    'export function resetFixture(){engineCooldownUntil.clear();laneFailures.clear();laneInFlight.clear();laneQueued.clear();}',
  ].join('\n');
  await esbuild.build({
    stdin:{contents:mesh+extra,resolveDir:path.join(root,'server/lexara'),loader:'ts'},
    outfile:path.join(temp,'mesh.cjs'),bundle:true,platform:'node',format:'cjs',
    plugins:[{name:'search-learning-fixtures',setup(build){
      build.onResolve({filter:/\/Lexara(PublicSourceRegistry|DiscoveryLearning|ResearchAssist)$/},
        args=>({path:args.path,namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:[
        'buildLexaraSourceQueries','getLexaraPublicSources','getLexaraSourceQueryHints',
        'getLexaraLearnedQueryPatterns','getLexaraLearnedSources','rankLexaraDiscoveryUrls',
        'planLexaraResearchQueries',
      ].map(name=>'export const '+name+'=()=>[];').join('\n')}));
    }}],
  });
  const d=require(path.join(temp,'mesh.cjs'));
  process.env.LEXARA_EMBEDDED_SEARCH='true';
  process.env.LEXARA_DDGS_BACKEND='yahoo';
  delete process.env.LEXARA_DDGS_FALLBACK_BACKENDS;
  delete process.env.LEXARA_OPENSERP_ENGINES;

  d.resetFixture();
  const attempts=[];
  global.fetch=async(_url,init)=>{
    const backend=JSON.parse(init.body).backend;
    attempts.push(backend);
    if(backend==='google')return json({detail:'Upstream unavailable'},500);
    return json({results:[{href:'https://www.iowacourts.gov/forms/301.pdf'}]});
  };
  let result=await d.ddgs('Iowa court form',undefined,true);
  assert(result.some(row=>row.url.endsWith('301.pdf')));
  assert(attempts.includes('google') && attempts.includes('yahoo'));
  assert(attempts.every(backend=>!backend.includes(',')));
  console.log('PASS DDGS preserves a successful independent engine despite another failing');

  d.resetFixture();
  const normal=[];
  global.fetch=async(_url,init)=>{
    const backend=JSON.parse(init.body).backend;
    normal.push(backend);
    if(backend==='yahoo')return json({results:[{href:'https://example.gov/answer.pdf'}]});
    return json({detail:'Blocked upstream'},500);
  };
  result=await d.ddgs('ordinary legal fact',undefined,false);
  assert(result.some(row=>row.url.endsWith('answer.pdf')));
  assert(normal.length>1 && normal.every(backend=>!backend.includes(',')));
  console.log('PASS ordinary DDGS retains results and does not bundle upstream engines');

  d.resetFixture();
  const fallback=[];
  global.fetch=async(_url,init)=>{
    const backend=JSON.parse(init.body).backend;
    fallback.push(backend);
    if(backend==='google'||backend==='yahoo')return json({detail:'Unavailable'},500);
    if(backend==='mojeek')return json({results:[{href:'https://courts.ca.gov/documents/verified.pdf'}]});
    return json({results:[]});
  };
  result=await d.ddgs('court forms',undefined,true);
  assert(result.some(row=>row.url.endsWith('verified.pdf')));
  assert(fallback.includes('mojeek'));
  console.log('PASS DDGS alternative remains usable after two engine outages');

  d.resetFixture();
  const opens=[];
  global.fetch=async raw=>{
    const u=new URL(String(raw));
    opens.push({mode:u.searchParams.get('mode'),engines:u.searchParams.get('engines')});
    if(opens.length===1)return json({error:'Blocked search engine'},502);
    return json({results:[{url:'https://www.iowacourts.gov/files/form.pdf'}],meta:{engines_failed:[]}});
  };
  result=await d.openserp('Iowa court form',undefined,true);
  assert.equal(opens.length,2);
  assert.equal(opens[0].mode,'fast');
  assert.equal(opens[1].mode,'any');
  assert.match(opens[1].engines,/baidu|yandex/);
  assert(result.some(row=>row.url.endsWith('form.pdf')));
  console.log('PASS OpenSerp switches to alternative engines after HTTP 502');

  d.resetFixture();
  let partialAttempts=0;
  global.fetch=async()=>{
    partialAttempts++;
    if(partialAttempts===1) return json({results:[],meta:{engines_failed:['google']}});
    return json({results:[{url:'https://www.iowacourts.gov/documents/recovered.pdf'}],
      meta:{engines_failed:[]}});
  };
  result=await d.openserp('court forms',undefined,true);
  assert.equal(partialAttempts,2);
  assert(result.some(row=>row.url.endsWith('recovered.pdf')));
  console.log('PASS OpenSerp switches engines after HTTP 200 with only failed-engine results');

  d.resetFixture();
  let successfulCalls=0;
  global.fetch=async()=>{
    successfulCalls++;
    return json({results:[{url:'https://www.iowacourts.gov/documents/partial.pdf'}],
      meta:{engines_failed:['google']}});
  };
  result=await d.openserp('court forms',undefined,true);
  assert.equal(successfulCalls,1);
  assert(result.some(row=>row.url.endsWith('partial.pdf')));
  console.log('PASS OpenSerp retains partial success without repeating search');

  d.resetFixture();
  let count=0;
  global.fetch=async()=>{count++;return json({error:'Unavailable'},502)};
  result=await d.openserp('court forms',undefined,true);
  assert.equal(result.length,0);
  assert.equal(count,2,'only the bounded original and backup attempt are permitted');
  console.log('PASS sustained OpenSerp outage stops without unbounded retries');
  console.log('LEXARA court form provider recovery verified');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{
  global.fetch=oldFetch;
  for(const name of Object.keys(process.env))if(!(name in oldEnv))delete process.env[name];
  Object.assign(process.env,oldEnv);
  fs.rmSync(temp,{recursive:true,force:true});
});
