'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`[okx-order-expiration] missing required source: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

function requirePattern(source, pattern, description) {
  if (!pattern.test(source)) throw new Error(`[okx-order-expiration] missing invariant: ${description}`);
}

function forbidPattern(source, pattern, description) {
  if (pattern.test(source)) throw new Error(`[okx-order-expiration] forbidden regression: ${description}`);
}

const authority = read('server/services/cryptocrawl/intelligence/cex-private-authority.ts');
const settlement = read('server/services/cryptocrawl/execution/cex-settlement.ts');
const maker = read('server/services/cryptocrawl/execution/post-only-maker-adapters.ts');
const hybrid = read('server/services/cryptocrawl/execution/hyper-hybrid-cex-execution.ts');

requirePattern(
  authority,
  /CRYPTO_OKX_ORDER_REQUEST_EXPIRY_MS'[\s\S]{0,80}2_000[\s\S]{0,30}500[\s\S]{0,30}5_000/,
  'OKX stale-write lifetime is bounded and configurable without becoming an unbounded timeout',
);

const pathSet = authority.match(/const\s+OKX_EXPIRABLE_ORDER_WRITE_PATHS\s*=\s*new Set\(\[([\s\S]*?)\]\);/);
if (!pathSet) throw new Error('[okx-order-expiration] missing invariant: explicit OKX expirable-order endpoint allowlist');
for (const endpoint of [
  '/api/v5/trade/order',
  '/api/v5/trade/batch-orders',
  '/api/v5/trade/amend-order',
  '/api/v5/trade/amend-batch-orders',
]) {
  if (!pathSet[1].includes(`'${endpoint}'`)) {
    throw new Error(`[okx-order-expiration] missing invariant: supported OKX expTime endpoint ${endpoint}`);
  }
}
if (/cancel|order-pending|order-history|fills/.test(pathSet[1])) {
  throw new Error('[okx-order-expiration] forbidden regression: expTime allowlist contains an unsupported cancel/query/history endpoint');
}

requirePattern(authority, /function\s+okxOrderExpirationHeaders\s*\(/, 'one shared OKX expTime header authority exists');
requirePattern(authority, /method\s*!==\s*'POST'[\s\S]{0,100}!OKX_EXPIRABLE_ORDER_WRITE_PATHS\.has\(path\)/, 'expTime is restricted to POST requests on the explicit supported endpoint allowlist');
requirePattern(authority, /OKX_ORDER_REQUEST_EXPIRED_BEFORE_SEND/, 'expired writes fail closed locally before network submission');
requirePattern(authority, /return\s*\{\s*expTime:\s*String\(Math\.floor\(expiresAtMs\)\)\s*\}/, 'OKX Unix-millisecond expiration is emitted as the REST expTime header');
requirePattern(authority, /\.\.\.okxOrderExpirationHeaders\(path,\s*method,\s*requestExpiresAtMs\)/, 'expTime is injected only at the shared physical HTTP submission boundary');
requirePattern(authority, /const\s+body\s*=\s*method\s*===\s*'POST'\s*\?\s*JSON\.stringify\(parameters\)\s*:\s*''/, 'expTime does not mutate the authenticated order payload');
requirePattern(authority, /\.update\(`\$\{timestamp\}\$\{method\}\$\{requestPath\}\$\{body\}`\)/, 'OKX signature authority remains unchanged and excludes expTime');

requirePattern(
  authority,
  /const\s+requestExpiresAtMs\s*=\s*method\s*===\s*'POST'[\s\S]{0,160}Date\.now\(\)\s*\+\s*OKX_ORDER_REQUEST_EXPIRY_MS/,
  'one absolute deadline is minted for an eligible order write',
);
requirePattern(
  authority,
  /executeOkxWithAdaptiveRetry\(lane,[\s\S]{0,260}requestExpiresAtMs/,
  'the same absolute deadline survives local pacing and adaptive retry instead of being extended after delay',
);

// Current live write families all converge on the shared /trade/order private authority.
requirePattern(
  settlement,
  /privateRequest\([\s\S]{0,220}okxPrivateRequest\(path,\s*method,\s*parameters/,
  'OKX settlement wrapper delegates to the shared private authority',
);
requirePattern(
  settlement,
  /this\.privateRequest\(\s*'\/api\/v5\/trade\/order'\s*,\s*'POST'/,
  'normal OKX IOC settlement order uses its shared private-authority wrapper',
);
requirePattern(settlement, /ordType:\s*'ioc'/, 'normal OKX settlement path retains IOC semantics');
requirePattern(maker, /okxPrivateRequest\(\s*'\/api\/v5\/trade\/order'[\s\S]{0,260}'POST'/, 'OKX post-only/RPI maker order uses shared private authority');
requirePattern(maker, /ordType\s*=\s*'rpi'|ordType:\s*orderStyle/, 'RPI/maker order style remains owned by the maker executor');
requirePattern(hybrid, /okxPrivateRequest\(\s*'\/api\/v5\/trade\/order'[\s\S]{0,260}'POST'/, 'OKX FOK child uses shared private authority');
requirePattern(hybrid, /ordType:\s*'fok'/, 'hybrid child retains FOK semantics');

for (const [name, source] of [
  ['settlement', settlement],
  ['maker', maker],
  ['hybrid', hybrid],
]) {
  forbidPattern(source, /expTime/, `${name} executor duplicates exchange-deadline authority instead of using the shared private boundary`);
}

console.log('[okx-order-expiration] PASS: supported OKX order writes carry one fixed exchange-side expTime through the shared private authority; stale retries fail closed while IOC/FOK/maker/RPI and canonical economics/settlement authority remain unchanged');
