import express from 'express';
import { isCryptaraStageUnlocked } from '../services/cryptara';
import { createLogger } from '../logger';

const log = createLogger('crypto-wiring');
const router = express.Router();

type WireVerdict = 'PASS' | 'FAIL';

interface WireCheckResponse {
  ok: boolean;
  stage: 5;
  noExecution: boolean;
  noIntervals: boolean;
  cryptaraMode: string;
  signal: {
    type: 'sentiment';
    output: unknown;
  };
  decision: {
    verdict: WireVerdict;
    reason: string;
  };
  executionStub: {
    executed: false;
    reason: string;
  };
}

function truthyEnv(name: string): boolean {
  return process.env[name] === 'true';
}

router.post('/wire-check', async (_req, res) => {
  const noExecution = truthyEnv('NO_EXECUTION');
  const noIntervals = truthyEnv('NO_INTERVALS');
  const cryptaraMode = process.env.CRYPTARA_MODE || 'UNSET';
  const cryptaraUnlocked = isCryptaraStageUnlocked();

  try {
    // HARD RULE: CRYPTARA is mute-silent until Stage 8.
    // Stage 5 wire-check must NOT touch CRYPTARA.
    const sentiment = cryptaraUnlocked
      ? { suppressed: true, reason: 'Stage 5 wire-check does not invoke CRYPTARA' }
      : { suppressed: true, reason: 'CRYPTARA_SILENT_UNTIL_STAGE_8' };

    // Decision engine: deterministic gate for Stage 5
    const verdict: WireVerdict = (noExecution && noIntervals) ? 'PASS' : 'FAIL';
    const reason = verdict === 'PASS'
      ? 'Stage 5 gate satisfied (NO_EXECUTION + NO_INTERVALS)'
      : 'Stage 5 gate failed: require NO_EXECUTION=true and NO_INTERVALS=true';

    const response: WireCheckResponse = {
      ok: verdict === 'PASS',
      stage: 5,
      noExecution,
      noIntervals,
      cryptaraMode,
      signal: { type: 'sentiment', output: sentiment },
      decision: { verdict, reason },
      executionStub: { executed: false, reason: 'Execution disabled in Stage 5' },
    };

    return res.json(response);
  } catch (error: any) {
    log.error('Wire-check failed', { error: error?.message ?? String(error) });
    return res.status(500).json({
      ok: false,
      stage: 5,
      error: error?.message ?? String(error),
    });
  }
});

export default router;

