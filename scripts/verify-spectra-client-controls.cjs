const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const execute = source => {
  const scope = vm.createContext({});
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInContext(compiled, scope);
  return scope;
};

// Execute the actual client parser, including its exclusions, without mounting
// unrelated legal/voice services or issuing a paid model request.
const conversation = read('client/src/components/LexaraConversation.tsx');
const exclusions = conversation.match(/const NON_PERSON_SPECTRA_TARGET_RE = .*?;\n/)[0];
const parser = conversation.match(/function spectraTargetFromPrompt\(value: string\): string \| null \{[\s\S]*?\n\}/)[0];
const commands = execute(`${exclusions}\n${parser}`);
for (const phrase of ['Show me', 'Where is', "Where's"]) {
  assert.equal(commands.spectraTargetFromPrompt(`${phrase} Jane Mary Doe?`), 'Jane Mary Doe');
  assert.equal(commands.spectraTargetFromPrompt(
    `${phrase} Jane Mary Doe. Her email is jane@example.test and her phone is 555-010-0200.`,
  ), 'Jane Mary Doe');
}
for (const phrase of ['Show me the document', 'Where is the filing deadline?',
  'Where is my court date?', 'Where is the hearing?', 'Explain this motion', 'Show me the map']) {
  assert.equal(commands.spectraTargetFromPrompt(phrase), null);
}
const handlerStart = conversation.indexOf('const handleUserMessage');
assert(conversation.indexOf('// Hidden location commands', handlerStart)
  < conversation.indexOf("fetch('/api/lexara/chat/stream'", handlerStart));

const route = read('server/routes/spectra.routes.ts');
const nameParser = route.match(/function extractLikelyName\(value: string\): string \| null \{[\s\S]*?\n\}/)[0];
const names = execute(`const extractPhoneNumber = () => null;
  const extractCityStateHint = () => null;\n${nameParser}`);
assert.equal(names.extractLikelyName(
  'Jane Mary Doe. Her email is jane@example.test and her phone is 555-010-0200.',
), 'Jane Mary Doe');
assert.equal(names.extractLikelyName('Jane Mary Doe'), 'Jane Mary Doe');

// A gap must never be bridged when preparing observations for Futurecast.
const runtime = read('client/src/hooks/useGeoRuntime.ts');
const tailSource = runtime.slice(runtime.indexOf('const continuousTail ='),
  runtime.indexOf('const haversineDistance ='));
const { tail } = execute(`${tailSource}\nglobalThis.tail = continuousTail;`);
const frames = [0, 1, 2, 3].map(id => ({ id, metadata: {} }));
assert.deepEqual(Array.from(tail(frames, 2), frame => frame.id), [2, 3]);
frames[2].metadata.gapBeforeSeconds = 300;
assert.deepEqual(Array.from(tail(frames, 20), frame => frame.id), [2, 3]);
frames[3].metadata.gapBeforeSeconds = 60;
assert.deepEqual(Array.from(tail(frames, 20), frame => frame.id), [3]);
assert.equal(tail([], 20).length, 0);

console.log('Spectra client controls passed: both commands, clue parsing, legal exclusions, immediate launch, Futurecast gap boundaries.');
