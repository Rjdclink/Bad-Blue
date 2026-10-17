'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createRailwayAgent} = require('./agent.cjs');
const S=['Bad-Blue','lexara-ddgs','lexara-openserp'];
const sample={host:'legalwhat.com',path:'/.env',httpStatus:404,method:'GET',timestamp:'2026-10-16T23:22:12Z'};

function fakeReader() {
  const calls=[];
  const run=async (command,args,options) => {
    calls.push({command,args,options});
    const service=args[args.indexOf('--service')+1];
    assert(S.includes(service));
    const host=service==='Bad-Blue'?'legalwhat.com':service==='lexara-ddgs'?'lexara-ddgs-production.up.railway.app':'lexara-openserp-production.up.railway.app';
    return JSON.stringify({...sample,host,requestId:service+'-rid'})+'\n';
  };
  return {calls,run};
}

test('agent reads only Railway HTTP telemetry, does not change Railway or LegalWhat',async()=>{
  const f=fakeReader();const agent=createRailwayAgent({execute:f.run});
  const report=await agent.collect();
  assert.equal(report.status,'complete');
  assert.equal(report.report.scope,'legalwhat');
  assert.equal(report.report.totals.observed,3);
  assert.equal(report.report.findings.length,1);
  assert.equal(f.calls.length,3);
  for (const x of f.calls) {
    assert.equal(x.command,'railway');
    assert.deepEqual(x.args.slice(0,4),['logs','--http','--json','--lines']);
    assert.equal(x.args[x.args.indexOf('--environment')+1],'production');
    assert.equal(x.args[x.args.indexOf('--project')+1],'51340040-15c4-4d74-b60e-8471bdcae20e');
    assert(!x.args.join(' ').match(/deploy|edge-rules|update|delete|restart|set-variables/));
  }
});

test('no double counting across repeated historical log snapshots',async()=>{
  const f=fakeReader(),agent=createRailwayAgent({execute:f.run});
  const first=await agent.collect();const second=await agent.collect();
  assert.equal(first.report.totals.observed,3);
  assert.equal(second.report.totals.observed,3);
  assert.equal(second.report.findings.length,1);
  assert.equal(second.report.totals.duplicates,3);
});

test('one source failure discards a partial poll, reports unavailable and leaks no raw logs',async()=>{
  const f=fakeReader(); let calls=0;
  const agent=createRailwayAgent({execute:async(...args)=>{
    calls++;if(calls===2)throw new Error('LEAK_PRIVATE_BAD_RAW_ERROR');
    return f.run(...args);
  }});
  const report=await agent.collect();
  assert.equal(report.status,'unavailable');
  assert.equal(report.report,null);
  assert.equal(report.action,'observe');
  assert(!JSON.stringify(report).includes('LEAK_PRIVATE_BAD_RAW_ERROR'));
  const next=await agent.collect();
  assert.equal(next.status,'complete');
  assert.equal(next.report.totals.observed,3);
});

test('malformed or oversized external log text is nonfatal and cannot be returned raw',async()=>{
  const f=fakeReader(); const agent=createRailwayAgent({execute:async(...args)=>{
    const s=await f.run(...args); return s + 'MALFORMED_SECRET\n' + 'X'.repeat(22000)+'\n';
  }});
  const result=await agent.collect();
  assert.equal(result.status,'complete');
  assert.equal(result.report.totals.rejected,6);
  assert.equal(result.report.totals.observed,3);
  assert(!JSON.stringify(result).includes('MALFORMED_SECRET'));
});

test('railway log volume limit is enforced before acceptance',async()=>{
  const agent=createRailwayAgent({execute:async()=> 'X'.repeat(2_000_000),maxOutputBytes:10000});
  const result=await agent.collect();
  assert.equal(result.status,'unavailable');
  assert.equal(result.report,null);
});

test('failed or unknown HTTP fields cannot produce active enforcement',async()=>{
  const agent=createRailwayAgent({execute:async()=>JSON.stringify({host:'legalwhat.com',path:'/api/local-login',httpStatus:401,timestamp:'2026-10-16T23:22:12Z'})+'\n'});
  const result=await agent.collect();
  assert.equal(result.status,'complete');
  assert.equal(result.report.action,'observe');
  assert.equal(result.report.findings.length,0);
});
