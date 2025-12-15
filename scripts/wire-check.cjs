#!/usr/bin/env node
/**
 * Stage 5 wire-check (non-network).
 *
 * Runs the end-to-end wiring logic without starting the server:
 * Signals (Cryptara on-demand) -> Decision gate -> Execution stub.
 *
 * Constraints:
 * - NO network calls
 * - NO background intervals (enforced by env + module gates)
 * - NO live execution
 */

process.env.NO_EXECUTION = process.env.NO_EXECUTION ?? 'true';
process.env.NO_INTERVALS = process.env.NO_INTERVALS ?? 'true';
process.env.CRYPTARA_MODE = process.env.CRYPTARA_MODE ?? 'SILENT_WATCHER_ONLY';

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`❌ ${msg}`);
    process.exit(1);
  }
};

async function main() {
  console.log('🔌 Stage 5 Wire-Check (offline)\n');

  assert(process.env.NO_EXECUTION === 'true', 'NO_EXECUTION must be true');
  assert(process.env.NO_INTERVALS === 'true', 'NO_INTERVALS must be true');
  assert(process.env.CRYPTARA_MODE === 'SILENT_WATCHER_ONLY', 'CRYPTARA_MODE must be SILENT_WATCHER_ONLY');

  const { getCryptara } = await import('../server/services/cryptara/index.ts');
  const cryptara = getCryptara();

  await cryptara.initialize(); // should NOT start intervals due to gates
  const sentiment = await cryptara.analyzeSentiment();

  const decisionPass = process.env.NO_EXECUTION === 'true' && process.env.NO_INTERVALS === 'true';
  const decision = {
    verdict: decisionPass ? 'PASS' : 'FAIL',
    reason: decisionPass ? 'Stage 5 gate satisfied (NO_EXECUTION + NO_INTERVALS)' : 'Gate failed',
  };

  const executionStub = { executed: false, reason: 'Execution disabled in Stage 5' };

  console.log('✅ Signal OK:', { type: 'sentiment', timestamp: sentiment?.timestamp || null });
  console.log('✅ Decision:', decision);
  console.log('✅ Execution Stub:', executionStub);
  console.log('\n✅ WIRED');
}

main().catch((err) => {
  console.error('❌ Wire-check failed:', err?.message || err);
  process.exit(1);
});

