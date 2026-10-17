'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createServer} = require('node:http');
const {createHmac} = require('node:crypto');
const express = require('express');
const {installEmbeddedISB} = require('../isb/embedded.cjs');

function fixture(options = {}) {
  const app = express();
  const isb = installEmbeddedISB(app, options);
  // These stand-ins deliberately model existing responses without sharing production accounts.
  app.get('/login', (_req, res) => res.status(200).send('Login page'));
  app.get('/robots.txt', (_req, res) => res.status(200).type('text/plain').send('User-agent: *\nAllow: /\n'));
  app.get('/api/ready', (_req, res) => res.json({ready:true}));
  app.get('/api/lexara/hello', (_req, res) => res.json({message:'Lexara remains unchanged'}));
  app.get('/api/spectra/hello', (_req, res) => res.json({map:'unchanged'}));
  app.post('/api/local-login', express.json(), (req, res) => {
    if (req.body?.password === 'correct-local-fixture') return res.status(200).json({authorized:true});
    return res.status(401).json({authorized:false});
  });
  app.post('/api/local-signup', express.json(), (_req, res) => res.status(201).json({trialHours:72}));
  app.post('/api/square/webhook', express.raw({type:'application/json'}), (req,res) => {
    const valid = req.headers['x-square-hmacsha256-signature'] ===
      createHmac('sha256','fixture-not-production').update(req.body).digest('hex');
    res.status(valid?200:401).json({received:valid});
  });
  // A production application's SPA fallback. ISB must never interfere with it.
  app.use((_req, res) => res.status(200).send('SPA fallback'));
  const server=createServer(app);
  return {app,isb,server};
}

async function withServer(options,fn) {
  const obj=fixture(options);
  await new Promise((resolve,reject)=>{obj.server.once('error',reject);obj.server.listen(0,'127.0.0.1',resolve)});
  try { return await fn(obj.server.address().port,obj.isb); }
  finally {obj.isb.stop();await new Promise(resolve=>obj.server.close(resolve));}
}
async function request(port,path,{method='GET',host='legalwhat.com',body='',headers={}} = {}) {
  // Node fetch silently replaces Host with localhost; core HTTP preserves the fixture.
  return new Promise((resolve,reject)=>{
    const req = require('node:http').request({
      hostname:'127.0.0.1',port,path,method,headers:{Host:host,...headers},
    }, response=>{
      const chunks=[];
      response.on('data', chunk=>chunks.push(chunk));
      response.on('end', ()=>resolve({
        status:response.statusCode,
        headers:{get:name=>response.headers[name.toLowerCase()] ?? null},
        body:Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error',reject);
    req.end(method==='GET'||method==='HEAD'?undefined:body);
  });
}

test('login, signup, free trial, Square, Lexara, Spectra and ordinary paths are never changed',async()=>{
  await withServer({autoTick:false},async(port,isb)=>{
    assert.equal(isb.snapshot().mode,'passive');
    const login=await request(port,'/login');
    assert.equal(login.status,200);assert.equal(login.body,'Login page');
    for(let i=0;i<30;i++){
      const error=await request(port,'/api/local-login',{method:'POST',body:'{"password":"wrong"}',headers:{'content-type':'application/json'}});
      assert.equal(error.status,401);assert.deepEqual(JSON.parse(error.body),{authorized:false});
    }
    const valid=await request(port,'/api/local-login',{method:'POST',body:'{"password":"correct-local-fixture"}',headers:{'content-type':'application/json'}});
    assert.equal(valid.status,200);
    const signup=await request(port,'/api/local-signup',{method:'POST',body:'{"email":"private-fixture@example.invalid"}',headers:{'content-type':'application/json'}});
    assert.equal(signup.status,201);
    assert.deepEqual(JSON.parse(signup.body),{trialHours:72});
    const raw='{"type":"payment.updated","noRealMerchantCredentials":true}';
    const signature=createHmac('sha256','fixture-not-production').update(raw).digest('hex');
    const square=await request(port,'/api/square/webhook',{method:'POST',body:raw,headers:{'content-type':'application/json','x-square-hmacsha256-signature':signature}});
    assert.equal(square.status,200);
    const badSquare=await request(port,'/api/square/webhook',{method:'POST',body:raw,headers:{'content-type':'application/json','x-square-hmacsha256-signature':'wrong'}});
    assert.equal(badSquare.status,401);
    assert.equal((await request(port,'/api/ready')).status,200);
    assert.match((await request(port,'/api/lexara/hello')).body,/Lexara remains unchanged/);
    assert.match((await request(port,'/api/spectra/hello')).body,/unchanged/);
    assert.equal((await request(port,'/not-a-path')).body,'SPA fallback');
    assert.equal((await request(port,'/robots.txt')).body,'User-agent: *\nAllow: /\n');
    const s=isb.snapshot();
    assert.equal(s.probes,0);
    assert.equal(s.bubbles.pops,0);
    assert.equal(s.bubbles.shifted,0);
    for(const secret of ['wrong','correct-local-fixture','private-fixture@example.invalid','payment.updated'])
      assert.equal(JSON.stringify(s).includes(secret),false);
  });
});

test('ordinary public scanner probes shift and pop only fake decoy bubbles, never the app',async()=>{
  await withServer({autoTick:false},async(port,isb)=>{
    const starting=isb.snapshot().bubbles;
    const a=await request(port,'/.git/config');
    const b=await request(port,'/.env?secret=never-log');
    const c=await request(port,'/wp-login.php');
    assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(c.status,200);
    await new Promise(resolve=>setImmediate(resolve));
    const after=isb.snapshot();
    assert.equal(starting.pops,0);
    assert(after.probes>=3);
    assert(after.bubbles.shifted>=5);
    assert(after.bubbles.pops>=1);
    assert.equal(after.action,'observe');
    assert.equal(after.enforcement,'none');
    assert(!JSON.stringify(after).includes('never-log'));
    assert.equal((await request(port,'/api/ready')).status,200);
  });
});

test('reserved ISB bait is accessible on same port, independent of login and the existing robots file',async()=>{
  await withServer({autoTick:false},async(port,isb)=>{
    const bait=await request(port,'/__isb__/robots.txt');
    assert.equal(bait.status,200);
    assert.match(bait.body,/^User-agent: \*/);
    assert.match(bait.body,/Disallow: \/__isb__\/[a-f0-9]{16}\/backup/);
    const path=bait.body.match(/\/__isb__\/[a-f0-9]{16}\/backup/)[0];
    const hit=await request(port,path);
    assert.equal(hit.status,404);
    assert.equal(hit.body,'Not found\n');
    assert.equal(hit.headers.get('set-cookie'),null);
    assert.equal((await request(port,'/robots.txt')).body,'User-agent: *\nAllow: /\n');
    const other=await request(port,'/some-legitimate-route');
    assert.equal(other.body,'SPA fallback');
    assert(isb.snapshot().bubbles.shifted>0);
  });
});

test('wrong hostname, wrong passwords and hostile request bodies never shift the bubble',async()=>{
  await withServer({autoTick:false},async(port,isb)=>{
    for(let i=0;i<30;i++) {
      assert.equal((await request(port,'/.env',{host:'unrelated.example'})).status,200);
      assert.equal((await request(port,'/api/local-login',{method:'POST',body:'{"password":"wrong"}',headers:{'content-type':'application/json'}})).status,401);
    }
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(isb.snapshot().probes,0);
    assert.equal(isb.snapshot().bubbles.pops,0);
  });
});

test('malformed input and invalid clocks fail open; disabled ISB installs no middleware',async()=>{
  assert.throws(()=>installEmbeddedISB(null),/Express/);
  const app=express();
  assert.throws(()=>installEmbeddedISB(app,{clock:()=>NaN}),/Invalid clock/);
  const disabled=installEmbeddedISB(app,{disabled:true});
  assert.equal(disabled.snapshot().active,false);
  disabled.stop();
  app.get('/api/ready',(_req,res)=>res.send('ready'));
  const server=createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const p=server.address().port;
    assert.equal((await request(p,'/api/ready')).body,'ready');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('application installation appears exactly once, before its regular logging middleware',()=>{
  const fs=require('node:fs');
  const file=fs.readFileSync(require('node:path').join(__dirname,'../server/index.ts'),'utf8');
  assert.equal(file.split("installEmbeddedISB(app)").length-1,1);
  assert(file.indexOf("installEmbeddedISB(app)") < file.indexOf('const start = Date.now();'));
  assert.doesNotMatch(file,/app\.(?:post|get)\(['"]\/api\/(?:local-login|local-signup|webhooks\/square)/);
});
