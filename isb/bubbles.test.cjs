'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const crypto = require('node:crypto');
const {createIronBubbles} = require('./bubbles.cjs');

function fixture() {
  let now = 1000000;
  let counter = 0;
  return {
    now: () => now,
    advance: n => { now += n; },
    random: n => Buffer.alloc(n, ++counter % 256),
    bubbles: () => createIronBubbles({size: 16, radius: 2, rotationMs: 1000,
      isolationMs: 300, clock: () => now, randomBytes: n => Buffer.alloc(n, ++counter % 256)})
  };
}

test('all bubbles start with distinct binary identifiers and are limited in count', () => {
  const env=fixture(), net=env.bubbles();
  assert.equal(net.status().total,16);
  assert.equal(net.status().isolated,0);
  assert.equal(new Set(net.publicPaths(16)).size,16);
  for(const path of net.publicPaths(16))assert.match(path,/^\/__isb__\/[a-f0-9]{16}\/backup$/);
  assert.throws(()=>createIronBubbles({size:3000}),RangeError);
  assert.throws(()=>createIronBubbles({size:0}),RangeError);
});

test('soft intrusion shifts only decoy identifiers, not applications or access', () => {
  const env=fixture(), net=env.bubbles();
  const before=net.publicPaths(16);
  const result=net.react({severity:'soft',channel:'decoy'});
  const after=net.publicPaths(16);
  assert.equal(result.action,'observe');
  assert.equal(result.enforcement,'none');
  assert.equal(net.status().isolated,0);
  assert.equal(net.status().shifted,5);
  assert.equal(after.filter((s,i)=>s!==before[i]).length,5);
});

test('hard attempt isolates connected decoy cells and regenerates safely', () => {
  const env=fixture(), net=env.bubbles();
  const result=net.react({severity:'hard',channel:'decoy'});
  assert.equal(result.enforcement,'decoys-only');
  assert.equal(net.status().isolated,5);
  assert.equal(net.status().pops,5);
  assert.equal(net.status().active,11);
  env.advance(301);
  const healed=net.tick();
  assert.equal(healed.restored,5);
  assert.equal(net.status().isolated,0);
  assert.equal(net.status().active,16);
});

test('wrong passwords and real-site observations never trigger bubble isolation', () => {
  const net=fixture().bubbles();
  for (let i=0;i<100;i++) net.react({severity:'hard',channel:'authentication'});
  net.react({severity:'hard',channel:'production'});
  assert.equal(net.status().isolated,0);
  assert.equal(net.status().pops,0);
});

test('automatic shifts occur after expiration with bounded work', () => {
  const env=fixture(),net=env.bubbles();
  const before=net.publicPaths(16);
  env.advance(1001); net.tick();
  const after=net.publicPaths(16);
  assert.equal(after.filter((s,i)=>s!==before[i]).length,16);
  assert.equal(net.status().active,16);
});

test('bursting a bubble cannot affect another application or launch network actions', () => {
  const net=fixture().bubbles();
  for(let i=0;i<100;i++) net.react({severity:'hard',channel:'decoy'});
  const metrics=net.status();
  assert.equal(metrics.total,16);
  assert(metrics.isolated<=16);
  assert.equal(Object.keys(metrics).some(k=>/password|ip|uri|cookie|token/i.test(k)),false);
  assert.deepEqual(net.react(null),{action:'observe',enforcement:'none'});
  assert.equal(net.status().action,'observe');
});

test('expired isolation remains visibly isolated until the self-heal actually runs', () => {
  const env=fixture(),net=env.bubbles();
  net.react({severity:'hard',channel:'decoy'});
  env.advance(301);
  assert.equal(net.status().isolated,5);
  assert.equal(net.status().active,11);
  assert.equal(net.tick().restored,5);
  assert.equal(net.status().isolated,0);
});
