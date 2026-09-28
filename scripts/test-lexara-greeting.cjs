const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../client/src/components/LexaraConversation.tsx'), 'utf8');
const start = source.indexOf('const sendGreeting = useCallback');
const end = source.indexOf('\n\n  useEffect', start);
function harness(speak) {
  const messages = [];
  const c = { useCallback: f => f, historyReady: true, liveEnabled: true, voiceReady: true,
    greetingRef: { current: false }, greetingDisplayedRef: { current: false },
    userSpeechObservedRef: { current: false }, generationRef: { current: 1 },
    responseEmotionRef: { current: '' }, appendMessage: (...a) => messages.push(a), speakLexara: speak };
  vm.createContext(c);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.send = sendGreeting;', c);
  return { c, messages };
}
test('failed greeting retries on recovered voice without duplicate chat text', async () => {
  let calls = 0; const { c, messages } = harness(async () => ++calls > 1);
  await c.send(); assert.equal(c.greetingRef.current, false);
  await c.send(); await c.send();
  assert.equal(calls, 2); assert.equal(messages.length, 1); assert.equal(c.greetingRef.current, true);
});
test('overlapping readiness effects reserve only one greeting', async () => {
  let done; let calls = 0; const { c } = harness(() => { calls++; return new Promise(r => done = r); });
  const first = c.send(); await c.send(); assert.equal(calls, 1); done(true); await first;
});
test('user speech prevents retry after a pre-playback failure', async () => {
  let calls = 0; const { c } = harness(async () => { calls++; return false; });
  await c.send(); c.userSpeechObservedRef.current = true; await c.send(); assert.equal(calls, 1);
});
test('old greeting completion cannot reset a newer session reservation', async () => {
  let done; const { c } = harness(() => new Promise(r => done = r));
  const first = c.send(); c.generationRef.current++; c.greetingRef.current = true;
  done(false); await first; assert.equal(c.greetingRef.current, true);
});
test('history restoration and unavailable voice defer greeting', async () => {
  let calls = 0; const { c } = harness(async () => { calls++; return true; });
  c.historyReady = false; await c.send(); c.historyReady = true; c.voiceReady = false; await c.send();
  assert.equal(calls, 0); assert.equal(c.greetingRef.current, false);
});
