/**
 * Reactor Module - Index
 *
 * Compatibility exports for the Quanti-backed Computational Reactor.
 */

export {
  computationalReactor,
  initializeReactor,
  submitJob,
  registerReactorExecutor,
  unregisterReactorExecutor,
  getReactorStatus,
  getHeatMonitor,
  shutdownReactor,
  reactorEvents,
  type ReactorJob,
  type ReactorMetrics,
  type ReactorConfig,
  type HeatMonitor,
  type MonteCarloConfig,
  type ReactorJobExecutionResult,
  type ReactorJobExecutorContext,
  type ReactorJobExecutor,
} from './computationalReactor';

import computationalReactorDefault from './computationalReactor';
export default computationalReactorDefault;
