'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {join}=require('node:path');
const {mkdtempSync,writeFileSync,readFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const bin=join(__dirname,'run-agent.cjs');

test('agent cannot accidentally start without independent-monitor opt in',()=>{
  const p=spawnSync(process.execPath,[bin,'--once'],{env:{...process.env,ISB_MONITOR_ISOLATED:''},encoding:'utf8',timeout:3000});
  assert.notEqual(p.status,0);
  assert.equal(p.stdout.trim(),'');
  assert.match(p.stderr,/isolated/i);
});

test('one-shot standalone agent retrieves all sources and returns privacy-safe report',()=>{
  const folder=mkdtempSync(join(tmpdir(),'isb-agent-'));
  const file=join(folder,'railway'),calls=join(folder,'calls');
  writeFileSync(file,`#!/bin/sh
printf '%s\n' "$*" >> "$ISB_CALLS"
case "$*" in
  *'--service Bad-Blue'*) host='legalwhat.com' ;;
  *'--service lexara-ddgs'*) host='lexara-ddgs-production.up.railway.app' ;;
  *'--service lexara-openserp'*) host='lexara-openserp-production.up.railway.app' ;;
  *) exit 3 ;;
esac
printf '{"host":"%s","path":"/.env?PASSWORD=REDACT","httpStatus":404,"timestamp":"2026-10-16T23:22:12Z","srcIp":"IPSECRET","requestId":"fixture-11"}\n' "$host"
`,{mode:0o755});
  try {
    const p=spawnSync(process.execPath,[bin,'--once'],{env:{...process.env,ISB_MONITOR_ISOLATED:'1',PATH:folder+':'+process.env.PATH,ISB_CALLS:calls},encoding:'utf8',timeout:5000});
    assert.equal(p.status,0,p.stderr);
    const report=JSON.parse(p.stdout);
    assert.equal(report.status,'complete');
    assert.equal(report.report.totals.observed,3);
    assert(!p.stdout.includes('IPSECRET'));
    assert(!p.stdout.includes('PASSWORD'));
    const commands=readFileSync(calls,'utf8').trim().split('\n');
    assert.equal(commands.length,3);
    for(const args of commands)assert.match(args,/^logs --http --json --lines 500 --project /);
  }finally {rmSync(folder,{recursive:true,force:true});}
});

test('railway CLI error yields safely unavailable, no partial output',()=>{
  const folder=mkdtempSync(join(tmpdir(),'isb-agent-fail-'));
  const file=join(folder,'railway');
  writeFileSync(file,"#!/bin/sh\nprintf 'ERROR_SENSITIVE_X' >&2\nexit 9\n",{mode:0o755});
  try {
    const p=spawnSync(process.execPath,[bin,'--once'],{env:{...process.env,ISB_MONITOR_ISOLATED:'1',PATH:folder+':'+process.env.PATH},encoding:'utf8',timeout:5000});
    assert.notEqual(p.status,0);
    assert.equal(JSON.parse(p.stdout).status,'unavailable');
    assert(!p.stdout.includes('ERROR_SENSITIVE_X'));
    assert(!p.stderr.includes('ERROR_SENSITIVE_X'));
  }finally {rmSync(folder,{recursive:true,force:true});}
});
