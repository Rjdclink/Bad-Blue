'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {spawnSync} = require('node:child_process');
const {join} = require('node:path');

const sample = {
  host: 'legalwhat.com', path: '/api/local-login', method: 'POST',
  httpStatus: 401, timestamp: '2026-10-16T22:01:30.123Z', totalDuration: 34,
  srcIp: '192.0.2.8', clientUa: 'client-secret', password: 'password-secret',
  authorization: 'Bearer access-secret'
};

test('normalize accepts only known hosts and strips raw route, identity and credentials', () => {
  const {normalize} = require('./normalize.cjs');
  const result = normalize({...sample, path: '/user/private-secret?token=url-secret'});
  assert.equal(result.host, 'legalwhat.com');
  assert.equal(result.category, 'other');
  assert.equal(result.minute, '2026-10-16T22:01Z');
  assert.equal(result.action, 'observe');
  for (const secret of ['private-secret','url-secret','192.0.2.8','password-secret','client-secret','access-secret']) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  assert.equal(normalize({...sample,host:'attacker.example'}),null);
});

test('login failures, signup, trial and Square remain normal, including repeated failed passwords', () => {
  const {createMesh}=require('./mesh.cjs'); const mesh=createMesh();
  for(let i=0;i<20;i++) mesh.observe({...sample,httpStatus:401});
  mesh.observe({...sample, path:'/api/local-signup',httpStatus:200});
  mesh.observe({...sample, path:'/api/trial', httpStatus:200});
  mesh.observe({...sample, path:'/api/square/webhook',httpStatus:200});
  const summary=mesh.snapshot();
  assert.equal(summary.findings.length,0);
  assert.equal(summary.action,'observe');
  assert.equal(summary.totals.observed,23);
});

test('both main addresses and both supporting public search addresses share one scope', () => {
  const {normalize}=require('./normalize.cjs');
  for (const host of ['legalwhat.com','bad-blue-production.up.railway.app','lexara-ddgs-production.up.railway.app','lexara-openserp-production.up.railway.app']) {
    assert.equal(normalize({...sample,host,path:'/.env'}).scope,'legalwhat');
  }
});

test('credible probe burst produces an advisory but no enforcement action', () => {
  const {createMesh}=require('./mesh.cjs'); const mesh=createMesh();
  for(const host of ['legalwhat.com','bad-blue-production.up.railway.app','lexara-ddgs-production.up.railway.app']){
    mesh.observe({...sample, host, path:'/.git/config', httpStatus:404});
  }
  const summary=mesh.snapshot();
  assert.equal(summary.findings.length,1);
  assert.equal(summary.findings[0].kind,'probe-burst');
  assert.equal(summary.findings[0].recommendedResponse,'operator-review');
  assert.equal(summary.action,'observe');
});

test('different minutes never combine to manufacture a probe burst', () => {
  const {createMesh}=require('./mesh.cjs'); const mesh=createMesh();
  for(const timestamp of ['2026-10-16T22:01:30Z','2026-10-16T22:02:30Z','2026-10-16T22:03:30Z']){
    mesh.observe({...sample,timestamp,path:'/.env'});
  }
  assert.equal(mesh.snapshot().findings.length,0);
});

test('invalid input is ignored and never blocks anything', () => {
  const {normalize}=require('./normalize.cjs');
  const {createMesh}=require('./mesh.cjs'); const mesh=createMesh();
  for(const datum of [null, 4, 'abc', {}, [], {host:'unknown',path:'/.env'}, {host:'legalwhat.com',path:123}]){
    assert.doesNotThrow(()=>mesh.observe(datum));
  }
  assert.equal(normalize(null),null);
  assert.equal(mesh.snapshot().action,'observe');
});

test('mesh memory stays bounded under many distinct minute keys', () => {
  const {createMesh}=require('./mesh.cjs');const mesh=createMesh({maxBuckets:8});
  for(let i=0;i<35;i++) mesh.observe({...sample, timestamp:new Date(1792188000000+i*60000).toISOString(),path:'/.env'});
  const result=mesh.snapshot();
  assert(result.buckets.length<=8);
  assert.equal(result.action,'observe');
});

test('CLI accepts official Railway NDJSON shape with fixed-size, privacy-safe output', () => {
  const input=[sample,{...sample,path:'/.env',httpStatus:404}, {...sample,path:'/.git/config',httpStatus:404},{...sample,path:'/wp-login.php',httpStatus:404}, {host:'evil.example',path:'/.env'},'malformed'];
  const proc=spawnSync(process.execPath,[join(__dirname,'monitor.cjs')],{
    input:input.map(row=>typeof row==='string'?row:JSON.stringify(row)).join('\n'),
    encoding:'utf8', timeout:4000,maxBuffer:1024*1024
  });
  assert.equal(proc.status,0,proc.stderr);
  const parsed=JSON.parse(proc.stdout);
  assert.equal(parsed.action,'observe');
  assert.equal(parsed.totals.observed,4);
  assert.equal(parsed.totals.rejected,2);
  assert.equal(parsed.findings.length,1);
  for (const forbidden of ['192.0.2.8','password-secret','client-secret','access-secret','/.git/config']) {
    assert.equal(proc.stdout.includes(forbidden),false);
  }
});

test('CLI fails independently on empty or oversized lines without reading live traffic',()=>{
  const input='X'.repeat(32768)+'\n';
  const result=spawnSync(process.execPath,[join(__dirname,'monitor.cjs')],{input,encoding:'utf8',timeout:4000});
  assert.equal(result.status,0);
  const output=JSON.parse(result.stdout);
  assert.equal(output.action,'observe');
  assert.equal(output.totals.rejected,1);
});

test('every ISB source file is isolated: no application import or active enforcement API', () => {
  const {readFileSync}=require('node:fs');
  for(const filename of ['observer.cjs','normalize.cjs','mesh.cjs','monitor.cjs']){
    const content=readFileSync(join(__dirname,filename),'utf8');
    assert.doesNotMatch(content, /(?:require|import)\s*\(?.*?(?:server\/|client\/|\.\.\/)/i);
    assert.doesNotMatch(content, /fetch\s*\(|https?\.request\s*\(|listen\s*\(|exec\s*\(|spawn\s*\(/);
    assert.doesNotMatch(content, /(?:block|challenge|redirect|deleteService|setVariables|updateService)\s*\(/);
  }
});

test('read-only Railway wrapper reads three services with no changes to application', () => {
  const {mkdtempSync,writeFileSync,readFileSync,rmSync} = require('node:fs');
  const {tmpdir} = require('node:os');
  const folder = mkdtempSync(join(tmpdir(),'isb-railway-test-'));
  const stub = join(folder,'railway');
  const callFile = join(folder,'calls.log');
  writeFileSync(stub, `#!/bin/sh
printf '%s\\n' "$*" >> "$ISB_TEST_CALLS"
case "$*" in
  *'--service Bad-Blue'*) host='legalwhat.com' ;;
  *'--service lexara-ddgs'*) host='lexara-ddgs-production.up.railway.app' ;;
  *'--service lexara-openserp'*) host='lexara-openserp-production.up.railway.app' ;;
  *) exit 3 ;;
esac
printf '{"host":"%s","path":"/.env","httpStatus":404,"timestamp":"2026-10-16T22:01:30Z"}\\n' "$host"
`,{mode:0o755});
  try {
    const r=spawnSync('bash',[join(__dirname,'collect.sh')],{env:{...process.env,PATH:folder+':'+process.env.PATH,ISB_TEST_CALLS:callFile},encoding:'utf8',timeout:4000});
    assert.equal(r.status,0,r.stderr);
    const result=JSON.parse(r.stdout);
    assert.equal(result.totals.observed,3);
    assert.equal(result.findings[0].kind,'probe-burst');
    const calls=readFileSync(callFile,'utf8').trim().split('\n');
    assert.equal(calls.length,3);
    for(const command of calls) {
      assert.match(command,/^logs --http --json --lines 500 --project [a-f0-9-]+ --environment production --service /);
      assert.doesNotMatch(command,/deploy|restart|update|delete|set-variables|edge-rules/);
    }
  } finally {rmSync(folder,{recursive:true,force:true});}
});

test('Railway wrapper stops safely when monitoring source is absent', () => {
  const {mkdtempSync,writeFileSync,rmSync} = require('node:fs');
  const {tmpdir} = require('node:os');
  const folder=mkdtempSync(join(tmpdir(),'isb-cli-fail-'));
  writeFileSync(join(folder,'railway'),'#!/bin/sh\nexit 42\n',{mode:0o755});
  try {
    const r=spawnSync('bash',[join(__dirname,'collect.sh')],{env:{...process.env,PATH:folder+':'+process.env.PATH},encoding:'utf8',timeout:4000});
    assert.notEqual(r.status,0);
    assert.equal(r.stdout.includes('credentials'),false);
  } finally {rmSync(folder,{recursive:true,force:true});}
});
