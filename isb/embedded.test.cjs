'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {EventEmitter} = require('node:events');
const {createEmbeddedISB} = require('./embedded.cjs');

function request(isb, url, options = {}) {
  const req = {
    originalUrl: url, url, method: options.method || 'GET',
    headers: {host: options.host || 'legalwhat.com', authorization: 'Bearer PRIVATE_TOKEN'},
    body: {password:'PRIVATE_PASSWORD'}
  };
  const res = new EventEmitter();
  res.statusCode = options.statusCode || 200;
  res.headersSent = false;
  res.headers = {};
  res.writeHead = (status, headers) => {
    res.statusCode = status; res.headers = headers; res.headersSent = true;
  };
  res.end = (payload) => { res.body = payload ?? ''; res.headersSent = true; res.emit('finish'); };
  let nextCalls = 0;
  isb.middleware(req, res, () => { nextCalls++; });
  if (nextCalls) res.emit('finish');
  return {req, res, nextCalls};
}
function harness(options={}) {
  const tasks = [];
  const isb = createEmbeddedISB({
    schedule: fn => tasks.push(fn),
    intervalFactory: () => ({unref(){}}),
    clearIntervalFn: () => {},
    ...options
  });
  const flush = () => {
    let count=0;
    while (tasks.length) {
      assert(count++ < 1000, 'scheduler leaked an unbounded task loop');
      tasks.shift()();
    }
  };
  return {isb,flush};
}

test('ordinary login, signup, trial, Lexara, Spectra and Square responses pass through unchanged', () => {
  const {isb,flush} = harness();
  for (const path of ['/login','/signup','/api/local-login','/api/local-signup',
    '/api/auth/user/status','/api/subscription/start','/api/square/webhook',
    '/api/lexara/chat','/api/spectra/estimate']) {
    const r=request(isb,path+'?password=SECRET_DO_NOT_LOG',{statusCode:401,method:'POST'});
    assert.equal(r.nextCalls,1,path);
    assert.equal(r.res.statusCode,401);
    assert.equal(r.res.headersSent,false);
    assert.deepEqual(r.res.headers,{});
  }
  flush();
  const status=isb.snapshot();
  assert.equal(status.mode,'passive');
  assert.equal(status.enforcement,'none');
  assert.equal(status.bubbles.shifted,0);
  assert.equal(status.bubbles.pops,0);
  assert(status.observed>=9);
  assert(!JSON.stringify(status).includes('SECRET_DO_NOT_LOG'));
  isb.stop();
});

test('ordinary mistakes including hundreds of wrong passwords never activate bubbles',()=>{
  const {isb,flush}=harness();
  for(let i=0;i<200;i++) request(isb,'/api/local-login',{statusCode:401,method:'POST'});
  request(isb,'/api/square/webhook',{method:'POST'});
  flush();
  assert.equal(isb.snapshot().bubbles.shifted,0);
  assert.equal(isb.snapshot().bubbles.pops,0);
  assert.equal(isb.snapshot().enforcement,'none');
  isb.stop();
});

test('known malicious probes shift ONLY decoys after a three-request burst',()=>{
  const {isb,flush}=harness();
  for(const host of ['legalwhat.com','bad-blue-production.up.railway.app','legalwhat.com']){
    const r=request(isb,'/.git/config',{host,statusCode:404});
    assert.equal(r.nextCalls,1);
    assert.equal(r.res.statusCode,404);
  }
  flush();
  const status=isb.snapshot();
  assert(status.bubbles.shifted>=5);
  assert.equal(status.bubbles.pops,0);
  assert.equal(status.enforcement,'none');
  isb.stop();
});

test('reserved decoy URLs are the ONLY newly answered paths; real routes remain untouched',()=>{
  const {isb}=harness();
  const robots=request(isb,'/__isb__/robots.txt');
  assert.equal(robots.nextCalls,0);
  assert.equal(robots.res.statusCode,200);
  assert.match(robots.res.body,/Disallow: \/__isb__\/[a-f0-9]{16}\/backup/);
  for(let i=0;i<3;i++){
    const r=request(isb,'/__isb__/.env',{statusCode:200});
    assert.equal(r.nextCalls,0);
    assert.equal(r.res.statusCode,404);
    assert.equal(r.res.body,'Not found\n');
  }
  assert(isb.snapshot().bubbles.pops>=5);
  assert.equal(isb.snapshot().enforcement,'none');
  const alive=request(isb,'/__isb__/healthz');
  assert.equal(alive.nextCalls,0);
  assert.equal(alive.res.statusCode,200);
  isb.stop();
});

test('unknown hosts never enter LegalWhat telemetry; application responses continue',()=>{
  const {isb,flush}=harness();
  assert.equal(request(isb,'/api/local-login',{host:'attacker.example.com'}).nextCalls,1);
  flush();
  assert.equal(isb.snapshot().observed,0);
  isb.stop();
});

test('monitoring failures cannot block or alter legitimate user requests',()=>{
  const {isb,flush}=harness({mesh:{observe(){throw Error('observer failure')},snapshot(){throw Error('no stats')}}});
  const r=request(isb,'/api/local-login',{method:'POST'});
  assert.equal(r.nextCalls,1);
  assert.equal(r.res.statusCode,200);
  assert.doesNotThrow(flush);
  assert.equal(isb.snapshot().enforcement,'none');
  isb.stop();
});

test('collection has a hard bound; excess traffic cannot grow an unlimited queue',()=>{
  const {isb,flush}=harness({maxQueue:4,maxPerSecond:50});
  for(let i=0;i<1000;i++){
    assert.equal(request(isb,'/api/local-login?token=HIDDEN',{statusCode:401,method:'POST'}).nextCalls,1);
  }
  assert(isb.snapshot().dropped>0);
  assert(isb.snapshot().queued<=4);
  flush();
  assert.equal(isb.snapshot().queued,0);
  assert(isb.snapshot().observed<=50);
  isb.stop();
});

test('when shut down, ISB never schedules work or affects any route',()=>{
  const {isb,flush}=harness();
  isb.stop();
  assert.equal(request(isb,'/login').nextCalls,1);
  flush();
  assert.equal(isb.snapshot().observed,0);
});

test('no passwords, query parameters, IPs, headers or merchant payloads appear in snapshots',()=>{
  const {isb,flush}=harness();
  assert.equal(request(isb,'/api/square/webhook?access_token=PRIVATE_PAYMENT_SECRET',{method:'POST'}).nextCalls,1);
  flush();
  const output=JSON.stringify(isb.snapshot());
  for(const secret of ['PRIVATE_PAYMENT_SECRET','PRIVATE_PASSWORD','PRIVATE_TOKEN']) assert(!output.includes(secret));
  isb.stop();
});
