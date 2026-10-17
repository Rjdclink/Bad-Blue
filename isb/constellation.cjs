'use strict';
// Coordinate passive observations and independent decoys. No production enforcement.
const {createRailwayAgent}=require('./agent.cjs');
const {createIronBubbles}=require('./bubbles.cjs');

function createConstellation(options={}) {
  const agent=options.agent||createRailwayAgent();
  const bubbles=options.bubbles||createIronBubbles();
  const seen=new Set();
  let polls=0, unavailable=0, advisories=0;
  async function poll() {
    let reading;
    try {reading=await agent.collect();}catch {reading={status:'unavailable',action:'observe',report:null};}
    polls++;
    if(reading?.status!=='complete' || reading?.report?.scope!=='legalwhat')unavailable++;
    else {
      for(const item of Array.isArray(reading.report.findings)?reading.report.findings:[]) {
        if(item?.kind!=='probe-burst' || typeof item.minute!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/.test(item.minute))continue;
        const key=item.minute;
        if(seen.has(key))continue;
        if(seen.size>=1024)seen.delete(seen.values().next().value);
        seen.add(key);advisories++;
        try {bubbles.react({severity:'soft',channel:'decoy'});}catch{}
      }
    }
    // Strict output allowlist: no raw logs, request IDs, usernames, routes or attacker IPs.
    return Object.freeze({version:1, mode:'passive',action:'observe',enforcement:'none',
      railway:{status:reading?.status==='complete'?'complete':'unavailable'},
      bubbles:bubbles.status(), counters:{polls,unavailable,advisories}});
  }
  return Object.freeze({poll,bubbles});
}
module.exports={createConstellation};
