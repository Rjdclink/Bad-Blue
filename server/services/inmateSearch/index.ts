/**
 * Inmate Search Service - Module Export
 */

export * from './types';
export * from './stateData';
export { 
  searchInmates, 
  getStateInfo, 
  getAllStatesInfo,
  clearCache,
  getCacheStats 
} from './InmateSearchAggregator';
