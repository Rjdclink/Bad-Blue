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
 * Job Management:
 * - CrawlerJobManager: Production-grade job lifecycle with append-only results
 */

export { BlizzardCrawler, CerberusCrawler, LichCrawler } from './TrinityCrawlers';
export { StarTrekCrawler } from './StarTrekCrawler';
export { BirdOfPreyCrawler } from './BirdOfPreyCrawler';
export { SixDegreesCrawler } from './SixDegreesCrawler';
export { PhylacterySystem } from '../storage/PhylacterySystem';

// Job Management
export { 
  CrawlerJobManager, 
  crawlerJobManager,
  JobStatus,
  FailureType,
  classifyFailure,
  isSoftFailure,
  isHardFailure,
  type CrawlJob,
  type CrawlResult,
  type JobConfig,
  type JobReport,
} from './CrawlerJobManager';
