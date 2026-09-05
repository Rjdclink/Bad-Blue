'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const resource = read('server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts');
const canonical = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const engine = read('server/services/cryptocrawl/core/zero-capital-engine.ts');
const failures = [];
const requireText = (text, needle, label) => {
  if (!text.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (text, needle, label) => {
  if (text.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};
const requirePattern = (text, pattern, label) => {
  if (!pattern.test(text)) failures.push(`${label}: required pattern ${pattern}`);
};

requireText(source, 'if (opportunity.expectedProfit <= 0n) return true;', 'non-positive observation may reach measured provider repricing');
requireText(source, 'return originalCryptaraAdmission(opportunity);', 'positive base candidates retain original Cryptara authority');
requireText(source, 'const netProfit = grossProfit - allInCost;', 'measured provider economics recompute strict all-in net');
requireText(source, 'if (netProfit <= 0n)', 'non-positive measured provider result is observation only');
requireText(source, 'const cryptaraAllowed = !target.executionEnabled || await originalCryptaraAdmission(opportunity);', 'provider-rescued positive is rechecked by original Cryptara gate');
requireText(source, 'if (!cryptaraAllowed)', 'Cryptara rejection blocks provider-rescued candidate');
requireText(source, "'strict_positive_repriced_net'", 'provider selection registry requires strict positive repriced net');
requireText(source, "'cryptara_rechecked_after_positive_provider_reprice'", 'provider selection records post-reprice Cryptara provenance');
requireText(source, 'repriced.push(opportunity);', 'only surviving repriced candidates leave provider wrapper');
requireText(source, 'flashLoanProviderSelectionRegistry.remove(opportunity.id);', 'provider selection is cleared before fresh measurement and on failure');
requireText(source, 'fresh_quote_after_provider_receiver_permissions', 'provider receiver state mutation invalidates old quotes');
requireText(source, 'remainingAavePermissions.length === 0', 'Aave route permissions remain verified after mutation');
requireText(source, 'remainingMorphoPermissions.length === 0', 'Morpho route permissions remain verified after mutation');
requireText(source, 'selectMeasuredFlashLoanProvider', 'provider choice still requires measured fee/liquidity');
requireText(source, 'calculateMeasuredFlashLoanFee', 'selected provider fee remains exact measured rate');

requirePattern(
  resource,
  /if \(!positive\)\s*\{[\s\S]{0,900}?admittedConfigured\.push\(opportunity\);\s*continue;/,
  'configured near miss survives inner resource wrapper for downstream provider repricing',
);
requirePattern(
  resource,
  /if \(!positive\)\s*\{[\s\S]{0,900}?dynamic\.push\(opportunity\);\s*continue;/,
  'dynamic near miss survives inner resource wrapper for downstream provider repricing',
);
requireText(resource, 'const executableCapability = positive && receiverReady && fundingReady;', 'configured observation cannot become executable before positive economics');
requireText(resource, 'const executableCapability = positive && fundingReady && receiverReady && permissionReady;', 'dynamic observation cannot become executable before positive economics');

const resourceWiringIndex = canonical.indexOf("install('zero_capital_resource'");
const providerWiringIndex = canonical.indexOf("install('zero_capital_flash_provider'");
if (resourceWiringIndex < 0 || providerWiringIndex < 0 || resourceWiringIndex >= providerWiringIndex) {
  failures.push('canonical wrapper order must keep resource discovery inside measured provider repricing');
}

requireText(engine, 'if (opportunity.expectedProfit <= 0n || Date.now() > opportunity.expiresAt) continue;', 'central queue still rejects non-positive opportunities after all scan wrappers');
requireText(engine, 'if (!await this.isAllowedByCryptara(opportunity))', 'execution-time Cryptara recheck remains authoritative');
requireText(engine, '!stageManager.isMarketOperationsAllowed() || !stageManager.canExecuteTrades()', 'governance execution gate remains authoritative');
forbidText(source, 'executionAuthority: true', 'flash provider wrapper cannot grant execution authority');
forbidText(resource, 'synthetic_evidence:true', 'resource passthrough cannot introduce synthetic evidence');
forbidText(source, 'synthetic_evidence:true', 'synthetic provider evidence cannot be introduced');

if (failures.length) {
  console.error('[flash-provider-rescue-path] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('[flash-provider-rescue-path] PASS — configured/dynamic near misses reach measured provider repricing, while only strict-positive repriced economics can survive the provider wrapper and central queue, Cryptara, governance, receiver, freshness and terminal gates remain intact');
