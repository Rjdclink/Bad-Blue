'use strict';

// In-app ISB adapter: stays within Bad-Blue's existing listener and never
// reads credentials, body data, cookies, sessions, identities or payment payloads.
const {classify} = require('./observer.cjs');
const {createMesh} = require('./mesh.cjs');
const {createIronBubbles} = require('./bubbles.cjs');
const {createDecoyHandler} = require('./decoy.cjs');

const BAIT_PREFIX = '/__isb__/';

function installEmbeddedISB(app, options = {}) {
  if (!app || typeof app.use !== 'function') {
    throw new TypeError('ISB requires an Express application');
  }
  if (options.disabled === true || process.env.ISB_DISABLED === '1') {
    return Object.freeze({
      snapshot: () => Object.freeze({active: false, action: 'observe', enforcement: 'none'}),
      stop: () => {},
    });
  }

  // All state belongs only to the ISB module. Never proxy or wrap real routes.
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const bubbles = options.bubbles || createIronBubbles({size: 128, clock});
  const mesh = options.mesh || createMesh({maxBuckets: 16});
  const decoy = createDecoyHandler({bubbles, clock});
  const cap = Number.isInteger(options.maxProbesPerMinute) &&
    options.maxProbesPerMinute >= 1 && options.maxProbesPerMinute <= 1000 ?
    options.maxProbesPerMinute : 120;

  let minute = -1;
  let probesThisMinute = 0;
  let probes = 0;
  let decoyRequests = 0;
  let stopped = false;

  function passiveProbe(host, path, method, status) {
    try {
      if (stopped) return;
      const now = clock();
      if (!Number.isFinite(now)) return;
      const nextMinute = Math.floor(now / 60000);
      if (minute !== nextMinute) {
        minute = nextMinute;
        probesThisMinute = 0;
      }
      if (probesThisMinute >= cap) return;
      probesThisMinute += 1;
      probes += 1;
      mesh.observe({
        host,
        path, // Used transiently for classification, never logged or stored.
        method,
        httpStatus: status,
        timestamp: new Date(now).toISOString(),
      });
      // Both severity levels move ONLY fake ISB cells, never application traffic.
      bubbles.react({
        channel: 'decoy',
        severity: probesThisMinute >= 3 ? 'hard' : 'soft',
      });
    } catch {
      // ISB failures are deliberately invisible to the protected application.
    }
  }

  function middleware(req, res, next) {
    try {
      const host = typeof req.headers?.host === 'string' ? req.headers.host : '';
      const path = typeof req.path === 'string' ? req.path : '';
      const method = typeof req.method === 'string' ? req.method : '';
      const signal = classify({host, path});
      if (signal.scope === 'legalwhat') {
        if (path.startsWith(BAIT_PREFIX) && (method === 'GET' || method === 'HEAD')) {
          decoyRequests++;
          // Remap only ISB's private robots directory, NOT the real /robots.txt.
          const decoyPath = path === '/__isb__/robots.txt' ? '/robots.txt' : path;
          decoy.handler({method, url: decoyPath}, res);
          return;
        }
        if (signal.level === 'suspicious') {
          // Post-response, deferred observation: no blocking, waiting or rewriting.
          res.once('finish', () => {
            const status = res.statusCode;
            setImmediate(() => passiveProbe(host, path, method, status));
          });
        }
      }
    } catch {
      // A malformed probe cannot change application routing.
    }
    next();
  }

  app.use(middleware);
  const timer = options.autoTick === false ? null : setInterval(() => {
    if (stopped) return;
    try { bubbles.tick(); } catch {}
  }, 30_000);
  timer?.unref?.();

  function snapshot() {
    try {
      return Object.freeze({
        active: !stopped,
        action: 'observe',
        enforcement: 'none',
        mode: 'passive',
        probes,
        decoyRequests,
        bubbles: bubbles.status(),
        observed: mesh.snapshot().totals.observed,
      });
    } catch {
      return Object.freeze({active: !stopped, action: 'observe', enforcement: 'none', mode: 'degraded'});
    }
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
  }

  return Object.freeze({snapshot, stop});
}

module.exports = {installEmbeddedISB};
