'use strict';
// ISB lives in the same Bad-Blue process, but never makes access decisions.
// Ordinary traffic passes through unchanged. Only /__isb__/ is an ISB-owned decoy.
const {createMesh} = require('./mesh.cjs');
const {classify} = require('./observer.cjs');
const {createIronBubbles} = require('./bubbles.cjs');
const {createDecoyHandler} = require('./decoy.cjs');

const DECOY_PREFIX = /^\/__isb__(?:\/|$)/;
const MAX_QUEUE = 256;
const MAX_PER_SECOND = 500;

function canonicalRoute(host, raw) {
  if (typeof raw !== 'string') return '/';
  const path = raw.slice(0, 2048).split(/[?#]/, 1)[0];
  if (classify({host,path}).level === 'suspicious') return '/.env';
  if (/^\/(?:api\/)?(?:local-login|login)(?:\/|$)/i.test(path) ||
      /^\/api\/auth(?:\/|$)/i.test(path)) return '/api/auth';
  if (/^\/(?:api\/)?(?:local-signup|signup)(?:\/|$)/i.test(path)) return '/signup';
  if (/^\/(?:api\/)?(?:square|subscription|subscriptions|checkout|trial)(?:\/|$)/i.test(path)) {
    return '/api/square';
  }
  if (/^\/api(?:\/|$)/i.test(path)) return '/api';
  return '/';
}

function createEmbeddedISB(options = {}) {
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const schedule = typeof options.schedule === 'function' ? options.schedule : setImmediate;
  const intervalFactory = typeof options.intervalFactory === 'function' ? options.intervalFactory : setInterval;
  const clearIntervalFn = typeof options.clearIntervalFn === 'function' ? options.clearIntervalFn : clearInterval;
  const maxQueue = Number.isInteger(options.maxQueue) && options.maxQueue >= 1 && options.maxQueue <= MAX_QUEUE ?
    options.maxQueue : MAX_QUEUE;
  const maxPerSecond = Number.isInteger(options.maxPerSecond) &&
    options.maxPerSecond >= 1 && options.maxPerSecond <= 2000 ? options.maxPerSecond : MAX_PER_SECOND;

  const mesh = options.mesh || createMesh({maxBuckets:90});
  const bubbles = options.bubbles || createIronBubbles({size:128, cryptoProvider:options.cryptoProvider});
  const decoy = createDecoyHandler({bubbles});
  const queue = [];
  let stopped = false, scheduled = false, second = -1, sampled = 0;
  let observed = 0, dropped = 0, softSignals = 0;
  let minute = '', minuteProbes = 0, lastShiftMinute = '';

  function flush() {
    scheduled = false;
    if (stopped) return;
    // Work is independent, bounded, and scheduled only after responses finish.
    const batch = queue.splice(0, 64);
    for (const event of batch) {
      try {
        mesh.observe(event);
        observed++;
        if (event.path === '/.env') {
          const currentMinute = event.timestamp.slice(0, 16);
          if (minute !== currentMinute) { minute = currentMinute; minuteProbes = 0; }
          minuteProbes++;
          if (minuteProbes >= 3 && lastShiftMinute !== currentMinute) {
            lastShiftMinute = currentMinute;
            bubbles.react({severity:'soft',channel:'decoy'});
            softSignals++;
          }
        }
      } catch {
        // A detector error must never propagate into application handling.
      }
    }
    if (queue.length > 0) queueFlush();
  }

  function queueFlush() {
    if (scheduled || stopped) return;
    scheduled = true;
    try {schedule(flush);} catch {
      scheduled = false;
      dropped += queue.length;
      queue.length = 0;
    }
  }

  function middleware(req, res, next) {
    if (stopped) return next();
    let path = '/', host = '', route = '';
    try {
      const original = typeof req.originalUrl === 'string' ? req.originalUrl : req.url;
      path = typeof original === 'string' ? original.slice(0, 2048).split(/[?#]/, 1)[0] : '/';
      if (DECOY_PREFIX.test(path)) {
        // Never rewrite real request URLs. The sham request is passed only to the
        // isolated decoy handler, which has no access to application data.
        const shamPath = path === '/__isb__/robots.txt' ? '/robots.txt'
          : path === '/__isb__/healthz' ? '/healthz' : path;
        try {
          decoy.handler({method:req.method,url:shamPath}, res);
          return;
        } catch {
          if (!res.headersSent) return next();
          return;
        }
      }
      host = typeof req.headers?.host === 'string' ? req.headers.host.toLowerCase().split(':')[0] : '';
      if (classify({host,path:'/'}).scope !== 'legalwhat') return next();
      route = canonicalRoute(host, path);
      const method = typeof req.method === 'string' ? req.method.slice(0, 16) : '';
      res.once('finish', () => {
        if (stopped) return;
        try {
          const now = clock();
          if (!Number.isFinite(now)) return;
          const currentSecond = Math.floor(now / 1000);
          if (second !== currentSecond) { second = currentSecond; sampled = 0; }
          if (++sampled > maxPerSecond || queue.length >= maxQueue) {
            dropped++;
            return;
          }
          // Sanitized before queuing: no original URL, query, credentials, IP, headers or body.
          queue.push({host,path:route,method,httpStatus:res.statusCode,
            timestamp:new Date(now).toISOString()});
          queueFlush();
        } catch {
          // A telemetry failure is invisible to LegalWhat's clients.
        }
      });
    } catch {
      // Instrumentation errors never stop the underlying request.
    }
    return next();
  }

  let timer = null;
  try {
    timer = intervalFactory(() => {
      if (stopped) return;
      try {
        bubbles.tick();
        if (typeof options.onHeartbeat === 'function') options.onHeartbeat(snapshot());
      } catch {}
    }, 60_000);
    if (timer && typeof timer.unref === 'function') timer.unref();
  } catch {}

  function snapshot() {
    let bubbleStatus = {shifted:0,pops:0,isolated:0};
    try { bubbleStatus = bubbles.status(); } catch {}
    return Object.freeze({mode:'passive',enforcement:'none',action:'observe',
      observed,dropped,queued:queue.length,softSignals,bubbles:bubbleStatus});
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    queue.length = 0;
    if (timer) {try {clearIntervalFn(timer);} catch {}}
  }
  return Object.freeze({middleware,snapshot,stop});
}

module.exports = {createEmbeddedISB};
