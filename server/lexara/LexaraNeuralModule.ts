/**
 * Canonical Lexara neural-core entry point.
 *
 * The historical ../alexaraModule file is retained as a compatibility
 * implementation so persisted pathway identifiers and old imports do not break.
 * Active runtime code should import from this module.
 */
export {
  LexaraNeuralModule,
  getLexaraNeuralModule,
  initializeLexaraNeuralModule,
  shutdownLexaraNeuralModule,
} from '../alexaraModule';

export type {
  LexaraNeuralMetrics,
  LegalReasoningCluster,
  LegalElement,
  LegalAnalysisResult,
} from '../alexaraModule';
