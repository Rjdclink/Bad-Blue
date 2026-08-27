import logger from '../../../logger.js';
import { getCryptara, type CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { monteCarloCalibrationStore } from '../validation/monte-carlo-calibration-store.js';

const installed = new WeakSet<object>();

export function ensureMonteCarloCalibrationWiring(): void {
  const cryptara = getCryptara() as unknown as {
    recordExecutionResult: (feedback: CryptaraExecutionFeedback) => void;
  };
  if (installed.has(cryptara)) return;
  installed.add(cryptara);

  void monteCarloCalibrationStore.hydrate();
  const original = cryptara.recordExecutionResult.bind(cryptara);
  cryptara.recordExecutionResult = (feedback: CryptaraExecutionFeedback): void => {
    original(feedback);
    if (feedback.settlement?.terminal === true && feedback.settlementConfirmed === true) {
      void monteCarloCalibrationStore.recordTerminal(feedback).catch(error => {
        logger.warn('[MonteCarloCalibration] Terminal calibration record failed', {
          component: 'MonteCarloCalibrationWiring',
          opportunityId: feedback.opportunityId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  };

  logger.info('[MonteCarloCalibration] Terminal settlement calibration wiring installed', {
    component: 'MonteCarloCalibrationWiring',
    authority: 'terminal_normalized_settlement_only',
    persistence: 'versioned_postgres_when_available',
    syntheticEvidenceAllowed: false,
  });
}
