// Tests the decoder/checker itself with local audio files, not a TTS provider.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {test,after}=require('node:test');
const {execFileSync}=require('node:child_process');
const {validateAudio}=require('./verify-lexara-tts-live.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lexara-audio-validator-'));
after(()=>fs.rmSync(root,{recursive:true,force:true}));
function generate(name,filter,codec){
 const dest=path.join(root,name);
 execFileSync('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i',filter,'-t','1','-c:a',codec,dest]);
 return fs.readFileSync(dest);
}
const wav=generate('tone.wav','sine=frequency=440:sample_rate=24000','pcm_s16le');
const mp3=generate('tone.mp3','sine=frequency=440:sample_rate=24000','libmp3lame');
const silence=generate('silent.wav','anullsrc=r=24000:cl=mono','pcm_s16le');
const dc=generate('dc.wav','aevalsrc=0.1:s=24000','pcm_s16le');
function check(bytes,mimeType,expectedFormat){ const outputDir=fs.mkdtempSync(path.join(root,'check-'));return validateAudio({bytes,mimeType,expectedFormat,outputDir}); }
test('real WAV and MP3 files decode to positive duration and signal',()=>{
 for(const [bytes,mime,format] of [[wav,'audio/wav','wav'],[mp3,'audio/mpeg','mp3']]){
  const result=check(bytes,mime,format);assert.equal(result.passed,true);assert.ok(result.durationSeconds>=0.9);assert.ok(result.activeSeconds>=0.2);
 }
});
test('zero bytes, JSON and HTML cannot pass as audio',()=>{
 for(const bytes of [Buffer.alloc(0),Buffer.from('{"error":"quota"}'),Buffer.from('<html>Error</html>')]) assert.equal(check(bytes,'audio/mpeg','mp3').passed,false);
});
test('an audio MIME type and fake MP3 signature do not bypass decoding',()=>{
 const result=check(Buffer.from('ID3-not-an-audio-stream'),'audio/mpeg','mp3');assert.equal(result.checks.signature,true);assert.equal(result.checks.decoded,false);assert.equal(result.passed,false);
});
test('a correct WAV with a wrong declared format is rejected',()=>{
 assert.equal(check(wav,'audio/mpeg','wav').passed,false);assert.equal(check(wav,'audio/mpeg','mp3').passed,false);
});
test('digital silence is not functional TTS',()=>{
 const result=check(silence,'audio/wav','wav');assert.equal(result.checks.decoded,true);assert.equal(result.checks.nonSilent,false);assert.equal(result.passed,false);
});
test('nonzero constant samples are not meaningful audio',()=>{
 const result=check(dc,'audio/wav','wav');assert.ok(result.peak>0);assert.equal(result.checks.nonSilent,false);assert.equal(result.passed,false);
});
