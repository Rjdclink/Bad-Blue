const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('client/src/lib/lexaraVoiceTurnAdmission.ts', 'utf8');
const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const context = { exports: {}, module: { exports: {} } };
vm.runInNewContext(transpiled.outputText, context);
const accepts = context.exports.isDirectedLexaraVoiceTurn;
assert.equal(typeof accepts, 'function');
const cases = [
  ['Lexara stop',true],['Hey Lexara, hold on',true],['Lex era, I need to add something',true],
  ['LegalWhat, what about the motion?',true],['What statute applies?',true],
  ['Can you check the court filing?',true],['Actually the filing date was October 12',true],
  ['Can they do that?',true],['What about that?',true],
  ['Wait',false],['Stop',false],['No',false],['Okay',false],
  ['Yeah I am on the phone',false],['What are you doing tonight?',false],
  ['Tell her I will call back',false],['I told you already',false],
  ['Can you hear me?',false],['How was your day?',false],
];
for(const [speech, expected] of cases){
  assert.equal(accepts(speech,{busy:true,priorQuestion:'Check court filing and deadline'}),expected,`busy direction: ${speech}`);
}
assert.equal(accepts('Tell her I will call back',{busy:false}),true,'idle conversation unchanged');
assert.equal(accepts('Yes',{busy:false}),true,'brief reply to Lexara preserved when idle');
assert.equal(accepts('stop',{busy:false}),true,'idle voice controls unchanged');
assert.equal(accepts('',{busy:true}),false);
assert.equal(accepts('Actually the address is wrong',{busy:true,priorQuestion:'How can I help you?'}),false,
  'unrelated background corrections cannot cancel a nonlegal request');
// Integration contracts: only microphone input is classified, typed entry remains
// free-form; interim recognition cannot interrupt research or TTS.
const component = fs.readFileSync('client/src/components/LexaraConversation.tsx', 'utf8');
const realtime = fs.readFileSync('server/lexara/LexaraRealtimeVoiceGateway.ts', 'utf8');
assert(component.includes('isDirectedLexaraVoiceTurn(observed, { busy: busyVoiceTurn, priorQuestion })'));
assert(component.includes('isDirectedLexaraVoiceTurn(text, { busy, priorQuestion })'));
assert(component.includes('&& directedAtLexara'));
assert(component.indexOf('isDirectedLexaraVoiceTurn(observed') < component.indexOf('if (meta.bargeInProbe)'));
assert(component.includes('const FLUX_FINAL_SETTLE_MS = 1_200;'));
assert(component.includes('const FLUX_CONFIRMED_FINAL_SETTLE_MS = 650;'));
assert(component.includes('meta.endOfTurnConfidence >= 0.9'));
assert(component.includes("const handleUserMessage = useCallback(async (rawMessage: string) => {"));
assert(realtime.includes("process.env.LEXARA_FLUX_EOT_TIMEOUT_MS?.trim() || '3500'"));
console.log('PASS Lexara directed voice: ambient interruptions gated, typed and uncertain speech unchanged, high-confidence turns accelerated');
