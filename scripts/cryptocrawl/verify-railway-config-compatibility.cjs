'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const config = fs.readFileSync('railway.toml', 'utf8');
const dockerfile = fs.readFileSync('Dockerfile', 'utf8');

// A repository-root Dockerfile is auto-detected by Railway. Keep Config-as-Code
// deploy-only so obsolete/stale builder, Dockerfile-path, or start-command state
// cannot become a second authority before BuildKit starts.
assert.match(config, /\[deploy\]/);
assert.match(config, /healthcheckPath\s*=\s*"\/api\/health"/);
assert.match(config, /healthcheckTimeout\s*=\s*300/);
assert.match(config, /restartPolicyType\s*=\s*"ON_FAILURE"/);
assert.doesNotMatch(config, /^\s*\[build\]\s*$/m, 'root Dockerfile deployment redundantly overrides Railway build detection');
assert.doesNotMatch(config, /^\s*builder\s*=/m, 'Railway builder is redundantly overridden despite root Dockerfile auto-detection');
assert.doesNotMatch(config, /^\s*dockerfilePath\s*=/m, 'root Dockerfile path is redundantly overridden in Config-as-Code');
assert.doesNotMatch(config, /^\s*startCommand\s*=/m, 'Railway start command duplicates Docker CMD');
assert.doesNotMatch(
  config,
  /^\s*region\s*=\s*"(?:us-east1|us-west1|us-central1|europe-west1)"\s*$/m,
  'obsolete Railway region identifier can block deployment before Docker build starts',
);
assert.doesNotMatch(
  config,
  /^\s*\[services(?:\.|\])?/m,
  'legacy nested services blocks are not valid single-service Railway Config-as-Code',
);
assert.match(dockerfile, /^FROM\s+node:20-/m);
assert.match(dockerfile, /CMD\s*\[\s*"npm"\s*,\s*"start"\s*\]/);

console.log('[railway-config-compatibility] PASS: Railway config is deploy-only; root Dockerfile detection and Docker CMD are the sole build/start authorities, with no obsolete region or nested service block');
