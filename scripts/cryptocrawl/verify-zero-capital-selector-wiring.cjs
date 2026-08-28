'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const discovery = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts'), 'utf8');
const preselection = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/discovery/zero-capital-route-preselection.ts'), 'utf8');
const checks = [
  ['Selector receives route array first', discovery.includes('selectZeroCapitalRoutesForQuote(enriched.routes, enriched.gasCostUsd)')],
  ['Old three-argument wiring removed', !discovery.includes('selectZeroCapitalRoutesForQuote(chain, enriched.routes, enriched.gasCostUsd)')],
  ['Selector contract remains routes plus gas cost', preselection.includes('routes: ConfiguredZeroCapitalRoute[]') && preselection.includes('gasCostUsd: number')],
  ['Structural route coverage preserved', discovery.includes('buildDynamicZeroCapitalRouteTemplates(chain)')],
  ['Measured gas enrichment preserved', discovery.includes('enrichMeasuredGasCost(chain as ChainId, templates)')],
  ['Quoted-route execution path preserved', discovery.includes('quoteConfiguredZeroCapitalRoutesForChain(chain, provider, selected)')],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
console.log('Zero-capital route selector wiring verification passed.');
