const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../client/src/lib/lexaraRealtimeVoiceClient.ts'), 'utf8');
function harness() {
  const timers = new Map(); let timerId = 0; const sent = []; const audio = []; const exports = {};
  const context = { exports, require: () => ({}), navigator: { userAgent: 'fixture', sendBeacon() {} },
    Blob, performance, WebSocket: { OPEN: 1, CLOSING: 2 },
    window: { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id) },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const client = exports.lexaraRealtimeVoiceClient;
  client.ready = true; client.speechOutputReady = true;
  client.socket = { readyState: 1, send: value => sent.push(JSON.parse(value)), close() {} };
  client.context = { sampleRate: 24000, state: 'running' };
  client.playback = { port: { postMessage: message => audio.push(message) }, disconnect() {} };
  return { client, sent, audio, timers };
}
test('interrupt drops in-flight PCM and prevents a late acknowledgement ending the next reply', async () => {
  const { client, sent, audio } = harness();
  const first = client.speak('first reply', 'one'); client.renderedFrames = 24000;
  client.interrupt(); const count = audio.length;
  client.handleAudio(new ArrayBuffer(20)); assert.equal(audio.length, count);
  await assert.rejects(client.speak('second reply', 'two'), /interruption is still pending/);
  assert.equal(client.activeSpeech.turnId, 'one');
  assert.equal(sent.filter(x => x.type === 'tts_speak').length, 1);
  assert.equal(sent.find(x => x.type === 'tts_interrupt').playbackOffsetMs, 1000);
  client.handleControlMessage({ type: 'tts_control', payload: { type: 'SpeechInterrupted', audio_played_ms: 1000 } });
  await first;
  const second = client.speak('second reply', 'two');
  assert.equal(client.activeSpeech.turnId, 'two'); client.close(); await second;
});
test('missing interruption acknowledgement is bounded and leaves server fallback available', async () => {
  const { client, timers } = harness();
  const first = client.speak('reply', 'one'); const rejected = assert.rejects(first, /acknowledgement timed out/);
  client.interrupt(); const timer = [...timers.values()].find(t => t.ms === 1500); assert(timer); timer.fn();
  await rejected; assert.equal(client.activeSpeech, null); assert.equal(client.speechOutputReady, false);
});
test('connection close settles the interrupted promise', async () => {
  const { client } = harness(); const first = client.speak('reply', 'one'); client.interrupt(); client.close();
  await first; assert.equal(client.activeSpeech, null); assert.equal(client.interruptInFlight, false);
});
test('completed turns contribute to the session-wide interruption offset', async () => {
  const { client, sent } = harness();
  const first = client.speak('reply', 'one'); client.renderedFrames = 48000;
  client.activeSpeech.metadataComplete = true; client.activeSpeech.playbackDrained = true;
  client.maybeResolveSpeech(client.activeSpeech); await first;
  const second = client.speak('next reply', 'two'); client.renderedFrames = 24000; client.interrupt();
  assert.equal(sent.find(x => x.type === 'tts_interrupt').playbackOffsetMs, 3000); client.close(); await second;
});
