'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {createDecoyHandler} = require('./decoy.cjs');
const {createIronBubbles} = require('./bubbles.cjs');

async function withServer(handler, fn) {
  const server = http.createServer({maxHeaderSize: 8192}, handler);
  await new Promise((resolve, reject) => server.once('error',reject).listen(0,'127.0.0.1',resolve));
  try {return await fn(server.address().port)}
  finally {await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
}
function send(port,path, method='GET', body='') {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{'content-type':'application/json'}}, res => {
      let received='';res.on('data', x=>received+=x.toString());res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:received}));
    });req.on('error',reject);req.end(body);
  });
}

test('decoy returns a harmless constant response and no application/session headers',async()=>{
  const b=createIronBubbles({size:16});
  const decoy=createDecoyHandler({bubbles:b});
  await withServer(decoy.handler,async port=>{
    for(const path of ['/','/api/local-login','/api/square/webhook','/definitely-not-found']){
      const res=await send(port,path);
      assert.equal(res.status,404);
      assert.equal(res.body,'Not found\n');
      assert.equal(res.headers['set-cookie'],undefined);
      assert.equal(res.headers.location,undefined);
      assert.equal(res.headers['content-security-policy'],"default-src 'none'");
    }
  });
  assert.equal(b.status().pops,0);
});

test('probing independent decoy shifts then pops only decoy bubbles, never real traffic', async()=>{
  const b=createIronBubbles({size:16});
  const decoy=createDecoyHandler({bubbles:b,probeThreshold:3});
  await withServer(decoy.handler,async port=>{
    for(let n=0;n<3;n++) assert.equal((await send(port,'/.env')).status,404);
  });
  const status=b.status();
  assert.equal(status.pops,5);
  assert.equal(status.isolated,5);
  assert.equal(decoy.snapshot().enforcement,'decoys-only');
});

test('invalid credentials and Square-style POST to decoy never cause network enforcement',async()=>{
  const b=createIronBubbles({size:16});
  const decoy=createDecoyHandler({bubbles:b});
  await withServer(decoy.handler,async port=>{
    for(let n=0;n<25;n++) await send(port,'/api/local-login','POST','{"password":"TOPSECRET"}');
    await send(port,'/api/square/webhook','POST','{"card":"DONOTLOG"}');
  });
  assert.equal(b.status().pops,0);
  assert.equal(b.status().shifted,0);
  const s=JSON.stringify(decoy.snapshot());
  assert(!s.includes('TOPSECRET'));assert(!s.includes('DONOTLOG'));
});

test('decoy monitoring is bounded under noisy scans and cannot proxy',async()=>{
  const b=createIronBubbles({size:16});
  const decoy=createDecoyHandler({bubbles:b,maxExamined:8,probeThreshold:3});
  await withServer(decoy.handler,async port=>{
    for(let n=0;n<100;n++) {
      const res=await send(port,'/.git/config?secret='+n);
      assert.equal(res.status,404);
    }
  });
  const s=decoy.snapshot();
  assert(s.examined<=8);
  assert.equal(s.requestCount,100);
  assert.equal(s.enforcement,'decoys-only');
  assert.equal(s.action,'observe');
});

test('decoy publishes sacrificial routes which shift and regenerate; no LegalWhat data exposed',async()=>{
  let now=1000000;
  const b=createIronBubbles({size:16,radius:2,rotationMs:1000,isolationMs:300,clock:()=>now});
  const decoy=createDecoyHandler({bubbles:b,probeThreshold:3,clock:()=>now});
  await withServer(decoy.handler,async port=>{
    const before=await send(port,'/robots.txt');
    assert.equal(before.status,200);
    assert.match(before.body,/Disallow: \/__isb__\/[a-f0-9]{16}\/backup/);
    assert(!before.body.includes('legalwhat.com'));
    const bait=before.body.match(/\/__isb__\/[a-f0-9]{16}\/backup/)[0];
    assert.equal((await send(port,bait)).status,404);
    const after=await send(port,'/robots.txt');
    assert.equal(after.status,200);
    assert.notEqual(after.body,before.body);
    for(let n=0;n<3;n++) await send(port,'/.git/config');
    assert.equal(b.status().isolated>0,true);
    now+=301;b.tick();
    const restored=await send(port,'/robots.txt');
    assert.equal(restored.status,200);
    assert.match(restored.body,/Disallow: \/__isb__\/[a-f0-9]{16}\/backup/);
  });
});

test('standalone decoy health probe works without requiring any application endpoint',async()=>{
  const b=createIronBubbles({size:16}), decoy=createDecoyHandler({bubbles:b});
  await withServer(decoy.handler,async port=>{
    const r=await send(port,'/healthz');
    assert.equal(r.status,200);
    assert.equal(r.body,'ok\n');
    assert.equal(r.headers['set-cookie'],undefined);
  });
  assert.equal(b.status().shifted,0);
  assert.equal(b.status().pops,0);
});
