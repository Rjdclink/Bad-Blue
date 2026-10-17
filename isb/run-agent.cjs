#!/usr/bin/env node
'use strict';
// Standalone Railway log observer. The only Railway subcommand it ever runs is 'logs'.
const {createRailwayAgent} = require('./agent.cjs');

async function run(argv=process.argv.slice(2),env=process.env,writer=process.stdout) {
  if(env.ISB_MONITOR_ISOLATED !== '1') {
    process.stderr.write('ISB monitoring must run in an isolated environment.\n');
    process.exitCode=2;return;
  }
  const watch = argv.length===1 && argv[0]==='--watch';
  const once = argv.length===1 && argv[0]==='--once';
  if (!once&&!watch) {process.stderr.write('Use --once or --watch.\n');process.exitCode=2;return;}
  const agent=createRailwayAgent();
  let stopped=false, wake=null;
  const stop=()=>{stopped=true;if(wake)wake();};
  process.once('SIGTERM',stop);
  process.once('SIGINT',stop);
  const minutes=Number(env.ISB_POLL_SECONDS||120);
  const period=Number.isInteger(minutes) && minutes>=60 && minutes<=3600 ? minutes*1000:120000;
  try {do {
    const report=await agent.collect();
    writer.write(JSON.stringify(report)+'\n');
    if(once) {if(report.status!=='complete')process.exitCode=2;return;}
    if(stopped)break;
    await new Promise(resolve=>{
      const wait=setTimeout(()=>{wake=null;resolve()},period);
      wake=()=>{clearTimeout(wait);wake=null;resolve()};
    });
  }while(!stopped);
  } finally {process.off('SIGTERM',stop);process.off('SIGINT',stop);}
}
if (require.main===module)run().catch(()=>{
  // Do not disclose raw CLI stderr, paths, or tokens.
  process.stderr.write('ISB monitoring unavailable.\n');process.exitCode=2;
});
module.exports={run};
