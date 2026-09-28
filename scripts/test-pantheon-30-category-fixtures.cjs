const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');
const express = require('express');

const root = path.resolve(__dirname, '..');
const routesPath = path.join(root, 'server/routes/lexara.chat.routes.ts');
const labels = [
  'Identity & Identity Verification',
  'Phone Numbers',
  'Email Addresses',
  'Current Address',
  'Address History',
  'Relatives & Family',
  'Associates & Household Connections',
  'Social-Media Profiles',
  'Usernames & Online Accounts',
  'Photos & Public Images',
  'Employment History',
  'Education',
  'Professional Licenses & Credentials',
  'Business Ownership & Affiliations',
  'Property & Real Estate',
  'Vehicles & Transportation Records',
  'Court Records',
  'Criminal Records',
  'Arrest & Police Records',
  'Incarceration & Corrections',
  'Probation & Parole Information',
  'Warrants & Wanted-Person Records',
  'Sex-Offender Registries',
  'Civil Litigation & Judgments',
  'Bankruptcies, Liens & Financial Public Records',
  'Marriage, Divorce & Vital-Record Information',
  'News & Media Mentions',
  'Internet & Web Footprint',
  'Government, Political & Public-Service Records',
  'Relationship & Timeline Intelligence',
];

// Natural-language expressions vary the intent vocabulary rather than repeating
// the canonical report labels. The stable public fixture subject is synthetic.
const categoryCases = [
  ['Which other names are publicly tied to Morgan Avery Example?', 'aliases / identifiers'],
  ['What telephone number is publicly listed for Morgan Avery Example?', 'telephone'],
  ['What electronic-mail contact is listed for Morgan Avery Example?', 'email'],
  ['Where does Morgan Avery Example live now?', 'present residence'],
  ['Where did Morgan Avery Example live before the current home?', 'former residence'],
  ['Which family members or relatives are known for Morgan Avery Example?', 'family relationship'],
  ['Who has shared a home or household with Morgan Avery Example?', 'household connections'],
  ['What public Facebook or LinkedIn pages belong to Morgan Avery Example?', 'social-media pages'],
  ['Which screen names or pseudonyms does Morgan Avery Example use online?', 'usernames'],
  ['Are any publicly published pictures or portraits of Morgan Avery Example available?', 'public images'],
  ['What jobs has Morgan Avery Example held, and for whom?', 'employment'],
  ['Which schools did Morgan Avery Example attend, and what did Morgan Avery Example study?', 'education'],
  ['Does Morgan Avery Example hold a professional qualification or certification?', 'professional credentials'],
  ['What business interests and directorships are associated with Morgan Avery Example?', 'business ownership'],
  ['What land, houses, parcels, or real estate does Morgan Avery Example own?', 'real estate'],
  ['Are any cars, trucks, or other registered vehicles registered in the name of Morgan Avery Example?', 'vehicles'],
  ['Which court dockets or case filings name Morgan Avery Example?', 'court proceedings'],
  ['What convictions or criminal charges appear for Morgan Avery Example?', 'criminal records'],
  ['Has a police department or sheriff reported an arrest for Morgan Avery Example?', 'arrest events'],
  ['Is Morgan Avery Example currently listed in custody or in a corrections facility?', 'custody status'],
  ['Has Morgan Avery Example been under community supervision after release?', 'probation and parole'],
  ['Is Morgan Avery Example on a public wanted list or subject to an outstanding warrant?', 'warrants'],
  ['Does an official registry list Morgan Avery Example as a registered sex offender?', 'registry entry'],
  ['Has Morgan Avery Example been sued or named in a civil judgment?', 'civil litigation'],
  ['Are bankruptcy filings, tax liens, or other financial public records associated with Morgan Avery Example?', 'financial filings'],
  ['What marriages, divorces, births, or deaths are publicly recorded for Morgan Avery Example?', 'vital records'],
  ['What have newspapers or other media outlets reported about Morgan Avery Example?', 'news reporting'],
  ['What public websites, profiles, or other online references mention Morgan Avery Example?', 'web footprint'],
  ['Has Morgan Avery Example held public office or worked in government?', 'public service'],
  ['What dated events and personal connections can be put into a timeline for Morgan Avery Example?', 'timeline'],
];

const seam = { current: null };
globalThis.__pantheonThirtyCategoryE2E = seam;

function loadBundle(source, filename) {
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(source, filename);
  return loaded.exports;
}

async function bundleEntry(plugin) {
  const result = await esbuild.build({
    entryPoints: [routesPath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false,
    plugins: [plugin],
    logLevel: 'silent',
  });
  return loadBundle(result.outputFiles[0].text, path.join(root, 'scripts/.pantheon-30-category-fixtures.bundle.cjs'));
}

const staticMocks = {
  '../logger': `export function createLogger(){return {info(){},warn(){},error(){}};}`,
  '../../shared/lexaraVoicePersona': `export const LEXARA_PERSONA={name:'Lexara',traits:[]};`,
  '../lexara/personaKernel': `export const LEXARA_KERNEL={identity:{name:'Lexara',age:0,style:''},speech:{}}; export function mergePersonaWithKernel(x){return x;}`,
  '../masterPassword': `export const MASTER_USER_ID='master-fixture';`,
  '../auth': `export function isAuthenticated(req,res,next){req.user={id:'master-fixture',isMasterBypass:true};next();}`,
  '../lexara/legalDocumentRegistry': `export function isBlankLegalDocumentRequest(){return false;} export function resolveLegalDocumentType(){return null;}`,
  '../aiTokenGovernor': `export const UsageContext={USER:'user'};`,
  '../aiModelSelector': `export const TaskComplexity={COMPREHENSIVE:'comprehensive'}; export const TaskPriority={CRITICAL:'critical'};`,
  '../aiHarmonyModelRegistry': `
    export const CURRENT_AI_MODELS={openRouterAuto:'must-not-run'};
    export function getConfiguredHarmonyParticipants(){return [];}
    export function getConfiguredHarmonyProviders(){return [];}
  `,
  '../aiCollaborationOrchestrator': `
    export const AICollaborationOrchestrator={async orchestrateCollaboration(){
      throw new Error('No configured answer provider is allowed in this test');
    }};
  `,
  '../openRouterService': `
    export async function generateOpenRouterText(){
      globalThis.__pantheonThirtyCategoryE2E.current.openRouterCalls += 1;
      throw new Error('OpenRouter is disabled in this test');
    }
  `,
  './LexaraAuthorityResearch': `
    export async function researchLegalAuthority(){return null;}
    export function formatAuthorityResearchForSystem(){return '';}
  `,
  './LexaraLegalDomainProfiles': `
    export function getLexaraLegalDomainProfile(){return null;}
    export function formatLexaraDomainSpecialization(){return '';}
  `,
};

const plugin = {
  name: 'pantheon-30-category-fixture-e2e',
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'express') return null;
      if (args.path === '../lexara/LexaraConversationOrchestrator'
        && args.importer.endsWith('/server/routes/lexara.chat.routes.ts')) {
        return { path: path.join(root, 'server/lexara/LexaraConversationOrchestrator.ts') };
      }
      if (args.path === '../services/crawlers/PantheonRetrievalAdapter') return { path: 'retrieval', namespace: 'pantheon-thirty-fixture' };
      if (args.path === '../services/pantheon/PantheonSovereignSourceRegistry') return { path: 'registry', namespace: 'pantheon-thirty-fixture' };
      if (args.path === '../services/inmateSearch/InmateSearchAggregator') return { path: 'inmates', namespace: 'pantheon-thirty-fixture' };
      if (args.path === '../services/pantheon/PantheonEntityResolution') return { path: 'matcher', namespace: 'pantheon-thirty-fixture' };
      if (args.path === './LexaraCrawlerCapabilityRegistry') return { path: 'assignments', namespace: 'pantheon-thirty-fixture' };
      if (args.path === '../services/pantheon/PantheonCrawlerCapabilityMatrix') return { path: 'crawler-ids', namespace: 'pantheon-thirty-fixture' };
      if (args.path === '../services/pantheon/PantheonDiscoveryCoordinator') return { path: 'discovery', namespace: 'pantheon-thirty-fixture' };
      if (args.path === '../services/pantheon/PantheonDiscoveryLearning') return { path: 'learning', namespace: 'pantheon-thirty-fixture' };
      if (args.path === '../services/crawlers/PublicAcquisitionInfrastructure') return { path: 'acquisition', namespace: 'pantheon-thirty-fixture' };
      if (Object.prototype.hasOwnProperty.call(staticMocks, args.path)) return { path: args.path, namespace: 'static-fixture' };
      return null;
    });
    build.onLoad({ filter: /.*/, namespace: 'pantheon-thirty-fixture' }, args => {
      const source = {
        retrieval: `
          const hash = content => require('node:crypto').createHash('sha256').update(content).digest('hex');
          export const pantheonRetrievalAdapter={async retrieve(request){
            const s=globalThis.__pantheonThirtyCategoryE2E.current;
            const sourceUrl=request.targets[0];
            s.retrievalCalls.push({categoryLabel:request.categoryLabel,targets:[...request.targets],primaryCrawlers:[...(request.primaryCrawlers||[])]});
            const content=s.fixtureContent;
            const retrievedAt='2026-09-27T00:00:00.000Z';
            const contentHash=hash(content);
            const item={
              schemaVersion:'pantheon-source-result-v1',
              evidenceId:hash(sourceUrl+':'+contentHash),
              crawler:'fixture-crawler',
              capabilityId:'fixture-crawler',
              categoryLabel:request.categoryLabel,
              target:sourceUrl,sourceUrl,content,contentHash,confidence:0.98,retrievedAt,
              status:'completed_with_content',
              provenance:{sourceUrl,transport:'direct-http',retrievedAt,durationMs:1,httpStatus:200},
              metadata:{}
            };
            s.crawlerAudit.push({categoryLabel:request.categoryLabel,sourceUrl,status:'completed_with_content'});
            return {
              available:true,evidence:[item],
              crawlerAudit:[{crawler:'fixture-crawler',status:'completed_with_content',attempts:1,evidenceCount:1,sourceOutcomes:[{sourceUrl,status:'completed_with_content'}]}],
              frontierCandidates:{discoveredCandidates:[],sourceNavigationCandidates:[]}
            };
          }};
        `,
        registry: `
          export function buildPantheonCategoryTargets(_category,subject){
            const s=globalThis.__pantheonThirtyCategoryE2E.current;
            return [{url:s.seedUrl,sourceKind:'public_record',authority:'official'}];
          }
          export function buildPantheonBackgroundRegistryTargets(){return [];}
        `,
        inmates: `export async function searchInmates(){return {inmates:[]};}`,
        matcher: `
          export function matchPantheonSubject(item,subject){
            const matched=String(item.content).toLowerCase().includes(String(subject).toLowerCase());
            globalThis.__pantheonThirtyCategoryE2E.current.subjectChecks.push({subject,matched});
            return {matched,score:matched?0.98:0.1,conflicts:[],independentCorrelates:matched?[subject]:[]};
          }
        `,
        assignments: `
          export function buildLexaraDynamicCrawlerAssignments(){
            return [{crawler:{id:'fixture-crawler'},roles:['primary'],matchedCapabilities:['retrieve-source'],priorityScore:1,explorationRequired:true}];
          }
          export function getLexaraCrawlerReadiness(){return [{id:'fixture-crawler',configured:true}];}
        `,
        'crawler-ids': `
          export const PANTHEON_PRIMARY_CRAWLER_IDS=['fixture-crawler'];
          export const PANTHEON_RAZOR_SKILL_IDS=[];
          export const PANTHEON_SECONDARY_CRAWLER_IDS=[];
          export const PANTHEON_PORTABLE_CAPABILITY_IDS=[];
          export const PANTHEON_REPORT_CATEGORY_LABELS=${JSON.stringify(labels)};
        `,
        discovery: `
          export async function discoverPantheonSourcesParallel(_query,_exclude,options){
            const s=globalThis.__pantheonThirtyCategoryE2E.current;
            s.discoveryCalls.push({categories:[...(options.categories||[])],limit:options.limit});
            return {urls:[s.seedUrl],lanesAttempted:['fixture-search-lane','fixture-learned-lane']};
          }
        `,
        learning: `export function rememberPantheonDiscoveryOutcome(){return Promise.resolve();}`,
        acquisition: `export function admitPantheonUrl(value){return {ok:true,url:value};}`,
      }[args.path];
      return { contents: source, loader: 'ts' };
    });
    build.onLoad({ filter: /.*/, namespace: 'static-fixture' }, args => ({
      contents: staticMocks[args.path],
      loader: 'ts',
    }));
  },
};

async function withServer(router, run) {
  const app = express();
  app.use('/api/lexara', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}/api/lexara`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function main() {
  const previous = {
    openRouter: process.env.OPENROUTER_API_KEY,
    firecrawl: process.env.FIRECRAWL_API_KEY,
    consoleLog: console.log,
    consoleInfo: console.info,
    consoleWarn: console.warn,
  };
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  const failures = [];
  try {
    const matrix = await import('../server/services/pantheon/PantheonCrawlerCapabilityMatrix.ts');
    const byLabel = new Map(categoryCases.map(([prompt, meaning], index) => [labels[index], { prompt, meaning }]));
    assert.equal(labels.length, 30);
    assert.equal(categoryCases.length, 30);
    assert.equal(new Set(labels).size, 30);
    assert.deepEqual(labels, matrix.PANTHEON_REPORT_CATEGORY_LABELS);
    assert.equal(process.env.OPENROUTER_API_KEY, undefined);
    assert.equal(process.env.FIRECRAWL_API_KEY, undefined);

    const { default: routerModule } = await bundleEntry(plugin);
    await withServer(routerModule || (await bundleEntry(plugin)), async baseUrl => {
      for (const [index, label] of labels.entries()) {
        const scenario = seam.current = {
          label,
          prompt: byLabel.get(label).prompt,
          meaning: byLabel.get(label).meaning,
          subject: 'Morgan Avery Example',
          seedUrl: `https://records.example.gov/category-${index + 1}`,
          fixtureContent: '',
          retrievalCalls: [],
          discoveryCalls: [],
          crawlerAudit: [],
          subjectChecks: [],
          openRouterCalls: 0,
          firecrawlCalls: 0,
        };
        const schema = matrix.getPantheonCategoryExtractionSchema(label);
        const capabilities = matrix.getPantheonCategoryCapabilities(label);
        const primary = matrix.getPantheonPrimaryCrawlerCapabilitiesForCategory(label);
        const workUnits = matrix.buildPantheonExecutableWorkUnits({
          investigationId: `thirty-category-${index + 1}`,
          categoryLabel: label,
          sourceUrl: scenario.seedUrl,
          transport: 'direct-http',
        });
        if (!schema.objectiveFields.length || !schema.evidenceHints.length || !capabilities.length || !primary.length || !workUnits.length) {
          failures.push(`${index + 1}. ${label}: category schema/capability/work plan is empty`);
          continue;
        }
        if (workUnits.some(unit => unit.categoryLabel !== label || !capabilities.includes(unit.capabilityId))) {
          failures.push(`${index + 1}. ${label}: executable work plan diverges from its category capability matrix`);
        }
        const fields = schema.objectiveFields.map(field => `${field}: fixture-value-${field}`).join('; ');
        scenario.fixtureContent = `Synthetic public fixture identifying Morgan Avery Example (born 1984 in Iowa), category ${label}. ${fields}`;
        const response = await fetch(`${baseUrl}/chat/stream`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: scenario.prompt[0].toLowerCase() + scenario.prompt.slice(1),
            context: {
              jurisdiction: 'Iowa',
              previousMessages: [
                { role: 'user', content: 'The subject is Morgan Avery Example, born in 1984 in Iowa.' },
                { role: 'assistant', content: 'Understood; I will use that context to distinguish the subject.' },
              ],
            },
          }),
        });
        const stream = await response.text();
        let completion;
        for (const eventChunk of stream.split('\n\n')) {
          if (!eventChunk.startsWith('event: complete\n')) continue;
          const data = eventChunk.match(/^data: (.*)$/m);
          if (data) completion = JSON.parse(data[1]);
        }
        const request = scenario.retrievalCalls[0];
        if (response.status !== 200) failures.push(`${index + 1}. ${label}: chat stream HTTP ${response.status}`);
        if (!request) {
          const clarification = String(completion?.response || '').replace(/\s+/g, ' ').slice(0, 180);
          failures.push(`${index + 1}. ${label}: no real Pantheon retrieval attempt from the Lexara route${clarification ? ` (${clarification})` : ''}`);
        }
        else {
          if (request.categoryLabel !== label) failures.push(`${index + 1}. ${label}: routed category ${request.categoryLabel || '(missing)'}`);
          if (!request.targets.includes(scenario.seedUrl)) failures.push(`${index + 1}. ${label}: discovered target was not crawled`);
          if (!request.primaryCrawlers.length) failures.push(`${index + 1}. ${label}: no primary crawler was scheduled`);
          const accepted = scenario.crawlerAudit.some(audit => audit.categoryLabel === label && audit.sourceUrl === scenario.seedUrl);
          if (!accepted) failures.push(`${index + 1}. ${label}: source fetch audit did not match this category and target`);
        }
        if (!completion) failures.push(`${index + 1}. ${label}: no terminal Lexara SSE completion event`);
        else {
          if (completion.pantheonEndpoint !== 'evidence-sufficient') {
            failures.push(`${index + 1}. ${label}: endpoint ${completion.pantheonEndpoint} (crawler attempts ${scenario.retrievalCalls.length}; subject checks ${scenario.subjectChecks.map(check => `${check.subject}:${check.matched}`).join(',') || 'none'})`);
          }
          if (!['completed', 'partial'].includes(completion.pantheonStatus)
            || completion.jobStatus !== completion.pantheonStatus
            || completion.jobCompleted !== (completion.pantheonStatus === 'completed')) {
            failures.push(`${index + 1}. ${label}: inconsistent API status ${completion.pantheonStatus}/${completion.jobStatus}/${completion.jobCompleted}`);
          }
          if (!String(completion.response || '').includes(scenario.seedUrl)
            && !String(completion.response || '').includes('Synthetic public fixture')) {
            failures.push(`${index + 1}. ${label}: answer did not cite or quote source-verified fixture content`);
          }
        }
        if (scenario.openRouterCalls !== 0) failures.push(`${index + 1}. ${label}: attempted OpenRouter while disabled`);
        if (scenario.firecrawlCalls !== 0) failures.push(`${index + 1}. ${label}: attempted Firecrawl while disabled`);
      }
    });
    if (failures.length) {
      console.error(`Pantheon 30-category E2E FAIL (${failures.length} failures):\n${failures.map(value => `- ${value}`).join('\n')}`);
      process.exitCode = 1;
    } else {
      process.stdout.write('Pantheon 30-category E2E passed: schema, capability plan, crawler/source verification, evidence-backed Lexara response, and API status reporting for all categories with OpenRouter/Firecrawl disabled.\n');
    }
  } finally {
    if (previous.openRouter !== undefined) process.env.OPENROUTER_API_KEY = previous.openRouter;
    if (previous.firecrawl !== undefined) process.env.FIRECRAWL_API_KEY = previous.firecrawl;
    console.log = previous.consoleLog;
    console.info = previous.consoleInfo;
    console.warn = previous.consoleWarn;
  }
}

main().then(
  () => process.exit(process.exitCode || 0),
  error => {
    console.error(error);
    process.exit(1);
  },
);