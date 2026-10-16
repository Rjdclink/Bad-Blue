'use strict';
// ISB: deliberately out of path. No network calls, decisions, credentials, or app imports.
const HOSTS = new Set(['legalwhat.com', 'www.legalwhat.com', 'bad-blue-production.up.railway.app']);
const PROBES = [/^\/(?:\.env(?:[./]|$)|\.git(?:\/|$)|\.svn(?:\/|$))/i, /^\/(?:wp-admin|wp-login\.php|xmlrpc\.php)(?:\/|$)/i, /^\/(?:actuator\/env|server-status)(?:\/|$)/i];
function classify(event) {
  const base = {scope:'none',level:'ignored',action:'observe'};
  try {
    if (!event || typeof event !== 'object') return base;
    const host = String(event.host || '').toLowerCase().split(':')[0];
    if (!HOSTS.has(host)) return base;
    const path = String(event.path || '').split('?')[0].slice(0,2048);
    return {scope:'legalwhat',level:PROBES.some(p=>p.test(path))?'suspicious':'normal',action:'observe'};
  } catch { return base; }
}
module.exports = {classify};
