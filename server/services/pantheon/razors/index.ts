/**
 * 10 RAZORS - PANTHEON PRIMARY CRAWLERS
 * 
 * Two-Stage Deployment System:
 *   Stage 1 (PRIMARY): 10 RAZORS - Fast, specialized extractors
 *   Stage 2 (SECONDARY): Legacy crawlers (Hydra, Wraith, Ice)
 */

// Types
export * from './types';

// Base class
export { BaseRazor } from './BaseRazor';

// All 10 Razors
export {
  IdentityRazor,
  ContactRazor,
  AddressRazor,
  SocialRazor,
  RecordRazor,
  AssetRazor,
  CourtRazor,
  BusinessRazor,
  RelationRazor,
  MediaRazor,
  ALL_RAZORS,
  createAllRazors,
} from './implementations';

// Two-Stage Deployer
export { TwoStageDeployer, twoStageDeployer } from './TwoStageDeployer';
