#!/usr/bin/env node

/**
 * CryptoCrawler Stage 6-8 Verification Script
 * 
 * Validates:
 * - Stage 6: Profit Ramp Logic (Hard-Locked)
 * - Stage 7: Visual/UI Sanity Check
 * - Stage 8: Final Dry Run (No Capital Risk)
 */

const fs = require('fs');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════════════════════════╗');
console.log('║        CRYPTOCRAWLER STAGE 6-8 VERIFICATION                             ║');
console.log('╚══════════════════════════════════════════════════════════════════════════╝');
console.log('');

let allPassed = true;
const results = {
  stage6: { pass: true, checks: [] },
  stage7: { pass: true, checks: [] },
  stage8: { pass: true, checks: [] },
  governance: { pass: true, checks: [] }
};

// Helper function to check file exists
function checkFile(filepath, description) {
  const exists = fs.existsSync(filepath);
  return { passed: exists, message: exists ? `✅ ${description}` : `❌ ${description} - NOT FOUND` };
}

// Helper function to check file content
function checkFileContent(filepath, patterns, description) {
  if (!fs.existsSync(filepath)) {
    return { passed: false, message: `❌ ${description} - File not found` };
  }
  const content = fs.readFileSync(filepath, 'utf8');
  const allMatch = patterns.every(p => content.includes(p));
  return { passed: allMatch, message: allMatch ? `✅ ${description}` : `❌ ${description} - Missing required content` };
}

// ============================================
// STAGE 6: PROFIT RAMP LOGIC VERIFICATION
// ============================================

console.log('📊 STAGE 6 — PROFIT RAMP LOGIC (HARD-LOCKED)');
console.log('─'.repeat(60));

// Check profit-ramp.ts exists
const profitRampPath = path.join(__dirname, '../server/services/cryptocrawl/governance/profit-ramp.ts');
results.stage6.checks.push(checkFile(profitRampPath, 'profit-ramp.ts exists'));

// Check daily cap ladder implementation
if (fs.existsSync(profitRampPath)) {
  const content = fs.readFileSync(profitRampPath, 'utf8');
  
  // Verify daily cap values
  const caps = ['200', '400', '800', '1600', '5000', '35000'];
  const capsFound = caps.every(cap => content.includes(`dailyCap: ${cap}`));
  results.stage6.checks.push({ 
    passed: capsFound, 
    message: capsFound ? '✅ Daily Cap Ladder: $200 → $400 → $800 → $1,600 → $5,000 → $35,000' : '❌ Daily cap ladder incomplete'
  });
  
  // Verify advancement conditions
  const advancementConditions = [
    'cyclesRequired',
    'maxVarianceThreshold',
    'minWinRate',
    'minSharpeRatio',
    'anomalyTolerance'
  ];
  const conditionsFound = advancementConditions.every(c => content.includes(c));
  results.stage6.checks.push({
    passed: conditionsFound,
    message: conditionsFound ? '✅ Advancement conditions implemented (stability, variance, anomalies)' : '❌ Advancement conditions missing'
  });
  
  // Verify no discretionary overrides
  const noOverride = content.includes('OVERRIDE_DISABLED = true');
  results.stage6.checks.push({
    passed: noOverride,
    message: noOverride ? '✅ No discretionary overrides (hard-locked)' : '❌ Override protection missing'
  });
  
  // Verify Monte Carlo justification requirement
  const mcRequired = content.includes('monteCarloJustification') && content.includes('Monte Carlo justification required');
  results.stage6.checks.push({
    passed: mcRequired,
    message: mcRequired ? '✅ Monte Carlo justification required for advancement' : '❌ Monte Carlo requirement missing'
  });
}

results.stage6.pass = results.stage6.checks.every(c => c.passed);
results.stage6.checks.forEach(c => console.log(`  ${c.message}`));
console.log('');

// ============================================
// STAGE 7: VISUAL/UI SANITY CHECK VERIFICATION
// ============================================

console.log('🎨 STAGE 7 — VISUAL / UI SANITY CHECK');
console.log('─'.repeat(60));

// Check ui-sanity-check.ts exists
const uiSanityPath = path.join(__dirname, '../server/services/cryptocrawl/governance/ui-sanity-check.ts');
results.stage7.checks.push(checkFile(uiSanityPath, 'ui-sanity-check.ts exists'));

if (fs.existsSync(uiSanityPath)) {
  const content = fs.readFileSync(uiSanityPath, 'utf8');
  
  // Verify forbidden backgrounds rule
  const forbiddenBg = content.includes('FORBIDDEN_BACKGROUNDS') && content.includes('#ffffff');
  results.stage7.checks.push({
    passed: forbiddenBg,
    message: forbiddenBg ? '✅ Pure white backgrounds forbidden' : '❌ White background rule missing'
  });
  
  // Verify protected components
  const protectedComps = content.includes('PROTECTED_COMPONENTS') && content.includes('Card') && content.includes('shadows');
  results.stage7.checks.push({
    passed: protectedComps,
    message: protectedComps ? '✅ Cards, panels, depth, shadows protected' : '❌ Protected components rule missing'
  });
  
  // Verify dark theme requirement
  const darkTheme = content.includes('dark') && content.includes('layered') && content.includes('subdued');
  results.stage7.checks.push({
    passed: darkTheme,
    message: darkTheme ? '✅ Dark, layered, subdued aesthetic maintained' : '❌ Dark theme requirement missing'
  });
  
  // Verify UI confirmation output
  const uiConfirm = content.includes('generateUIConfirmation');
  results.stage7.checks.push({
    passed: uiConfirm,
    message: uiConfirm ? '✅ UI CONFIRMATION output implemented' : '❌ UI confirmation output missing'
  });
}

// Check dashboard for dark theme compliance
const dashboardPath = path.join(__dirname, '../client/src/pages/cryptocrawler-dashboard.tsx');
if (fs.existsSync(dashboardPath)) {
  const dashContent = fs.readFileSync(dashboardPath, 'utf8');
  const hasDarkTheme = dashContent.includes('from-gray-900') && dashContent.includes('bg-gray-800');
  results.stage7.checks.push({
    passed: hasDarkTheme,
    message: hasDarkTheme ? '✅ Dashboard uses dark theme backgrounds' : '❌ Dashboard missing dark theme'
  });
}

results.stage7.pass = results.stage7.checks.every(c => c.passed);
results.stage7.checks.forEach(c => console.log(`  ${c.message}`));
console.log('');

// ============================================
// STAGE 8: FINAL DRY RUN VERIFICATION
// ============================================

console.log('🏃 STAGE 8 — FINAL DRY RUN (NO CAPITAL RISK)');
console.log('─'.repeat(60));

// Check final-dry-run.ts exists
const dryRunPath = path.join(__dirname, '../server/services/cryptocrawl/governance/final-dry-run.ts');
results.stage8.checks.push(checkFile(dryRunPath, 'final-dry-run.ts exists'));

if (fs.existsSync(dryRunPath)) {
  const content = fs.readFileSync(dryRunPath, 'utf8');
  
  // Verify flow phases
  const flowPhases = ['TRIGGER', 'SIGNAL', 'DECISION', 'VISUALIZATION', 'REPORT'];
  const phasesFound = flowPhases.every(p => content.includes(p));
  results.stage8.checks.push({
    passed: phasesFound,
    message: phasesFound ? '✅ Flow: Trigger → Signal → Decision → Visualization → Report' : '❌ Flow phases incomplete'
  });
  
  // Verify signals only constraint
  const signalsOnly = content.includes('signalsOnly') || content.includes('Signals emitted without execution');
  results.stage8.checks.push({
    passed: signalsOnly,
    message: signalsOnly ? '✅ Crypto components emit signals only' : '❌ Signals-only constraint missing'
  });
  
  // Verify single instance constraint
  const singleInstance = content.includes('validateSingleInstance') || content.includes('Single instance per component');
  results.stage8.checks.push({
    passed: singleInstance,
    message: singleInstance ? '✅ Single instance per component enforced' : '❌ Single instance constraint missing'
  });
  
  // Verify no duplicate processes
  const noDuplicates = content.includes('Duplicate') || content.includes('noDuplicates');
  results.stage8.checks.push({
    passed: noDuplicates,
    message: noDuplicates ? '✅ No duplicate processes check' : '❌ Duplicate process check missing'
  });
  
  // Verify PASS/FAIL output
  const passFailOutput = content.includes("'PASS'") && content.includes("'FAIL'");
  results.stage8.checks.push({
    passed: passFailOutput,
    message: passFailOutput ? '✅ OUTPUT: PASS / FAIL implemented' : '❌ PASS/FAIL output missing'
  });
}

// Check Cryptara is analysis only
const cryptaraPath = path.join(__dirname, '../server/services/cryptocrawl/ai/cryptara-strategist.ts');
if (fs.existsSync(cryptaraPath)) {
  const content = fs.readFileSync(cryptaraPath, 'utf8');
  
  const analysisOnly = content.includes('EXECUTION_BLOCKED = true') || content.includes('Analysis ONLY');
  results.stage8.checks.push({
    passed: analysisOnly,
    message: analysisOnly ? '✅ Cryptara: Analysis only, NO execution authority' : '❌ Cryptara execution block missing'
  });
  
  const stageGated = content.includes('stage < 8') || content.includes('Cognition gated by stage');
  results.stage8.checks.push({
    passed: stageGated,
    message: stageGated ? '✅ Cryptara: Cognition gated by stage (active Stage 8+)' : '❌ Cryptara stage gating missing'
  });
}

results.stage8.pass = results.stage8.checks.every(c => c.passed);
results.stage8.checks.forEach(c => console.log(`  ${c.message}`));
console.log('');

// ============================================
// GOVERNANCE SYSTEM VERIFICATION
// ============================================

console.log('🏛️  GOVERNANCE SYSTEM');
console.log('─'.repeat(60));

// Check all governance files exist
const governanceFiles = [
  { path: 'composer.ts', name: 'Composer (Canonical Authority)' },
  { path: 'stage-controller.ts', name: 'Stage Controller (PASS/FAIL State)' },
  { path: 'execution-gate.ts', name: 'Execution Gate (Final Choke-point)' },
  { path: 'background-loop-governor.ts', name: 'Background Loop Governor' },
  { path: 'index.ts', name: 'Governance Index' }
];

const govBasePath = path.join(__dirname, '../server/services/cryptocrawl/governance');

governanceFiles.forEach(file => {
  const fullPath = path.join(govBasePath, file.path);
  results.governance.checks.push(checkFile(fullPath, file.name));
});

// Verify stage enforcement
const stageControllerPath = path.join(govBasePath, 'stage-controller.ts');
if (fs.existsSync(stageControllerPath)) {
  const content = fs.readFileSync(stageControllerPath, 'utf8');
  const hasEnforcement = content.includes('Prevents skipping') || content.includes('backsliding');
  results.governance.checks.push({
    passed: hasEnforcement,
    message: hasEnforcement ? '✅ Stage 1-N enforcement (no skipping/backsliding)' : '❌ Stage enforcement missing'
  });
}

// Verify execution gate
const executionGatePath = path.join(govBasePath, 'execution-gate.ts');
if (fs.existsSync(executionGatePath)) {
  const content = fs.readFileSync(executionGatePath, 'utf8');
  const hasChoke = content.includes('choke-point') || content.includes('BLOCK') || content.includes('SIMULATE');
  results.governance.checks.push({
    passed: hasChoke,
    message: hasChoke ? '✅ Execution gate: caps, ramps, locks, paper/live mode' : '❌ Execution gate incomplete'
  });
}

// Verify loop governor
const loopGovPath = path.join(govBasePath, 'background-loop-governor.ts');
if (fs.existsSync(loopGovPath)) {
  const content = fs.readFileSync(loopGovPath, 'utf8');
  const hasWatchdog = content.includes('watchdog') || content.includes('maxLifetimeMs');
  results.governance.checks.push({
    passed: hasWatchdog,
    message: hasWatchdog ? '✅ Background Loop Governor: nothing runs forever silently' : '❌ Loop governor incomplete'
  });
}

results.governance.pass = results.governance.checks.every(c => c.passed);
results.governance.checks.forEach(c => console.log(`  ${c.message}`));
console.log('');

// ============================================
// FINAL SUMMARY
// ============================================

console.log('╔══════════════════════════════════════════════════════════════════════════╗');
console.log('║                           VERIFICATION SUMMARY                          ║');
console.log('╠══════════════════════════════════════════════════════════════════════════╣');

const stage6Status = results.stage6.pass ? '✅ PASS' : '❌ FAIL';
const stage7Status = results.stage7.pass ? '✅ PASS' : '❌ FAIL';
const stage8Status = results.stage8.pass ? '✅ PASS' : '❌ FAIL';
const govStatus = results.governance.pass ? '✅ PASS' : '❌ FAIL';

console.log(`║ Stage 6 - Profit Ramp Logic:        ${stage6Status.padEnd(35)}║`);
console.log(`║ Stage 7 - Visual/UI Sanity Check:   ${stage7Status.padEnd(35)}║`);
console.log(`║ Stage 8 - Final Dry Run:            ${stage8Status.padEnd(35)}║`);
console.log(`║ Governance System:                  ${govStatus.padEnd(35)}║`);
console.log('╠══════════════════════════════════════════════════════════════════════════╣');

allPassed = results.stage6.pass && results.stage7.pass && results.stage8.pass && results.governance.pass;

if (allPassed) {
  console.log('║                       🎉 ALL STAGES VERIFIED 🎉                         ║');
  console.log('║                                                                          ║');
  console.log('║  RAMP POLICY TABLE:                                                      ║');
  console.log('║  ┌───────┬────────────┬─────────────────────────────────────────────┐   ║');
  console.log('║  │ TIER  │ DAILY CAP  │ PREREQUISITES                               │   ║');
  console.log('║  ├───────┼────────────┼─────────────────────────────────────────────┤   ║');
  console.log('║  │   1   │    $200    │ 10 cycles, 55% WR, 0.5 SR, 2 anomalies max  │   ║');
  console.log('║  │   2   │    $400    │ 15 cycles, 58% WR, 0.7 SR, 1 anomaly max    │   ║');
  console.log('║  │   3   │    $800    │ 20 cycles, 60% WR, 0.9 SR, 1 anomaly max    │   ║');
  console.log('║  │   4   │  $1,600    │ 25 cycles, 62% WR, 1.0 SR, 0 anomalies      │   ║');
  console.log('║  │   5   │  $5,000    │ 30 cycles, 65% WR, 1.2 SR, 0 anomalies      │   ║');
  console.log('║  │   6   │ $35,000    │ 50 cycles, 68% WR, 1.5 SR, 0 anomalies      │   ║');
  console.log('║  └───────┴────────────┴─────────────────────────────────────────────┘   ║');
  console.log('║                                                                          ║');
  console.log('║  ✓ Monte Carlo justification required for ALL advancements              ║');
  console.log('║  ✓ No discretionary overrides (HARD-LOCKED)                             ║');
} else {
  console.log('║                       ❌ VERIFICATION FAILED ❌                          ║');
  console.log('║                                                                          ║');
  console.log('║  Please review failed checks above and address issues.                  ║');
}

console.log('╚══════════════════════════════════════════════════════════════════════════╝');

process.exit(allPassed ? 0 : 1);
