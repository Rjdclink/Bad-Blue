'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const config = fs.readFileSync('railway.toml', 'utf8');
const dockerfile = fs.readFileSync('Dockerfile', 'utf8');

assert.match(config, /\[build\][\s\S]{0,160}builder\s*=\s*"DOCKERFILE"/);
assert.match(config, /dockerfilePath\s*=\s*"Dockerfile"/);
assert.match(config, /healthcheckPath\s*=\s*"\/api\/health"/);
assert.match(config, /startCommand\s*=\s*"npm start"/);
assert.doesNotMatch(
  config,
  /^\s*region\s*=\s*"(?:us-east1|us-west1|us-central1|europe-west1)"\s*$/m,
  'obsolete Railway region identifier can block deployment before Docker build starts',
);
assert.match(dockerfile, /^FROM\s+node:20-/m);

console.log('[railway-config-compatibility] PASS: root Dockerfile deployment is explicit and no obsolete pre-Metal region override can block deployment initialization');
