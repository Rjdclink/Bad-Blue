#!/usr/bin/env node
'use strict';
// The independent ISB constellation: no middleware, proxy, Square or auth integration.
const http=require('node:http');
const {createIronBubbles}=require('./bubbles.cjs');
const {createDecoyHandler}=require('./decoy.cjs');
const {createConstellation}=require('./constellation.cjs');

async function createISBRuntime(options={}) {
  const env=options.env||process.env;
  if(env.ISB_SERVICE_ISOLATED!=='1')throw Error('ISB requires a separate isolated service');
  const bind=env.ISB_BIND||'127.0.0.1';
  if(!['127.0.0.1','0.0.0.0'].includes(bind))throw Error('Invalid isolated bind address');
  if(bind!=='127.0.0.1')throw Error('Unified ISB must remain loopback-only; observation credentials and public decoys must be isolated');
  const port=env.ISB_PORT===undefined?8080:Number(env.ISB_PORT);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid ISB port');
  const pollSec=env.ISB_POLL_SECONDS===undefined?120:Number(env.ISB_POLL_SECONDS);
  if(!Number.isInteger(pollSec)||pollSec<60||pollSec>3600)throw Error('Invalid polling interval');
  const bubbles=options.bubbles||createIronBubbles({size:128});
  const decoy=createDecoyHandler({bubbles});
  const constellation=createConstellation({agent:options.agent,bubbles});
  const server=http.createServer({maxHeaderSize:8192,requestTimeout:3000,headersTimeout:2500},decoy.handler);
  server.maxHeadersCount=40;
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,bind,()=>{server.off('error',reject);resolve();});
  });
  let stopped=false, busy=false;
  async function pollOnce() {return constellation.poll();}
  const timer=setInterval(async()=>{
    if(stopped)return;
    try{bubbles.tick();}catch{}
    if(busy)return;
    busy=true;
    try {
      const report=await pollOnce();
      if(typeof options.onReport==='function')options.onReport(report);
    }catch{}finally{busy=false;}
  },pollSec*1000);
  timer.unref();
  if(options.autoPoll!==false) {
    // Start asynchronously so a slow or unavailable Railway API cannot delay the decoy listener.
    void pollOnce().then(report=>options.onReport?.(report)).catch(()=>{});
  }
  async function stop() {
    if(stopped)return;
    stopped=true;clearInterval(timer);
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});
  }
  return Object.freeze({port:server.address().port,bubbles,decoy,pollOnce,stop});
}

if(require.main===module){
  createISBRuntime({onReport:report=>process.stdout.write(JSON.stringify(report)+'\n')}).then(runtime=>{
    process.stdout.write('ISB_ISOLATED_READY port='+runtime.port+'\n');
    const stop=()=>{void runtime.stop().then(()=>{process.exitCode=0;});};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }).catch(()=>{process.stderr.write('ISB isolated service unavailable.\n');process.exitCode=2;});
}
module.exports={createISBRuntime};
