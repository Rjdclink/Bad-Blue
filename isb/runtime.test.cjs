'use strict';
const {test} = require('node:test');
const assert=require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const {join}=require('node:path');
const http=require('node:http');
const BIN=join(__dirname,'run-decoy.cjs');

test('decoy refuses to start without explicit separate-service confirmation',()=>{
  const out=spawnSync(process.execPath,[BIN],{env:{...process.env,ISB_DECOY_ISOLATED:''},encoding:'utf8',timeout:3000});
  assert.notEqual(out.status,0);
  assert.match(out.stderr,/separate.*isolated|isolated.*service/i);
  assert(!out.stdout.includes('password'));
});

test('isolated runtime serves decoy bait on local ephemeral port, then shuts down cleanly',async()=>{
  const child=spawn(process.execPath,[BIN],{
    env:{...process.env,ISB_DECOY_ISOLATED:'1',ISB_BIND:'127.0.0.1',ISB_PORT:'0',ISB_ROTATE_MS:'500'},
    stdio:['ignore','pipe','pipe']
  });
  let raw='';let err='';
  child.stderr.on('data',d=>err+=d.toString());
  const port=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('timed out: '+err));},3000);
    child.once('error',e=>{clearTimeout(timeout);reject(e)});
    child.stdout.on('data',d=>{
      raw+=d.toString();
      const m=raw.match(/ISB_DECOY_READY port=(\d+)/);
      if(m){clearTimeout(timeout);resolve(Number(m[1]))}
    });
  });
  try {
    const req=await new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path:'/robots.txt',timeout:1000},res=>{
      let b='';res.on('data',d=>b+=d);res.on('end',()=>resolve({status:res.statusCode,body:b}));
    }).on('error',reject));
    assert.equal(req.status,200);
    assert.match(req.body,/__isb__/);
    assert(!raw.includes('legalwhat.com'));
  }finally{
    child.kill('SIGTERM');
    await new Promise(resolve=>{child.once('close',resolve);setTimeout(resolve,2500).unref()});
  }
  assert.equal(child.exitCode,0,err);
});
