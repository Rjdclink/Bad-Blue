'use strict';
// Privacy firewall: Railway's raw logs contain personal data. Never re-emit raw fields.
const {classify} = require('./observer.cjs');
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function categoryFor(path, level) {
  if (level === 'suspicious') return 'probe';
  if (/^\/(?:api\/)?(?:local-login|local-signup|login|signup)(?:\/|$)/i.test(path) ||
      /^\/api\/auth(?:\/|$)/i.test(path)) return 'authentication';
  if (/^\/(?:api\/)?(?:square|subscription|subscriptions|checkout|trial)(?:\/|$)/i.test(path)) return 'billing';
  if (/^\/api(?:\/|$)/i.test(path)) return 'application-api';
  return 'other';
}

function normalize(raw) {
  try {
    if (!raw || Array.isArray(raw) || typeof raw !== 'object' ||
        typeof raw.host !== 'string' || typeof raw.path !== 'string') return null;
    const decision = classify(raw);
    if (decision.scope !== 'legalwhat') return null;
    const host = raw.host.trim().toLowerCase().split(':')[0];
    // Use paths transiently for classification; never return or persist paths.
    const path = raw.path.slice(0, 2048).split(/[?#]/, 1)[0];
    const time = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : NaN;
    const minute = Number.isFinite(time) ? new Date(time).toISOString().slice(0, 16) + 'Z' : 'unknown';
    const status = Number(raw.httpStatus ?? raw.status);
    const statusClass = Number.isInteger(status) && status >= 100 && status <= 599 ?
      Math.floor(status / 100) + 'xx' : 'unknown';
    const method = typeof raw.method === 'string' ? raw.method.toUpperCase() : '';
    return Object.freeze({
      scope: 'legalwhat', host, minute, statusClass,
      method: METHODS.has(method) ? method : 'OTHER',
      category: categoryFor(path, decision.level),
      level: decision.level, action: 'observe'
    });
  } catch {
    return null; // Telemetry failures must never affect protected services.
  }
}
module.exports = {normalize};
