'use strict';
// This handler serves only fake ISB paths (standalone or under /__isb__/ in Bad-Blue), never real application routes.
const {classify} = require('./observer.cjs');
const {createIronBubbles} = require('./bubbles.cjs');

function createDecoyHandler(options = {}) {
  const bubbles = options.bubbles || createIronBubbles();
  const probeThreshold = Number.isInteger(options.probeThreshold) && options.probeThreshold >= 2 && options.probeThreshold <= 100 ? options.probeThreshold : 3;
  const maxExamined = Number.isInteger(options.maxExamined) && options.maxExamined >= 1 && options.maxExamined <= 10000 ? options.maxExamined : 1000;
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  let windowStart = clock(), examined = 0, requestCount = 0, probes = 0, popped = false;

  function handler(req, res) {
    // No forwarding, redirects, cookies, credential handling or application connectivity.
    // Respond before doing any observational processing; observation is best-effort.
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store',
        'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'"});
      res.end('ok\n');
      return;
    }
    if (req.method === 'GET' && req.url === '/robots.txt') {
      const body = 'User-agent: *\n' + bubbles.publicPaths().map(path=>'Disallow: '+path+'\n').join('');
      res.writeHead(200, {'content-type':'text/plain; charset=utf-8','cache-control':'no-store',
        'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'"});
      res.end(body);
      return;
    }
    res.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'"
    });
    res.end(req.method === 'HEAD' ? undefined : 'Not found\n');
    requestCount++;
    try {
      const now = clock();
      if (now - windowStart >= 60000 || now < windowStart) {
        windowStart = now; examined = 0; probes = 0;
      }
      if (examined >= maxExamined) return;
      examined++;
      // Use only transient route shape. Ignore request headers, origin IP, and body.
      const path = typeof req.url === 'string' ? req.url.slice(0,2048) : '';
      const signal = classify({host:'legalwhat.com',path});
      const decoyBait = bubbles.publicPaths(32).includes(path.split('?')[0]);
      if(signal.level !== 'suspicious' && !decoyBait)return;
      probes++;
      const severity = probes >= probeThreshold ? 'hard' : 'soft';
      const effect=bubbles.react({severity,channel:'decoy'});
      if(effect.enforcement==='decoys-only') popped=true;
    } catch { /* decoy analytics cannot interrupt any client, even the decoy */ }
  }
  function snapshot() {
    return Object.freeze({mode:'isolated-decoy',action:'observe',enforcement:popped?'decoys-only':'none',
      requestCount, examined, suspiciousProbes:probes, bubbleHealth:bubbles.status()});
  }
  return Object.freeze({handler,snapshot});
}
module.exports = {createDecoyHandler};
