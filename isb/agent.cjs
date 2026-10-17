'use strict';
// Read-only Railway HTTP snapshot collector. Independent of application and routing.
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {createHash,randomBytes} = require('node:crypto');
const {createMesh} = require('./mesh.cjs');
const execFilePromise = promisify(execFile);
const PROJECT = '51340040-15c4-4d74-b60e-8471bdcae20e';
const SERVICES = Object.freeze(['Bad-Blue', 'lexara-ddgs', 'lexara-openserp']);
const MAX_LINE = 16 * 1024;

function createRailwayAgent(options = {}) {
  const maxOutputBytes = Number.isInteger(options.maxOutputBytes) && options.maxOutputBytes >= 10000 && options.maxOutputBytes <= 8 * 1024 * 1024 ? options.maxOutputBytes : 2 * 1024 * 1024;
  const execute = typeof options.execute === 'function' ? options.execute : async (cmd,args,opts) => {
    const result=await execFilePromise(cmd,args,opts);
    return result.stdout;
  };
  const mesh = createMesh({maxBuckets:1024});
  const seen = new Set();
  const pepper = randomBytes(32);
  let duplicates = 0;

  async function collect() {
    // Atomic input stage. Failures must not commit partial data to the correlation mesh.
    const payloads=[];
    try {
      for(const service of SERVICES) {
        const args=['logs','--http','--json','--lines','500','--project',PROJECT,
          '--environment','production','--service',service];
        const answer=await execute('railway',args,{encoding:'utf8',timeout:20_000,maxBuffer:maxOutputBytes});
        const raw=typeof answer==='string' ? answer : answer?.stdout;
        if(typeof raw!=='string' || Buffer.byteLength(raw,'utf8')>maxOutputBytes)throw Error('invalid telemetry');
        payloads.push(raw);
      }
    } catch {
      return Object.freeze({status:'unavailable',action:'observe',report:null,source:'railway-http'});
    }

    for(const payload of payloads) {
      for(const line of payload.split('\n')) {
        if (!line.trim()) continue;
        if (Buffer.byteLength(line,'utf8')>MAX_LINE) {mesh.observe(null);continue;}
        try {
          const event=JSON.parse(line);
          // Request IDs are not persisted or reported, only a salted one-way dedup key.
          const id=typeof event.requestId==='string' && event.requestId.length>0 && event.requestId.length<=256 ? event.requestId:null;
          let key=null;
          if(id && typeof event.host === 'string') {
            key=createHash('sha256').update(pepper).update(event.host).update('\n').update(id).digest('hex');
            if(seen.has(key)){duplicates++;continue;}
          }
          const result=mesh.observe(event);
          if (key && result.accepted) {
            if(seen.size>=20000)seen.delete(seen.values().next().value);
            seen.add(key);
          }
        } catch {mesh.observe(null);}
      }
    }
    const report=mesh.snapshot();
    report.totals.duplicates=duplicates;
    return Object.freeze({status:'complete',action:'observe',source:'railway-http',report});
  }
  return Object.freeze({collect});
}
module.exports = {createRailwayAgent};
