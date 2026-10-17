'use strict';
// Run in repository root with dependencies installed:
// node isb/embedded-express.verify.cjs
// Local fixtures only. Never creates users, charges a card or calls production.
const assert = require('node:assert/strict');
const express = require('express');
const {createHmac} = require('node:crypto');
const {createEmbeddedISB} = require('./embedded.cjs');

async function verify() {
  const app = express(), isb = createEmbeddedISB();
  app.use(isb.middleware);
  app.get('/robots.txt',(_req,res)=>res.type('text/plain').send('ORIGINAL ROBOTS'));
  app.get('/login',(_req,res)=>res.status(200).send('ORIGINAL LOGIN'));
  app.get('/api/ready',(_req,res)=>res.json({ready:true}));
  app.post('/api/local-login',express.json(),(req,res)=>
    res.status(req.body?.password==='fixture-correct'?200:401).json({authorized:req.body?.password==='fixture-correct'}));
  app.post('/api/local-signup',express.json(),(_req,res)=>res.status(201).json({trialHours:72}));
  app.post('/api/square/webhook',express.raw({type:'application/json'}),(req,res)=>{
    const expected=createHmac('sha256','fixture-only-key').update(req.body).digest('hex');
    res.status(req.get('x-square-hmacsha256-signature')===expected?200:401).json({received:true});
  });
  app.get('/api/lexara/test',(_req,res)=>res.json({lexara:'untouched'}));
  app.get('/api/spectra/test',(_req,res)=>res.json({spectra:'untouched'}));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const visit=(url,options)=>fetch(base+url,options);
  const post=(url,body,headers={})=>visit(url,{method:'POST',headers:{'content-type':'application/json',...headers},body});
  try {
    let response=await visit('/robots.txt');
    assert.equal(await response.text(),'ORIGINAL ROBOTS');
    response=await visit('/login');
    assert.equal(await response.text(),'ORIGINAL LOGIN');
    response=await visit('/api/ready');
    assert.equal((await response.json()).ready,true);
    response=await post('/api/local-login',JSON.stringify({password:'mistake'}));
    assert.equal(response.status,401);
    response=await post('/api/local-login',JSON.stringify({password:'fixture-correct'}));
    assert.equal(response.status,200);
    response=await post('/api/local-signup','{}');
    assert.equal(response.status,201);
    assert.equal((await response.json()).trialHours,72);
    const payload=JSON.stringify({subscription:'fixture'});
    const signature=createHmac('sha256','fixture-only-key').update(payload).digest('hex');
    response=await post('/api/square/webhook',payload,{'x-square-hmacsha256-signature':signature});
    assert.equal(response.status,200);
    response=await post('/api/square/webhook',payload,{'x-square-hmacsha256-signature':'invalid'});
    assert.equal(response.status,401);
    response=await visit('/api/lexara/test');
    assert.equal((await response.json()).lexara,'untouched');
    response=await visit('/api/spectra/test');
    assert.equal((await response.json()).spectra,'untouched');
    response=await visit('/__isb__/robots.txt');
    assert.equal(response.status,200);
    assert.match(await response.text(),/Disallow: \/__isb__\//);
    for(let i=0;i<3;i++){
      response=await visit('/__isb__/.env');
      assert.equal(response.status,404);
    }
    assert(isb.snapshot().bubbles.pops>=5);
    assert.equal(isb.snapshot().enforcement,'none');
    response=await visit('/__isb__/healthz');
    assert.equal(response.status,200);
    console.log('PASS: original login, signup, trial, signed Square webhooks, Lexara, Spectra, robots and isolated decoys');
  } finally {
    isb.stop();
    await new Promise(resolve=>server.close(resolve));
  }
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
