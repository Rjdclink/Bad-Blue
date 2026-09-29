const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server/services/pantheon/PantheonResearchAssist.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ jenova = true, groq = true, failJenova = false, failGroq = false } = {}) {
  const calls = [];
  const env = { ANTHROPIC_API_KEY: 'fixture' };
  if (jenova) env.JENOVA_API_KEY = 'fixture';
  if (groq) env.GROQ_API_KEY = 'fixture';
  const module = { exports: {} };
  const agentAnswer = '"Jane Doe" Iowa public court records\n"Jane Doe" Iowa professional licenses';
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('event: stream_delta\ndata: '+ JSON.stringify({chunk_content:agentAnswer}) +'\n\n'));
    controller.close();
  }});
  const stubs = {
    '../../claude': { callClaude: async () => { calls.push('claude'); return {content:'"Jane Doe" Iowa state archives\n"Jane Doe" Iowa county records'}; } },
    '../../groq': { getGroqClient: () => ({chat:{completions:{create: async request => {
      calls.push('groq:' + request.model);
      if (failGroq) throw new Error('429 quota');
      return {choices:[{message:{content:'"Jane Doe" Iowa government registry\n"Jane Doe" Iowa legal notices'}}]};
    }}}}) },
    '../../aiHarmonyModelRegistry': { LEGAL_AI_MODELS: {claudeFast:'claude-sonnet-5'} },
  };
  const fetch = async url => {
    calls.push(url);
    if (failJenova) return {ok:false,status:403};
    if (String(url).endsWith('/agents')) return {ok:true,json: async()=>({agents:[{agent:'professional-background-investigator',display_name:'Professional Background Investigator'}]})};
    return {ok:true,body:stream};
  };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
    process:{env},fetch,console:{warn(){}},AbortController,TextDecoder,Date,setTimeout,clearTimeout,
  })(spec => stubs[spec] || assert.fail('Unexpected import '+spec),module,module.exports);
  return {plan:module.exports.planPantheonResearchQueries,calls};
}
(async()=>{
  const query='Jane Doe in Iowa public background';
  const primary=fixture();
  const result=await primary.plan(query);
  assert.deepEqual(Array.from(result.assistants),['jenova','groq']);
  assert.equal(result.queries.length,3);
  assert(!primary.calls.includes('claude'));
  assert(primary.calls.some(item=>String(item).endsWith('/agents')));
  assert(primary.calls.some(item=>String(item).endsWith('/messages')));
  const fallback=fixture({failJenova:true,failGroq:true});
  const recovered=await fallback.plan(query);
  assert.deepEqual(Array.from(recovered.assistants),['claude']);
  assert(fallback.calls.includes('claude'));
  const independent=fixture({jenova:false,groq:false});
  assert.deepEqual(Array.from((await independent.plan(query)).assistants),['claude']);
  const coordinator=fs.readFileSync(path.join(root,'server/services/pantheon/PantheonDiscoveryCoordinator.ts'),'utf8');
  assert(coordinator.indexOf('const settled = await Promise.all') < coordinator.indexOf('planPantheonResearchQueries(query,'));
  assert(coordinator.includes("options.providerPolicy !== 'legalwhat'"));
  assert(coordinator.includes('if (freeUrls.length)'));
  console.log('Pantheon research assistants: 4 regression checks passed (provider I/O mocked).');
})().catch(error=>{console.error(error);process.exitCode=1});
