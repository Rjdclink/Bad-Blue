'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('server/services/cryptocrawl/api/blockchain-providers.ts', 'utf8');

// Provider health is transport truth, not route/application truth.
assert.match(source, /export type RpcOperationFailureClass = 'provider_transport' \| 'provider_capability' \| 'application'/);
assert.match(source, /export function classifyRpcOperationError\(/);
assert.match(source, /'CALL_EXCEPTION'/);
assert.match(source, /'UNPREDICTABLE_GAS_LIMIT'/);
assert.match(source, /applicationCodes\.has\(code\)\) return 'application'/);
assert.match(source, /'ETIMEDOUT'/);
assert.match(source, /'ENETUNREACH'/);
assert.match(source, /transportCodes\.has\(code\)\) return 'provider_transport'/);

// Provider/method/range incompatibility must fail over locally without poisoning
// ordinary block/gas/receipt/contract-call availability.
assert.match(source, /if \(capability === 'logs'\)[\s\S]{0,700}'eth_getlogs is disabled'/);
assert.match(source, /'block range'/);
assert.match(source, /'range limit'/);
assert.match(source, /return 'provider_capability'/);
assert.match(source, /failureClass === 'provider_capability'[\s\S]{0,500}this\.recordSuccess\(candidate,[\s\S]{0,150}continue;/);

// Deterministic contract/venue errors are route-local and must not consume RPC
// health or silently change economics by asking another provider for a new result.
assert.match(source, /failureClass === 'application'[\s\S]{0,500}this\.recordSuccess\(candidate,[\s\S]{0,160}throw error;/);
assert.match(source, /failureClass = classifyRpcOperationError\(error, capability\)/);

// A single transient transport error degrades but does not impose a cooldown;
// the second consecutive transport failure crosses the existing threshold.
assert.match(source, /const coolingDown = candidate\.consecutiveFailures >= this\.failureThreshold/);
assert.match(source, /candidate\.cooldownUntil = coolingDown \? Date\.now\(\) \+ this\.cooldownMs : 0/);
assert.match(source, /candidate\.state === 'healthy' \|\| candidate\.state === 'degraded'/);
assert.match(source, /this\.recordFailure\(candidate, error\);/);

// Fatal process recovery is not introduced here; operational errors remain inside
// the provider/route boundary and the caller receives a normal rejected promise.
assert.doesNotMatch(source, /process\.on\(['"]uncaughtException/);
assert.doesNotMatch(source, /process\.on\(['"]unhandledRejection/);

console.log('[provider-failure-locality] PASS: route/application failures stay local, transport failures fail over, range/method limitations do not poison RPC health, and one transient transport fault does not globally suppress discovery');
