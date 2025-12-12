/**
 * Lexara Module - Index
 * 
 * Central exports for Lexara's power and intelligence systems.
 * Lexara operates on the Computational Reactor throne for all heavy processing.
 */

export {
  ensureLexaraReactorInitialized,
  scheduleLexaraJob,
  getLexaraPowerState,
  isLexaraOperational,
  getLexaraReactorEvents,
  type LexaraJobType,
  type LexaraPowerState,
  type LexaraJobOptions,
} from './lexaraPowerCore';

import lexaraPowerCore from './lexaraPowerCore';
export default lexaraPowerCore;
