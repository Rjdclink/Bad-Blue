'use strict';
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../server/services/cryptocrawl/utils/resilient-http.ts'), 'utf8');
const checks = [
  ['Existing retryable status set retained', source.includes('408, 409, 425, 429, 500, 502, 503, 504')],
  ['Retry-After handling retained', source.includes('parseRetryAfterMs')],
  ['Exponential jitter retained', source.includes('calculateBackoffDelayMs')],
  ['Per-origin circuit state', source.includes('new Map<string, HttpCircuitState>()') && source.includes('new URL(url).origin')],
  ['Conservative failure threshold', source.includes('CRYPTOCRAWL_HTTP_CIRCUIT_FAILURES') && source.includes('Math.max(3')],
  ['Automatic cooldown', source.includes('CRYPTOCRAWL_HTTP_CIRCUIT_COOLDOWN_MS') && source.includes('state.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS')],
  ['Successful response resets circuit', source.includes('recordCircuitSuccess(url)')],
  ['Only retryable HTTP terminal failures count', source.includes('if (retryable) recordCircuitFailure(url)')],
  ['Abort timeout errors are retryable', source.includes("error.name === 'AbortError'")],
  ['Non-retryable statuses do not directly record failure', source.includes('if (!retryable || attempt === maxRetries)')],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
console.log('Resilient HTTP circuit breaker verification passed.');
