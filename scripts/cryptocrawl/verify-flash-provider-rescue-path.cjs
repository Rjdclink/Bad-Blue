'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const engine = read('server/services/cryptocrawl/core/zero-capital-engine.ts');
const failures = [];
const requireText = (text, needle, label) => {
  if (!text.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (text, needle, label) => {
  if (text.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

requireText(source, 'if (opportunity.expectedProfit <= 0n) return true;', 'non-positive observation may reach measured provider repricing');
requireText(source, 'return originalCryptaraAdmission(opportunity);', 'positive base candidates retain original Cryptara authority');
requireText(source, 'const netProfit = grossProfit - allInCost;', 'measured provider economics recompute strict all-in net');
requireText(source, 'if (netProfit <= 0n)', 'non-positive measured provider result is observation only');
requireText(source, 'const cryptaraAllowed = !target.executionEnabled || await originalCryptaraAdmission(opportunity);', 'provider-rescued positive is rechecked by original Cryptara gate');
requireText(source, 'if (!cryptaraAllowed)', 'Cryptara rejection blocks provider-rescued candidate');
requireText(source, "'strict_positive_repriced_net'", 'provider selection registry requires strict positive repriced net');
requireText(source, "'cryptara_rechecked_after_positive_provider_reprice'", 'provider selection records post-reprice Cryptara provenance');
requireText(source, 'repriced.push(opportunity);', 'only surviving repriced candidates leave wrapper');
requireText(source, 'flashLoanProviderSelectionRegistry.remove(opportunity.id);', 'provider selection is cleared before fresh measurement and on failure');
requireText(source, 'fresh_quote_after_aave_receiver_permissions', 'state mutation still invalidates old quotes');
requireText(source, 'remainingAavePermissions.length === 0', 'Aave route permissions remain verified after mutation');
requireText(source, 'selectMeasuredFlashLoanProvider', 'provider choice still requires measured fee/liquidity');
requireText(source, 'calculateMeasuredFlashLoanFee', 'selected provider fee remains exact measured rate');
requireText(engine, 'if (opportunity.expectedProfit <= 0n || Date.now() > opportunity.expiresAt) continue;', 'central queue still rejects non-positive opportunities');
requireText(engine, 'if (!await this.isAllowedByCryptara(opportunity))', 'execution-time Cryptara recheck remains authoritative');
requireText(engine, '!stageManager.isMarketOperationsAllowed() || !stageManager.canExecuteTrades()', 'governance execution gate remains authoritative');
forbidText(source, 'executionAuthority: true', 'flash provider wrapper cannot grant execution authority');
forbidText(source, 'synthetic_evidence:true', 'synthetic provider evidence cannot be introduced');

if (failures.length) {
  console.error('[flash-provider-rescue-path] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('[flash-provider-rescue-path] PASS — measured flash-provider repricing can rescue observation-only near misses, while strict positive economics, original Cryptara approval, governance, receiver permissions, freshness and terminal execution gates remain intact');
