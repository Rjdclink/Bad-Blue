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

// Exercise the actual browser-side numeric parsers. Missing, blank, or
// non-finite provider fields must not generate fictitious 0,0 map evidence.
const spectraPage = read('client/src/pages/spectra.tsx');
const previewNumberFunction = spectraPage.match(
  /function finitePreviewNumber\(value: unknown\): number \| null \{[\s\S]*?\n\}/,
)?.[0];
assert.ok(previewNumberFunction, 'SPECTRA preview parser is missing');
const preview = execute(previewNumberFunction + '\nglobalThis.parseNumber = finitePreviewNumber;').parseNumber;
assert.equal(preview(null), null);
assert.equal(preview(undefined), null);
assert.equal(preview('  '), null);
assert.equal(preview('bad'), null);
assert.equal(preview('Infinity'), null);
assert.equal(preview('0'), 0, 'zero remains a valid coordinate');
assert.equal(preview('-90'), -90);

const mapPage = read('client/src/components/geoconsole/MapLibreIntelligenceMap.tsx');
const optionalNumberFunction = mapPage.match(
  /function finiteOptionalNumber\(value: unknown\): number \| null \{[\s\S]*?\n\}/,
)?.[0];
assert.ok(optionalNumberFunction, 'SPECTRA accuracy parser is missing');
const accuracy = execute(optionalNumberFunction + '\nglobalThis.parseNumber = finiteOptionalNumber;').parseNumber;
assert.equal(accuracy(null), null, 'no reported accuracy is not zero meters');
assert.equal(accuracy(''), null);
assert.equal(accuracy('bad'), null);
assert.equal(accuracy('40.5'), 40.5);
assert(spectraPage.includes('Math.abs(latitude) <= 90') &&
  spectraPage.includes('Math.abs(longitude) <= 180'),
  'regional previews must reject out-of-bounds coordinates');

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

// React may defer appendMessage's state updater. The current command must
// still be present in the launch payload on the first conversation turn.
const launchStart = conversation.indexOf('// Hidden location commands', handlerStart);
const launchEnd = conversation.indexOf('const generation = generationRef.current + 1;', launchStart);
assert(launchStart >= 0 && launchEnd > launchStart);
const launchCode = conversation.slice(launchStart, launchEnd);
const command = 'Show me Jane Mary Doe. Her email is jane@example.test.';
const launchFixture = (history, queuedId) => execute(`
  const conversationRef = { current: ${JSON.stringify(history)} };
  const currentPreRenderedTurnIdRef = { current: ${JSON.stringify(queuedId)} };
  const sessionIdRef = { current: 'fixture-session' };
  const generationRef = { current: 0 };
  const liveEnabled = false, voiceReady = false;
  const setUserInput = () => {}, setErrorMessage = () => {};
  globalThis.messages = [];
  const appendMessage = (role, content, spectraLaunch) => {
    globalThis.messages.push({ role, content, spectraLaunch });
    return 'deferred-' + globalThis.messages.length;
  };
  function launch() {
    const spectraTarget = 'Jane Mary Doe';
    const message = ${JSON.stringify(command)};
    ${launchCode}
  }
  launch();
`);
const fresh = launchFixture([], null);
assert.equal(fresh.messages.at(-1).spectraLaunch.clues, command,
  'a fresh hidden launch must include its current command before React updates the history');
const queued = launchFixture([
  { id: 'older', role: 'user', content: 'Prior identity clue' },
  { id: 'queued', role: 'user', content: command },
], 'queued');
assert.equal(queued.messages.length, 1, 'a queued user turn must not be rendered twice');
assert.equal(queued.messages[0].spectraLaunch.clues, `Prior identity clue\n${command}`,
  'queued launch context must include its current command exactly once');

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

// Run the actual live watcher with a deliberately slow persistence endpoint.
// A second device fix must render immediately and wait for the canonical ID.
const liveStart = runtime.indexOf('useEffect(() => {', runtime.indexOf('// LIVE mode - add new frames'));
const liveEnd = runtime.indexOf('// Server push channel', liveStart);
assert(liveStart >= 0 && liveEnd > liveStart);
const helpers = runtime.slice(runtime.indexOf('const haversineDistance ='),
  runtime.indexOf('// The server endpoint is the sole Futurecast authority.'));
const flush = () => new Promise(resolve => setImmediate(resolve));
function liveFixture(sessionId = null) {
  const pending = [], requests = [], created = [];
  const state = { frames: [], error: null, telemetryError: null, sessionId, cleared: false };
  let fix, failure, cleanup, nextId = 0;
  const context = vm.createContext({
    Date, AbortController, setTimeout, clearTimeout,
    isLive: true, cfg: { autoFetch: true, maxFrameBuffer: 100 },
    ONE_HOUR_MS: 3600000, generateId: () => `fix-${++nextId}`,
    framesRef: { current: [] }, sessionIdRef: { current: sessionId },
    subjectLabelRef: { current: 'Test subject' },
    onSessionCreatedRef: { current: id => created.push(id) },
    liveFuturecastLastRequestRef: { current: Date.now() },
    liveFuturecastRequestRef: { current: async () => {} },
    setFrames: frames => { state.frames = frames; },
    setCurrentIndex: () => {}, setStatus: () => {}, setVersion: () => {},
    setError: value => { state.error = value; },
    setTelemetryError: value => { state.telemetryError = value; },
    setSessionId: value => { state.sessionId = value; },
    useEffect: callback => { cleanup = callback(); },
    navigator: { geolocation: {
      watchPosition: (success, error) => { fix = success; failure = error; return 7; },
      clearWatch: id => { assert.equal(id, 7); state.cleared = true; },
    } },
    fetch: (url, init) => {
      assert.equal(url, '/api/geoconsole/telemetry-ingest');
      requests.push({ body: JSON.parse(init.body), signal: init.signal });
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
  });
  vm.runInContext(ts.transpileModule(`${helpers}\n${runtime.slice(liveStart, liveEnd)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return { state, requests, created, pending, cleanup,
    fix: seconds => fix({ timestamp: Date.now() + seconds * 1000,
      coords: { latitude: 40, longitude: -100 + seconds * 0.00001, accuracy: 4,
        altitude: null, altitudeAccuracy: null, speed: null, heading: null } }),
    failure: () => failure({ message: 'late failure' }),
    reply: (index, saved = true) => pending[index].resolve({ ok: true,
      json: async () => ({ success: true, data: {
        sessionId: 'canonical-session', persistence: { available: saved },
      } }),
    }),
  };
}

async function verifyLivePublication() {
  const live = liveFixture();
  live.fix(0);
  live.fix(1);
  assert.equal(live.state.frames.length, 2, 'saving must not block live rendering');
  assert.equal(live.state.frames[0].confidence, 0.75, 'preserve confidence ceiling');
  assert.equal(live.state.frames[0].position.accuracy, 4, 'preserve provider accuracy');
  await flush();
  assert.equal(live.requests.length, 1, 'rapid initial fixes must not create concurrent sessions');
  assert.equal(live.requests[0].body.subjectLabel, 'Test subject');
  live.reply(0);
  await flush();
  assert.equal(live.requests.length, 2);
  assert.equal(live.requests[1].body.sessionId, 'canonical-session');
  assert.deepEqual(live.created, ['canonical-session']);
  live.reply(1, false);
  await flush();
  assert.match(live.state.telemetryError, /saving is unavailable/);
  live.fix(2);
  assert.match(live.state.telemetryError, /saving is unavailable/,
    'a fresh local fix must not conceal failed persistence');
  await flush();
  live.reply(2);
  await flush();
  assert.equal(live.state.telemetryError, null, 'successful saving clears the persistence warning');
  live.cleanup();

  const interrupted = liveFixture();
  interrupted.fix(0);
  interrupted.fix(1);
  await flush();
  interrupted.cleanup();
  assert.equal(interrupted.requests[0].signal.aborted, true);
  interrupted.reply(0);
  await flush();
  interrupted.fix(2);
  interrupted.failure();
  assert.equal(interrupted.requests.length, 1, 'cleanup stops queued publication');
  assert.equal(interrupted.state.frames.length, 2, 'cleanup ignores late device callbacks');
  assert.equal(interrupted.state.error, null);
  assert.deepEqual(interrupted.created, [], 'cleanup prevents late session adoption');

  const failed = liveFixture('existing-session');
  failed.fix(0);
  await flush();
  assert.equal(failed.requests[0].body.sessionId, 'existing-session');
  failed.pending[0].reject(new Error('network unavailable'));
  await flush();
  assert.equal(failed.state.frames.length, 1);
  assert.match(failed.state.telemetryError, /could not be saved/);
  failed.fix(1);
  await flush();
  failed.reply(1);
  await flush();
  assert.equal(failed.state.sessionId, 'existing-session', 'preserve an existing investigation');
  assert.equal(failed.state.telemetryError, null);
  failed.cleanup();
}

verifyLivePublication().then(() => {
  console.log('Spectra client controls passed: both commands, clue parsing, immediate launch, Futurecast gaps, live persistence ordering, failure recovery, cleanup.');
}).catch(error => { console.error(error); process.exitCode = 1; });
