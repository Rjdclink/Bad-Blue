/**
 * Reactor Module - Index
 * 
 * This module is the central Computational Reactor (OPIF) powering Lexara, crawlers, 
 * Monte Carlo optimization, and maintenance.
 * 
 * Exports the Computational Reactor for job scheduling and optimization
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
