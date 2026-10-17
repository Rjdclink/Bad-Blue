#!/usr/bin/env node
'use strict';
// Separate decoy ONLY. No connection to LegalWhat and no proxy to applications.
const http=require('node:http');
const {createIronBubbles}=require('./bubbles.cjs');
const {createDecoyHandler}=require('./decoy.cjs');

function run(env=process.env) {
  if(env.ISB_DECOY_ISOLATED !== '1') {
    process.stderr.write('ISB decoy requires an explicitly isolated service.\n');
    process.exitCode=2;return null;
  }
  const bind=env.ISB_BIND||'127.0.0.1';
  if(!['127.0.0.1','0.0.0.0'].includes(bind) || (bind==='0.0.0.0' && env.ISB_BIND_PUBLIC!=='1')) {
    process.stderr.write('ISB decoy requires an explicitly isolated public binding.\n');
    process.exitCode=2;return null;
  }
  const port=env.ISB_PORT===undefined?8080:Number(env.ISB_PORT);
  if(!Number.isInteger(port)||port<0||port>65535){process.exitCode=2;return null;}
  const rotMs=Number(env.ISB_ROTATE_MS||60000);
  if(!Number.isInteger(rotMs)||rotMs<100||rotMs>86400000){process.exitCode=2;return null;}
  const bubbles=createIronBubbles({size:128,rotationMs:rotMs});
  const decoy=createDecoyHandler({bubbles});
  const server=http.createServer({maxHeaderSize:8192,requestTimeout:3000,headersTimeout:2500},decoy.handler);
  server.maxHeadersCount=40;
  const timer=setInterval(()=>bubbles.tick(),Math.min(rotMs,5000));
  timer.unref();
  let stopped=false;
  const stop=()=>{
    if(stopped)return;stopped=true;clearInterval(timer);
    server.close(()=>{process.exitCode=0;});
    server.closeAllConnections?.();
  };
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  server.once('error',()=>{clearInterval(timer);process.stderr.write('ISB decoy failed to start.\n');process.exitCode=2;});
  server.listen(port,bind,()=>{
    process.stdout.write('ISB_DECOY_READY port='+server.address().port+'\n');
  });
  return Object.freeze({server,stop,decoy});
}
if(require.main===module)run();
module.exports={run};
