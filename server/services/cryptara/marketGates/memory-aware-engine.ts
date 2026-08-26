import { CryptaraMarketGateEngine as BaseCryptaraMarketGateEngine } from './engine.js';
import { cryptaraMarketMemory } from './memory.js';
import type {
  CryptaraMarketGateConfig,
  CryptaraMarketGateContext,
  GateEvaluation,
} from './types.js';

/**
 * Production market gate with bounded decision memory.
 *
 * Live gate evidence remains authoritative. Historical memory is appended as
 * advisory context after the live decision and cannot turn BLOCK into ALLOW or
 * fill unknown critical signals.
 */
export class CryptaraMarketGateEngine {
  private readonly base = new BaseCryptaraMarketGateEngine();

  evaluate(
    context: CryptaraMarketGateContext,
    config: CryptaraMarketGateConfig = {},
  ): GateEvaluation {
    const liveEvaluation = this.base.evaluate(context, config);
    const recallBefore = cryptaraMarketMemory.recall(context);
    const memorySignal = cryptaraMarketMemory.toSignal(recallBefore);
    const evaluation: GateEvaluation = {
      ...liveEvaluation,
      signals: [...liveEvaluation.signals, memorySignal],
      blockReasons: [...liveEvaluation.blockReasons],
      actions: { ...liveEvaluation.actions },
      metadata: { ...liveEvaluation.metadata },
    };

    cryptaraMarketMemory.observe(context, evaluation);
    return evaluation;
  }

  getMemorySnapshot() {
    return cryptaraMarketMemory.snapshot();
  }
}
