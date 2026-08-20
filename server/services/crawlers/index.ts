/**
 * Trinity Crawlers - PANTHEON Intelligence Gathering
 * 
 * Three specialized crawler systems:
 * - Blizzard: Mass parallel scraping with unique fingerprints
 * - Cerberus: Three-headed adaptive defense system
 * - Lich: Immortal necromancer with army command
 * 
 * Plus:
 * - StarTrek: Federation explorer with warp drive and phasers
 * - Bird of Prey: Klingon predator with perfect cloaking and disruptors
 * - Six Degrees: Social graph mapper for relationship discovery
 * 
 * Six-Crawler Initiative:
 * - Advanced security stress-testing construct
 * - Six autonomous analytic entities working in coordination
 * - Operates only in authorized, simulated, or mirrored environments
 * 
 * Job Management:
 * - CrawlerJobManager: Production-grade continuous job lifecycle
 * - Tiered Reports: Basic (4min), Enhanced (8min), Full (12min), Eye of God (18min)
 * - Continuous fill-in as data becomes available
 * - Doomsday Clock UI with user-controlled hard stop
 */

export { BlizzardCrawler, CerberusCrawler, LichCrawler } from './TrinityCrawlers';
export { StarTrekCrawler } from './StarTrekCrawler';
export { BirdOfPreyCrawler } from './BirdOfPreyCrawler';
export { SixDegreesCrawler } from './SixDegreesCrawler';
export { PhylacterySystem } from '../storage/PhylacterySystem';

export {
  selectCrawlerPlan,
  recordCrawlerOutcomes,
  getCrawlerSelectionMetrics,
  type CrawlerSelectionPlan,
  type CrawlerSelectionPurpose,
  type CrawlerSupervisor,
  type ExecutableCrawler,
} from './CrawlerSelectionUtility';

export {
  CainReaperSupervisor,
  cainReaperSupervisor,
  type CrawlerSupervisionResult,
} from './CainReaperSupervisor';

export {
  PantheonRetrievalAdapter,
  pantheonRetrievalAdapter,
  type PantheonRetrievalResponse,
  type RetrievalEvidence,
} from './PantheonRetrievalAdapter';

// Six-Crawler Initiative (Enhanced to Seven)
export {
  SixCrawlerInitiative,
  MirrorCrawler,
  KeyCrawler,
  ChewerCrawler,
  ComputationalCrawler,
  USCCrawler,
  WooCrawler,
  SilenceCrawler,
} from './SixCrawlerInitiative';

// Seven-Stage Three-Pass Optimization Framework
export {
  SevenStageOptimizationOrchestrator,
  MirrorOptimizer,
  KeyOptimizer,
  ChewerOptimizer,
  ComputationalOptimizer,
  USCOptimizer,
  WooOptimizer,
  SilenceOptimizer,
  type OptimizationPass,
  type OptimizationStage,
  type CrawlerOptimizationProfile,
} from './SevenStageOptimization';

// Cain (Overseer) and The Reaper
export {
  Cain,
  Reaper,
  type EpistemicSurfaceArea,
  type EntropyGradient,
  type CompressionResistance,
  type EvolutionaryDebt,
  type StarburstDemand,
  type FailsafeSwitch,
  type ReaperSignal,
  type ReaperAction,
  type EdenscanResult,
} from './CainAndReaper';

// Job Management with Tiered Reports and Doomsday Clock
export { 
  CrawlerJobManager, 
  crawlerJobManager,
  JobStatus,
  FailureType,
  ReportTier,
  REPORT_TIER_THRESHOLDS,
  REPORT_TIER_NAMES,
  TIER_DATA_CATEGORIES,
  DOOMSDAY_CLOCK_TIERS,
  classifyFailure,
  isSoftFailure,
  isHardFailure,
  getTierTimeThreshold,
  getCurrentTierFromElapsed,
  getActiveTierFromElapsed,
  getCompletedTiers,
  calculateTierProgress,
  calculateTierFillPercentage,
  getCategoriesForTier,
  getCategoryTier,
  type CrawlJob,
  type CrawlResult,
  type JobConfig,
  type JobReport,
  type LiveReportState,
  type DoomsdayClockState,
  type DoomsdayClockTier,
} from './CrawlerJobManager';
