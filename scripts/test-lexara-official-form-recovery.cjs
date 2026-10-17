// Court-form-only integration regressions: no live accounts, filing, or network.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,dependencies={}){
  const mod={exports:{}};
  const output=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText;
  new Function('require','module','exports','URL','Buffer',output)(
    key=>Object.hasOwn(dependencies,key)?dependencies[key]:{},mod,mod.exports,URL,Buffer);
  return mod.exports;
}
const resolver=load('server/lexara/OfficialLegalFormResolver.ts');
const formRequest=load('server/lexara/OfficialFormRequest.ts');
const registry=load('server/lexara/legalDocumentRegistry.ts');
const courtUrl='https://www.iowacourts.gov/browse/files/ee62a2a865014fb8970229de42630bde/download';
const nativeSource={
  kind:'primary',title:'Application to Modify Child Support Only Form 301',
  url:courtUrl,excerpt:'Iowa child support filing application',
};
const fallbackSource={
  kind:'primary',title:'Request for Review and Modification of Child Support',
  url:'https://hhs.iowa.gov/forms/review.pdf',excerpt:'Iowa official agency child support modification',
};
function reply(){
  let status=200,body=null;
  return {status(value){status=value;return this},json(value){body=value;return this},
    read(){return {status,body}}};
}
async function run({facts='USER: Please find the Iowa child support modification form.',
  documentType='Custom Document', formSourceUrls=[],nativeSources=[],claudeSources=[],failUrls=[]}={}){
  let nativeCalls=0,claudeCalls=0;
  const inspected=[];
  const routes=new Map();
  const module=load('server/routes/consultation.routes.ts',{
    '../auth':{isAuthenticated(){}},
    '../errorHandler':{asyncHandler:fn=>fn},
    '../legalAI':{},
    '../aiProvider':{generateLegalAnalysis:async()=>''},
    '../lexara/LexaraAuthorityResearch':{
      researchLegalAuthority:async()=>{nativeCalls++;return {
        searchedAt:'2026-10-17',sources:nativeSources,
      }},
      formatAuthorityResearchForSystem:()=>'',discoverClaudeOfficialFormLeads:async()=>{
        claudeCalls++;return claudeSources;
      },
    },
    '../lexara/LexaraJurisdictionResolver':{
      resolveUSJurisdiction:async()=>({state:'Iowa',display:'Iowa',county:'Clay'}),
    },
    '../lexara/LexaraJurisdictionAuthority':{
      resolveJurisdictionAuthorityProfile:async()=>({
        stateName:'Iowa',stateCode:'IA',system:'state',
        officialResources:[
          {kind:'forms',host:'iowacourts.gov',title:'Iowa judicial forms'},
          {kind:'forms',host:'hhs.iowa.gov',title:'Iowa agency forms'},
        ],needsCourtClarification:false,
      }),
      formatJurisdictionAuthorityForSystem:()=>'',},
    '../lexara/LexaraCitationVerifier':{},
    '../lexara/OfficialLegalFormResolver':resolver,
    '../lexara/OfficialFormRequest':formRequest,
    '../lexara/RecordReliefWorkflow':{isRecordReliefRequest:()=>false,
      recordReliefTopic:()=>false},
    '../lexara/RecordReliefDocument':{},
    '../lexara/RecordReliefSources':{},
    '../lexara/OfficialFormFiller':{
      inspectOfficialForm:async form=>{
        inspected.push(form.url);
        if(failUrls.includes(form.url))throw Error('Court server unavailable');
        return {sourceUrl:form.url,contentType:'pdf',fillable:true,fields:[],bytes:Buffer.from('%PDF')};
      },
    },
    '../lexara/FlatOfficialFormOverlay':{},
    '../lexara/FlatFormLayoutDetector':{},
    '../lexara/legalDocumentRegistry':registry,
    '../logger':{createLogger:()=>({warn(){},info(){},error(){}})},
  });
  module.setupConsultationRoutes({
    get(){},post:(url,...handlers)=>routes.set(url,handlers.at(-1)),
  });
  const response=reply();
  await routes.get('/api/lexara/documents/generate')({body:{
    state:'Iowa',documentType,facts,formSourceUrls,
  }},response);
  return {...response.read(),nativeCalls,claudeCalls,inspected};
}
(async()=>{
  let response=await run({formSourceUrls:[courtUrl]});
  assert.equal(response.status,409);
  assert.equal(response.body.officialForm.url,courtUrl);
  assert.equal(response.nativeCalls,0,'previous verified original bypasses redundant search');
  assert.equal(response.claudeCalls,0);
  assert.deepEqual(response.inspected,[courtUrl]);
  console.log('PASS prior Lexara court link is inspected and reused without searching again');

  response=await run({facts:'USER: Grab it for me.',documentType:'Iowa child support modification form',
    formSourceUrls:[courtUrl]});
  assert.equal(response.status,409);
  assert.equal(response.body.officialForm.url,courtUrl);
  assert.equal(response.nativeCalls,0);
  console.log('PASS short follow-up keeps the earlier official form identity and URL');

  response=await run({formSourceUrls:['https://untrusted.example.org/motion.pdf'],
    nativeSources:[nativeSource]});
  assert.equal(response.status,409);
  assert.equal(response.body.officialForm.url,courtUrl);
  assert.equal(response.nativeCalls,1);
  assert.equal(response.claudeCalls,0);
  console.log('PASS untrusted URL is rejected; native official document is retrieved');

  response=await run({nativeSources:[
    {kind:'secondary',url:'https://example.org/explanation',title:'Explaining child support'},
  ],claudeSources:[nativeSource]});
  assert.equal(response.status,409);
  assert.equal(response.nativeCalls,1);
  assert.equal(response.claudeCalls,1);
  assert.equal(response.body.officialForm.url,courtUrl);
  console.log('PASS Claude source discovery activates when primary engines lack a usable form');

  response=await run({nativeSources:[nativeSource],
    claudeSources:[fallbackSource],failUrls:[courtUrl]});
  assert.equal(response.status,409);
  assert.equal(response.body.officialForm.url,fallbackSource.url);
  assert.equal(response.claudeCalls,1);
  console.log('PASS inaccessible official result triggers Claude alternate-source retrieval');

  response=await run({nativeSources:[nativeSource]});
  assert.equal(response.status,409);
  assert.equal(response.claudeCalls,0);
  console.log('PASS usable native form never spends Claude backup search');

  response=await run({nativeSources:[],claudeSources:[
    {kind:'primary',title:'Minnesota Child Support Modification Form',
      url:'https://www.mncourts.gov/download.pdf'},
  ]});
  assert.equal(response.status,422);
  assert.equal(response.claudeCalls,1);
  assert(response.inspected.every(url=>!url.includes('mncourts')));
  console.log('PASS other-state Claude suggestion rejected without downloading');

  const source=fs.readFileSync(path.join(root,'client/src/components/LexaraConversation.tsx'),'utf8');
  assert(source.includes('formSourceUrls: pendingDocument.formSourceUrls'));
  assert(source.includes('String(data?.response ||'));
  const mesh=fs.readFileSync(path.join(root,'server/lexara/LegalProviderMesh.ts'),'utf8');
  assert(mesh.includes('officialFormQuery ? 6_500'));
  assert(mesh.includes('officialFormQuery ? 10_000'));
  assert(mesh.includes('officialFormQuery ? 4_000'));
  const chat=fs.readFileSync(path.join(root,'server/routes/lexara.chat.routes.ts'),'utf8');
  const start=chat.indexOf('function detectDocumentIntent');
  const end=chat.indexOf('function selectPacketDocumentIntent',start);
  assert(start>=0 && end>start);
  const intentCode=ts.transpileModule(chat.slice(start,end),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  const detectIntent=new Function('isLexaraOfficialFormDeliveryRequest',
    'lexaraRequestedOfficialFormTitle','isLexaraDocumentIntakeQuestion',
    'resolveLegalDocumentType','inferLegalDocumentNeed','isBlankLegalDocumentRequest',
    intentCode+'\\nreturn detectDocumentIntent;')(
      formRequest.isLexaraOfficialFormDeliveryRequest,
      formRequest.lexaraRequestedOfficialFormTitle,
      ()=>false,()=>null,()=>null,()=>false,
    );
  const previous=[
    {role:'user',content:'Please get me the Iowa child support modification form.'},
    {role:'lexara',content:'Here is [Form 301]('+courtUrl+').'},
  ];
  const followup=detectIntent('Grab it for me',previous);
  assert.equal(followup.requested,true);
  assert.equal(followup.officialFormDelivery,true);
  assert.match(followup.documentType,/child support/i);
  console.log('PASS Markdown form link plus grab-it follow-up reaches document retrieval');
  console.log('PASS retained source URLs and form-specific search budgets are wired');
})().catch(error=>{console.error(error);process.exitCode=1});
