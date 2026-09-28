/** Real, single-provider Lexara TTS acceptance. Never supplies synthetic provider responses.
 * Usage: node scripts/verify-lexara-tts-live.cjs --provider deepgram
 *   --expected-voice flux-haley-en --output-dir /secure/test-results/deepgram
 * Existing credentials are read from the environment, never CLI arguments or reports.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');

const SENTENCE = 'I am Lexara. How can I help you with your legal question today?';
const CREDENTIALS = {
  deepgram: ['DEEPGRAM_API_KEY', 'DEEPGRAM'],
  gemini: ['GEMINI_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  groq: ['GROQ_API_KEY'],
  azure: ['AZURE_SPEECH_KEY'],
  xai: ['XAI_API_KEY'],
  elevenlabs: ['ELEVENLABS_API_KEY'],
};
function decode(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message || result.stderr?.slice(0,500) || 'decoding failed'}`);
  return result.stdout;
}
function signature(bytes) {
  if (bytes.length >= 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WAVE') return 'wav';
  if (bytes.length >= 3 && (bytes.toString('ascii',0,3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 6) !== 0))) return 'mp3';
  return 'unknown';
}
function validateAudio({ bytes, mimeType, expectedFormat, outputDir }) {
  const checks = { nonzeroBytes: bytes.length > 0 };
  const mime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const detected = signature(bytes);
  checks.contentType = expectedFormat === 'mp3' ? ['audio/mpeg','audio/mp3'].includes(mime) : ['audio/wav','audio/x-wav','audio/wave','audio/vnd.wave'].includes(mime);
  checks.signature = detected === expectedFormat;
  if (!Object.values(checks).every(Boolean)) return { passed:false, checks, detectedFormat:detected, durationSeconds:null };
  const audioPath = path.join(outputDir, `lexara.${detected}`);
  fs.writeFileSync(audioPath, bytes, {mode:0o600});
  const pcmPath = path.join(outputDir, 'decoded.f32le');
  try {
    const info = JSON.parse(decode('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',audioPath]));
    const stream = info.streams?.find(s=>s.codec_type === 'audio');
    if (!stream) throw new Error('No decodable audio stream');
    checks.decoderFormat = expectedFormat === 'mp3' ? stream.codec_name === 'mp3' : String(info.format?.format_name || '').split(',').includes('wav');
    decode('ffmpeg', ['-nostdin','-v','error','-xerror','-y','-i',audioPath,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_f32le','-f','f32le',pcmPath]);
    const pcm = fs.readFileSync(pcmPath);
    const samples = Math.floor(pcm.length / 4);
    checks.decoded = samples > 0 && pcm.length % 4 === 0;
    const durationSeconds = samples / 16000;
    checks.positiveDuration = durationSeconds > 0;
    let finite = true, peak = 0, sum = 0, sumSquares = 0, activeFrames = 0;
    const frameSamples = 320; // 20 ms at 16 kHz, independent of original sample rate.
    for (let start=0; start<samples; start+=frameSamples) {
      const count = Math.min(frameSamples, samples-start);
      let frameSum = 0, frameSquares = 0;
      for (let i=0;i<count;i++) {
        const value = pcm.readFloatLE((start+i)*4);
        if (!Number.isFinite(value)) { finite=false; continue; }
        peak = Math.max(peak, Math.abs(value)); sum+=value; sumSquares+=value*value;
        frameSum+=value; frameSquares+=value*value;
      }
      // AC energy rejects constant DC-valued buffers as well as digital silence.
      const acRms = Math.sqrt(Math.max(0,frameSquares/count-(frameSum/count)**2));
      if(acRms > 10**(-50/20)) activeFrames++;
    }
    const totalFrames = Math.ceil(samples/frameSamples);
    const activeSeconds = activeFrames*0.02;
    const activeFraction = totalFrames ? activeFrames/totalFrames : 0;
    const acRms = samples ? Math.sqrt(Math.max(0,sumSquares/samples-(sum/samples)**2)) : 0;
    checks.finiteSamples = finite;
    checks.nonSilent = finite && acRms > 10**(-50/20) && activeSeconds >= 0.2 && activeFraction >= 0.05;
    return { passed:Object.values(checks).every(Boolean), checks, detectedFormat:detected,
      codec:stream.codec_name, sourceSampleRate:Number(stream.sample_rate), sourceChannels:stream.channels,
      durationSeconds, decodedSamples:samples, peak, acRms, activeSeconds, activeFraction,
      thresholds:{ frameRmsDbFs:-50, minimumActiveSeconds:0.2, minimumActiveFraction:0.05 } };
  } catch(error) {
    return { passed:false, checks:{...checks,decoded:false}, detectedFormat:detected, durationSeconds:null, error:error.message };
  } finally { fs.rmSync(pcmPath,{force:true}); }
}
async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for(let i=0;i<args.length;i+=2) {
    if(!['--provider','--expected-voice','--expected-format','--output-dir'].includes(args[i]) || !args[i+1]) throw new Error('Use --provider, --expected-voice, optional --expected-format, and --output-dir');
    options[args[i].slice(2)] = args[i+1];
  }
  const provider = options.provider;
  if(!Object.hasOwn(CREDENTIALS,provider)) throw new Error('Select exactly one active TTS provider. OpenRouter is excluded.');
  if(!options['expected-voice']) throw new Error('--expected-voice must be the approved female Lexara voice identifier');
  const expectedFormat = options['expected-format'] || (['groq','gemini'].includes(provider) ? 'wav' : 'mp3');
  if(!['wav','mp3'].includes(expectedFormat)) throw new Error('Lexara currently returns WAV or MP3. Choose that expected output format.');
  const outputDir = path.resolve(options['output-dir'] || fs.mkdtempSync(path.join(os.tmpdir(),'lexara-tts-live-')));
  fs.mkdirSync(outputDir,{recursive:true,mode:0o700});
  const root = path.resolve(__dirname,'..');
  const entry = path.join(root,'server/lexara/LexaraTTSMesh.ts');
  const report = { providerRequested:provider, sentence:SENTENCE, startedAt:new Date().toISOString(),
    sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(entry)).digest('hex'),
    liveProviderRequests:0, requests:[], synthesisRequests:[], provider:null, model:null, voice:null,
    expectedVoice:options['expected-voice'], expectedFormat, byteCount:0, synthesisLatencyMs:null,
    status:'blocked', validation:null, notes:['Automated decode and signal validation; no human listening.',
      'Non-silent audio does not by itself prove spoken wording or subjective voice quality.'] };
  const save = () => { fs.writeFileSync(path.join(outputDir,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600}); console.log(JSON.stringify(report,null,2)); };
  const missing = [];
  if(!CREDENTIALS[provider].some(name=>process.env[name]?.trim())) missing.push(...CREDENTIALS[provider]);
  if(provider==='azure'&&!process.env.AZURE_SPEECH_REGION?.trim()) missing.push('AZURE_SPEECH_REGION');
  if(provider==='elevenlabs'&&!process.env.ELEVENLABS_VOICE_ID?.trim()) missing.push('ELEVENLABS_VOICE_ID');
  if(missing.length) { report.reason='Existing provider credentials/configuration are unavailable to this test process'; report.missingEnvironmentNames=missing; save(); process.exitCode=2; return; }
  for(const tool of ['ffmpeg','ffprobe']) {
    if(spawnSync(tool,['-version'],{stdio:'ignore'}).status !== 0) { report.reason=`Audio decoder unavailable: ${tool}`; save(); process.exitCode=2; return; }
  }
  const originalEnv = {...process.env};
  const originalFetch = globalThis.fetch;
  const secrets = Object.entries(originalEnv).filter(([name])=>/(?:KEY|TOKEN|PASSWORD|SECRET)$/.test(name)).map(([,value])=>value).filter(v=>v&&v.length>5);
  const redact = message => { let value=String(message); for(const secret of secrets) value=value.split(secret).join('[REDACTED]'); return value.replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').slice(0,1000); };
  let mesh;
  try {
    // Process-local isolation only. No production variables or source branches change.
    for(const [other,names] of Object.entries(CREDENTIALS)) if(other!==provider) for(const name of names) delete process.env[name];
    delete process.env.OPENROUTER_API_KEY;
    process.env.NODE_ENV='test';
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input==='string'?input:input.url || String(input));
      const started=performance.now();
      report.liveProviderRequests++;
      const response=await originalFetch(input,init); // Always real provider I/O.
      const request = {
        endpoint:url.origin+url.pathname,status:response.status,successful:response.ok,
        transportContentType:response.headers.get('content-type'),headersLatencyMs:Math.round(performance.now()-started),
      };
      if(!response.ok) request.providerError=redact(await response.clone().text());
      report.requests.push(request);
      if((init?.method || 'GET').toUpperCase()==='POST') report.synthesisRequests.push(request);
      return response;
    };
    const esbuild = require('esbuild');
    const bundle = await esbuild.build({entryPoints:[entry],bundle:true,platform:'node',target:'node20',format:'cjs',packages:'external',write:false,logLevel:'silent'});
    const filename=path.join(root,'scripts/.lexara-tts-live-runtime.cjs');
    const loaded=new Module(filename,module); loaded.filename=filename; loaded.paths=Module._nodeModulePaths(path.dirname(filename));
    loaded._compile(bundle.outputFiles[0].text,filename); mesh=loaded.exports;
    const configured=mesh.getConfiguredLexaraTTSProviders();
    if(configured.length!==1 || configured[0]!==provider) throw new Error('Provider isolation did not match the requested route');
    // Readiness performs this provider's real canary, then the normal synthesis
    // entrypoint sends the fixed test sentence. Neither call is mocked.
    await mesh.refreshLexaraTTSReadiness(false);
    const firstSynthesisIndex=report.synthesisRequests.length;
    const started=performance.now();
    const audio=await mesh.synthesizeLexaraSpeechWithFailover(SENTENCE);
    report.synthesisLatencyMs=Math.round(performance.now()-started);
    report.provider=audio.provider; report.model=audio.model; report.voice=audio.voiceId;
    report.byteCount=audio.audioData.length; report.contentType=audio.mimeType;
    const fixedRequests=report.synthesisRequests.slice(firstSynthesisIndex);
    report.validation=validateAudio({bytes:audio.audioData,mimeType:audio.mimeType,expectedFormat,outputDir});
    report.validation.checks.providerRequestSucceeded=fixedRequests.length>0&&fixedRequests.every(r=>r.successful);
    report.validation.checks.actualProvider=audio.provider===provider;
    report.validation.checks.approvedVoice=audio.voiceId===options['expected-voice'];
    report.validation.passed=Object.values(report.validation.checks).every(Boolean);
    report.status=report.validation.passed?'passed':'failed';
    process.exitCode=report.validation.passed?0:1;
  } catch(error) {
    report.status='failed'; report.error=redact(error.message || error);
    report.providerState=mesh?.getLexaraTTSReadiness().providers.find(p=>p.provider===provider) || null;
    process.exitCode=1;
  } finally {
    globalThis.fetch=originalFetch;
    for(const key of Object.keys(process.env)) if(!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env,originalEnv);
    report.finishedAt=new Date().toISOString(); save();
  }
}
module.exports={validateAudio,signature,SENTENCE};
if(require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=2;});
