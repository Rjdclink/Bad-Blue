'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,existsSync}=require('node:fs');
const {join}=require('node:path');

test('collector image contains Railway CLI but has no public listener or decoy exposure',()=>{
  const docker=readFileSync(join(__dirname,'Dockerfile'),'utf8');
  assert.match(docker,/FROM node:22-bookworm-slim/);
  assert.match(docker,/npm install -g .*@railway\/cli@\d+\.\d+\.\d+/);
  assert.match(docker,/WORKDIR \/opt\/isb/);
  assert.match(docker,/COPY observer\.cjs normalize\.cjs mesh\.cjs agent\.cjs run-agent\.cjs/);
  assert.doesNotMatch(docker,/EXPOSE|run-isb\.cjs|run-decoy\.cjs|decoy\.cjs|ENV RAILWAY_TOKEN|COPY\s+(?:server\/|client\/|\.\.\/)/i);
  assert.match(docker,/USER node/);
  assert.match(docker,/CMD \["node", "run-agent.cjs", "--watch"\]/);
});

test('decoy image cannot contain Railway CLI or observer credentials',()=>{
  const docker=readFileSync(join(__dirname,'Dockerfile.decoy'),'utf8');
  assert.match(docker,/FROM node:22-bookworm-slim/);
  assert.match(docker,/WORKDIR \/opt\/isb/);
  assert.match(docker,/COPY observer\.cjs bubbles\.cjs decoy\.cjs run-decoy\.cjs/);
  assert.doesNotMatch(docker,/@railway\/cli|agent\.cjs|run-isb\.cjs|run-agent\.cjs|COPY \. \.\/|ENV RAILWAY_TOKEN/i);
  assert.match(docker,/USER node/);
  assert.match(docker,/CMD \["node", "run-decoy.cjs"\]/);
});

test('no dependency on main application startup configuration',()=>{
  for(const file of ['run-isb.cjs','agent.cjs','constellation.cjs','bubbles.cjs','decoy.cjs']){
    const body=readFileSync(join(__dirname,file),'utf8');
    assert.doesNotMatch(body,/(?:require|import)\s*\(?['"]\.\.\//);
    assert.doesNotMatch(body,/process\.env\.(?:SQUARE_|SESSION_|SUPABASE_)/);
    assert.doesNotMatch(body,/railway (?:deploy|restart|set-variables|up|down)/);
  }
});

test('both isolated image verifier stages include the mock Railway CLI wrapper script',()=>{
  for(const filename of ['Dockerfile','Dockerfile.decoy']) {
    const body=readFileSync(join(__dirname,filename),'utf8');
    assert.match(body,/COPY collect\.sh \.\//);
  }
});
