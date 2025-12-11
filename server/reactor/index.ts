/**
 * Reactor Module - Index
 * 
 * Exports the Computational Reactor (OPIF) for job scheduling and optimization
 */

export {
  computationalReactor,
  initializeReactor,
  submitJob,
  getReactorStatus,
  getHeatMonitor,
  shutdownReactor,
  reactorEvents,
  type ReactorJob,
  type ReactorMetrics,
  type ReactorConfig,
  type HeatMonitor,
  type MonteCarloConfig
} from './computationalReactor';

import computationalReactorDefault from './computationalReactor';
export default computationalReactorDefault;
