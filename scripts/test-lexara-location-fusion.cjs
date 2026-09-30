const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const relative = 'server/lexara/LexaraJurisdictionResolver.ts';
const source = fs.readFileSync(path.join(root, relative), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: relative,
}).outputText;

let network = {
  locality: 'Omaha',
  state: 'Nebraska',
  area: 'Omaha area',
  provider: 'dbip-local',
  confidence: 0.55,
};

const module = { exports: {} };
const localRequire = spec => {
  if (spec === './LocalNetworkJurisdiction') {
    return { resolveLocalNetworkJurisdiction: async () => network };
  }
  throw new Error(`Unexpected dependency: ${spec}`);
};

async function fakeFetch(url) {
  if (!String(url).includes('geocoding.geo.census.gov/geocoder/geographies/coordinates')) {
    return { ok: false, json: async () => ({}) };
  }
  return {
    ok: true,
    json: async () => ({
      result: {
        geographies: {
          Counties: [{ NAME: 'Minnehaha County' }],
          'Incorporated Places': [{ NAME: 'Sioux Falls city' }],
          States: [{ NAME: 'South Dakota' }],
        },
      },
    }),
  };
}

vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
  console,
  process: { env: {} },
  fetch: fakeFetch,
  AbortController,
  setTimeout,
  clearTimeout,
}, { filename: relative })(localRequire, module, module.exports);

(async () => {
  const resolver = module.exports;

  const fused = await resolver.resolveBestLocationEstimate('203.0.113.10', {
    latitude: 43.5446,
    longitude: -96.7311,
    accuracyMeters: 25,
  });
  assert.equal(fused.state, 'South Dakota');
  assert.match(fused.locality, /Sioux Falls/i);
  assert.equal(fused.provider, 'browser-geolocation');
  assert.ok(fused.confidence >= 0.95);
  assert.deepEqual(Array.from(fused.sources), ['browser-geolocation']);

  const ipOnly = await resolver.resolveBestLocationEstimate('203.0.113.10');
  assert.equal(ipOnly.state, 'Nebraska');
  assert.equal(ipOnly.provider, 'dbip-local');
  assert.equal(ipOnly.confidence, 0.55);

  network = {
    locality: 'Sioux Falls',
    state: 'South Dakota',
    area: 'Sioux Falls area',
    provider: 'dbip-local',
    confidence: 0.55,
  };
  const agreed = await resolver.resolveBestLocationEstimate('203.0.113.11', {
    latitude: 43.5446,
    longitude: -96.7311,
    accuracyMeters: 25,
  });
  assert.equal(agreed.state, 'South Dakota');
  assert.equal(agreed.provider, 'browser-geolocation+dbip-local');
  assert.deepEqual(Array.from(agreed.sources), ['browser-geolocation', 'dbip-local']);
  assert.ok(agreed.confidence > fused.confidence);

  console.log('PASS: Lexara location fusion prefers permitted device evidence, retains IP fallback, and rewards independent agreement.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
