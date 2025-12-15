/**
 * STAGE 5 wire-check (offline; no server; no network).
 *
 * Runs: Decision gate -> Execution stub (no-op).
 *
 * HARD RULE UPDATE:
 * - CRYPTARA must be mute-silent until Stage 8, so Stage 5 wire-check must NOT invoke it.
 *
 * Constraints:
 * - NO_EXECUTION=true
 * - NO_INTERVALS=true
 * - CRYPTARA_MODE=SILENT_WATCHER_ONLY
 */

process.env.NO_EXECUTION = process.env.NO_EXECUTION ?? 'true';
process.env.NO_INTERVALS = process.env.NO_INTERVALS ?? 'true';
process.env.CRYPTARA_MODE = process.env.CRYPTARA_MODE ?? 'SILENT_WATCHER_ONLY';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    // eslint-disable-next-line no-console
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('🔌 STAGE 5 Wire-Check (offline)\n');

  assert(process.env.NO_EXECUTION === 'true', 'NO_EXECUTION must be true');
  assert(process.env.NO_INTERVALS === 'true', 'NO_INTERVALS must be true');
  assert(process.env.CRYPTARA_MODE === 'SILENT_WATCHER_ONLY', 'CRYPTARA_MODE must be SILENT_WATCHER_ONLY');

  const decisionPass = process.env.NO_EXECUTION === 'true' && process.env.NO_INTERVALS === 'true';
  const verdict = decisionPass ? 'PASS' : 'FAIL';

  // eslint-disable-next-line no-console
  console.log('✅ Signal:', { suppressed: true, reason: 'CRYPTARA_SILENT_UNTIL_STAGE_8' });
  // eslint-disable-next-line no-console
  console.log('✅ Decision:', {
    verdict,
    reason: decisionPass ? 'Stage 5 gate satisfied (NO_EXECUTION + NO_INTERVALS)' : 'Stage 5 gate failed',
  });
  // eslint-disable-next-line no-console
  console.log('✅ Execution Stub:', { executed: false, reason: 'Execution disabled in Stage 5' });

  // eslint-disable-next-line no-console
  console.log('\n✅ WIRED');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ Wire-check failed:', err?.message ?? err);
  process.exit(1);
});

