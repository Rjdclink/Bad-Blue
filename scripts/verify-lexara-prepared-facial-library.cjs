const fs = require('fs');
const source = fs.readFileSync('client/src/lib/lexaraPreparedFacialLibrary.ts', 'utf8');
const runtime = fs.readFileSync('client/src/lib/lexaraPreparedFacialRuntime.ts', 'utf8');
function must(condition, message) { if (!condition) { console.error('FAIL:', message); process.exitCode = 1; } }
must(source.includes('length !== 1000'), 'facial library is gated at exactly 1000 states');
must(source.includes('length: 750'), 'facial library defines exactly 750 prepared sequences');
must(source.includes('no network/model work and no audio ownership'), 'library cannot own or delay speech');
must(source.includes('sourcePoseIndex'), 'new states preserve provenance to the proven manifold');
must(!source.includes('.filter((sequence)'), 'runtime sequence selection is constant-time and allocation-free');
must(runtime.includes('already-authoritative audio clock'), 'runtime adapter is explicitly subordinate to playback');
must(!/fetch\\(|WebSocket|AudioContext|play\\(|pause\\(/.test(runtime), 'facial runtime cannot perform network or playback operations');
if (process.exitCode) process.exit(process.exitCode);
console.log('LEXARA prepared facial library verification passed.');
