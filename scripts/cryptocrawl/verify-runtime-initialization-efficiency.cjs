'use strict';

const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const requirePattern = (source, pattern, description) => {
  if (!pattern.test(source)) throw new Error(`[runtime-initialization-efficiency] missing invariant: ${description}`);
};
const forbidPattern = (source, pattern, description) => {
  if (pattern.test(source)) throw new Error(`[runtime-initialization-efficiency] forbidden regression: ${description}`);
};

const geoconsole = read('server/services/geoconsole/index.ts');
const inputFusion = read('server/services/geoconsole/inputFusionEngine.ts');
const monteCarlo = read('server/services/geoconsole/monteCarloPathEngine.ts');
const serverIndex = read('server/index.ts');
const canonicalHarvester = read('server/subAgentHarvester.ts');

// The engine modules already own canonical defaults. The default HybridGeoconsole
// must reuse them instead of constructing a duplicate pair during route import.
requirePattern(inputFusion, /export\s+const\s+inputFusionEngine\s*=\s*new\s+InputFusionEngine\(\)/, 'InputFusion canonical singleton remains available');
requirePattern(monteCarlo, /export\s+const\s+monteCarloPathEngine\s*=\s*new\s+MonteCarloPathEngine\(\)/, 'MonteCarloPath canonical singleton remains available');
requirePattern(geoconsole, /import\s+\{\s*InputFusionEngine,\s*inputFusionEngine\s*\}/, 'HybridGeoconsole imports the canonical InputFusion default');
requirePattern(geoconsole, /import\s+\{\s*MonteCarloPathEngine,\s*monteCarloPathEngine\s*\}/, 'HybridGeoconsole imports the canonical MonteCarlo default');
requirePattern(geoconsole, /this\.inputFusionEngine\s*=\s*fusionConfig\s*\?\s*new\s+InputFusionEngine\(fusionConfig\)\s*:\s*inputFusionEngine/, 'default InputFusion initialization is shared while custom config remains isolated');
requirePattern(geoconsole, /this\.monteCarloEngine\s*=\s*monteCarloConfig\s*\?\s*new\s+MonteCarloPathEngine\(monteCarloConfig\)\s*:\s*monteCarloPathEngine/, 'default MonteCarlo initialization is shared while custom config remains isolated');
forbidPattern(geoconsole, /this\.inputFusionEngine\s*=\s*new\s+InputFusionEngine\(fusionConfig\)/, 'duplicate default InputFusion construction');
forbidPattern(geoconsole, /this\.monteCarloEngine\s*=\s*new\s+MonteCarloPathEngine\(monteCarloConfig\)/, 'duplicate default MonteCarlo construction');

// One officer-harvest scheduler owns startup. The retired Web Harvester must never
// be imported by the server entry because it initializes the same session manager
// and priority queue and creates a second timer/DB-read path.
requirePattern(serverIndex, /import\('\.\/subAgentHarvester'\)/, 'server starts the canonical Sub-Agent Harvester');
requirePattern(serverIndex, /const\s+\{\s*initializeHarvester\s*\}[\s\S]{0,180}await\s+initializeHarvester\(\s*\)/, 'server uses canonical harvester defaults instead of stale schedule overrides');
requirePattern(serverIndex, /Canonical Sub-Agent Harvester initialized \(36h adaptive interval\)/, 'startup log identifies the single canonical harvester schedule');
forbidPattern(serverIndex, /import\('\.\/subAgentWebHarvester'\)/, 'legacy Sub-Agent Web Harvester startup import');
forbidPattern(serverIndex, /Sub-Agent Web Harvester initialized|daily 2:30 UTC/, 'legacy duplicate harvester startup schedule');
forbidPattern(serverIndex, /dailyHarvestHourUTC|dailyHarvestMinuteUTC|maxSearchesPerCycle:\s*15/, 'stale startup overrides that compete with canonical harvester defaults');

requirePattern(canonicalHarvester, /private\s+initialized\s*=\s*false/, 'canonical harvester retains its idempotent initialization guard');
requirePattern(canonicalHarvester, /if\s*\(this\.initialized\)[\s\S]{0,140}Already initialized/, 'canonical harvester rejects duplicate initialization');
requirePattern(canonicalHarvester, /const\s+HARVEST_INTERVAL_HOURS\s*=\s*36/, 'canonical harvester owns the single bounded 36-hour schedule');
requirePattern(canonicalHarvester, /maxSearchesPerCycle:\s*7/, 'canonical reduced search-cycle budget remains active');

console.log('[runtime-initialization-efficiency] canonical Geo engines are reused; one canonical Sub-Agent Harvester owns startup, session/priority initialization, and the bounded 36h schedule');