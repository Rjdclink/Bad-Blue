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

console.log('[runtime-initialization-efficiency] canonical Geo engines are reused by the default HybridGeoconsole; custom-config isolation remains available');
