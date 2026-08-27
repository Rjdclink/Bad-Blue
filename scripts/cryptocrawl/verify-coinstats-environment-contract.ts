import assert from 'node:assert/strict';
import {
  adoptResolvedEnvironmentVariable,
  COINSTATS_ENV_ALIASES,
  resolveCoinStatsEnvironment,
} from '../../server/services/cryptocrawl/runtime/environment-contract.js';

const names = ['COINSTATS_API_KEY', ...COINSTATS_ENV_ALIASES];
const original = new Map(names.map(name => [name, process.env[name]]));

function clear(): void {
  for (const name of names) delete process.env[name];
}

try {
  clear();
  let resolution = resolveCoinStatsEnvironment();
  assert.equal(resolution.state, 'NOT_VISIBLE');
  assert.equal(resolution.sourceName, null);

  process.env.COINSTATS_API_KEY_RAILWAY = 'railway-test-key-123456';
  resolution = resolveCoinStatsEnvironment();
  assert.equal(resolution.state, 'VISIBLE');
  assert.equal(resolution.sourceName, 'COINSTATS_API_KEY_RAILWAY');
  assert.equal(adoptResolvedEnvironmentVariable(resolution), true);
  assert.equal(process.env.COINSTATS_API_KEY, 'railway-test-key-123456');

  // Canonical always wins if it is already present; alias adoption must never
  // overwrite an explicit canonical runtime value.
  process.env.COINSTATS_API_KEY = 'canonical-test-key-654321';
  process.env.COIN_STATS_API_TOKEN = 'alias-test-key-111111';
  resolution = resolveCoinStatsEnvironment();
  assert.equal(resolution.sourceName, 'COINSTATS_API_KEY');
  assert.equal(adoptResolvedEnvironmentVariable(resolution), false);
  assert.equal(process.env.COINSTATS_API_KEY, 'canonical-test-key-654321');

  clear();
  process.env.COINSTAT_API_KEY = 'singular-test-key-222222';
  resolution = resolveCoinStatsEnvironment();
  assert.equal(resolution.state, 'VISIBLE');
  assert.equal(resolution.sourceName, 'COINSTAT_API_KEY');
  assert.equal(adoptResolvedEnvironmentVariable(resolution), true);

  console.log('CoinStats environment contract verification passed');
} finally {
  clear();
  for (const [name, value] of original.entries()) {
    if (value !== undefined) process.env[name] = value;
  }
}
