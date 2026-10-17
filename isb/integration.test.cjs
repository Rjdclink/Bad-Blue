'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createISBRuntime}=require('./run-isb.cjs');

function probe(port,path) {
  return new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path,timeout:1000},res=>{
    let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve({status:res.statusCode,body}));
  }).on('error',reject));
}
const advisory={status:'complete',report:{scope:'legalwhat',findings:[{kind:'probe-burst',minute:'2026-10-16T23:45Z'}]}};

test('integrated ISB never starts as part of application without isolated-service opt in',async()=>{
  await assert.rejects(()=>createISBRuntime({env:{ISB_SERVICE_ISOLATED:'0'}}),/isolated/i);
});

test('one separate runtime links passive four-host intelligence, decoy shifts and decoy popping',async()=>{
  const agent={collect:async()=>advisory};
  const runtime=await createISBRuntime({env:{ISB_SERVICE_ISOLATED:'1',ISB_BIND:'127.0.0.1',ISB_PORT:'0'},agent,autoPoll:false});
  try {
    const port=runtime.port;
    const before=await probe(port,'/robots.txt');
    assert.equal(before.status,200);
    const report=await runtime.pollOnce();
    assert.equal(report.action,'observe');
    assert.equal(report.enforcement,'none');
    const after=await probe(port,'/robots.txt');
    assert.notEqual(before.body,after.body);
    assert.equal((await probe(port,'/.env')).status,404);
    assert.equal((await probe(port,'/.env')).status,404);
    assert.equal((await probe(port,'/.env')).status,404);
    assert(runtime.bubbles.status().pops>0);
    assert.equal(report.railway.status,'complete');
    assert.equal(runtime.decoy.snapshot().enforcement,'decoys-only');
  }finally{await runtime.stop();}
});

test('monitor outage cannot prevent isolated decoy from responding or change application',async()=>{
  const runtime=await createISBRuntime({env:{ISB_SERVICE_ISOLATED:'1',ISB_BIND:'127.0.0.1',ISB_PORT:'0'},agent:{collect:async()=>{throw Error('sensitive-token')}} ,autoPoll:false});
  try {
    const before=runtime.bubbles.publicPaths();
    const report=await runtime.pollOnce();
    assert.equal(report.railway.status,'unavailable');
    assert.equal(report.action,'observe');
    assert.equal((await probe(runtime.port,'/')).status,404);
    assert.deepEqual(before,runtime.bubbles.publicPaths());
    assert(!JSON.stringify(report).includes('sensitive-token'));
  }finally{await runtime.stop();}
});

test('publicly bound listener explicitly prohibited unless separately confirmed',async()=>{
  await assert.rejects(()=>createISBRuntime({env:{ISB_SERVICE_ISOLATED:'1',ISB_BIND:'0.0.0.0',ISB_PORT:'0'},autoPoll:false}),/explicit public|loopback-only/i);
});

test('ISB observation credentials are never colocated with any public listener',async()=>{
  await assert.rejects(async()=>{
    const runtime=await createISBRuntime({env:{ISB_SERVICE_ISOLATED:'1',ISB_BIND:'0.0.0.0',ISB_BIND_PUBLIC:'1',ISB_PORT:'0'},autoPoll:false});
    await runtime.stop();
  }, /must remain loopback-only/i);
});
