'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createConstellation}=require('./constellation.cjs');
const {createIronBubbles}=require('./bubbles.cjs');
const {createDecoyHandler}=require('./decoy.cjs');

function fakeReport(probes) {
  return {status:'complete',action:'observe',source:'railway-http',report:{
    action:'observe',mode:'passive',scope:'legalwhat',findings:probes?[{minute:'2026-10-16T23:22Z',kind:'probe-burst',count:3,recommendedResponse:'operator-review',enforcement:'none'}]:[],
    totals:{observed:probes?3:1,rejected:0,suspiciousProbes:probes?3:0,serverErrors:0}}};
}

test('credible Railway probe shifts separate sacrificial routes, never changes main app',async()=>{
  const bubbles=createIronBubbles({size:16});
  const agent={collect:async()=>fakeReport(true)};
  const c=createConstellation({bubbles,agent});
  const before=bubbles.publicPaths(16);
  const result=await c.poll();
  assert.equal(result.mode,'passive');
  assert.equal(result.action,'observe');
  assert.equal(result.enforcement,'none');
  assert.equal(bubbles.status().isolated,0);
  assert.notDeepEqual(before,bubbles.publicPaths(16));
  assert.equal(result.railway.status,'complete');
});

test('same historical advisory never causes repeated movement',async()=>{
  const bubbles=createIronBubbles({size:16});
  const c=createConstellation({bubbles,agent:{collect:async()=>fakeReport(true)}});
  await c.poll();const first=bubbles.status().shifted;
  await c.poll(); assert.equal(bubbles.status().shifted,first);
});

test('normal login and signup telemetry do not shift or pop bubbles',async()=>{
  const bubbles=createIronBubbles({size:16});
  const c=createConstellation({bubbles,agent:{collect:async()=>fakeReport(false)}});
  const before=bubbles.publicPaths();
  const result=await c.poll();
  assert.deepEqual(before,bubbles.publicPaths());
  assert.equal(result.enforcement,'none');
});

test('railway outage fails open and does not trigger bubble movement',async()=>{
  const bubbles=createIronBubbles({size:16});
  const c=createConstellation({bubbles,agent:{collect:async()=>{throw Error('RAW_ACCOUNT_KEY');}}});
  const result=await c.poll();
  assert.equal(result.railway.status,'unavailable');
  assert.equal(result.enforcement,'none');
  assert.equal(bubbles.status().shifted,0);
  assert(!JSON.stringify(result).includes('RAW_ACCOUNT_KEY'));
});

test('hard decoy encounter pops neighbors without connecting to production',async()=>{
  const bubbles=createIronBubbles({size:16});
  const c=createConstellation({bubbles,agent:{collect:async()=>fakeReport(false)}});
  const decoy=createDecoyHandler({bubbles,probeThreshold:3});
  // Exercise the same mesh shared between all defense layers.
  const fakeReply=()=>({writeHead(){},end(){}});
  for(let i=0;i<3;i++)decoy.handler({method:'GET',url:'/.env'},fakeReply());
  const before=bubbles.status();
  assert.equal(before.isolated,5);
  const result=await c.poll();
  assert.equal(result.bubbles.isolated,5);
  assert.equal(result.enforcement,'none');
});
