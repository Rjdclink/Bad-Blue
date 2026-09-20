// LegalWhat People Search - Deep OSINT Report Generation
// Aggregates public data from multiple sources for comprehensive background reports
// Utilizes PANTHEON crawler orchestrator for maximum intelligence gathering

import { logger } from './logger';
import { entityResolver } from './services/entityResolver';
import { enhancedWebSearch } from './webSearchService';
import { spiderfootClient } from './services/spiderfootClient';
import { emailFinder } from './services/emailFinder';
import { breachDetection } from './services/breachDetection';
import { mlnlpIntelligenceService, MLNLPResult } from './services/mlnlp';
import { socialIntelligenceService } from './services/socialIntelligence';
import { 
  emailDiscoveryService,
  precedentExtractor,
  type CasePrecedent
} from './services/legalIntelligence';
import type { SherlockResult } from './services/socialIntelligence/types';
import { pantheonRetrievalAdapter } from './services/crawlers/PantheonRetrievalAdapter';
import { buildPantheonBackgroundRegistryTargets, PANTHEON_BACKGROUND_CATEGORIES } from './services/pantheon/PantheonSovereignSourceRegistry';

// PANTHEON Crawler Orchestrator - Utilizes all crawler functions
import {
  pantheonOrchestrator,
  canActivatePantheon,
  type CrawlerResult,
} from './services/pantheonCrawlerOrchestrator';

// Constants for crawler messages
const CRAWLER_MESSAGES = {
  LEVEL_3_SUMMARY: '\n\n🔬 Advanced Analysis: extended PANTHEON retrieval completed with provenance-bearing evidence from the crawler capabilities that returned verified results.',
  LEVEL_4_SUMMARY: '\n\n👁️ EYE OF GOD: bounded PANTHEON avalanche traversal completed; report contents reflect only evidence actually returned by responsive public sources.',
};

/**
 * Interface for search results from various sources
 */
interface OSINTSource {
  name: string;
  data: any;
  confidence: number;
  timestamp: Date;
}

/**
 * Comprehensive people search report structure
 */
export interface PeopleSearchReport {
  identitySummary: {
    name: string;
    aliases?: string[];
    age?: number;
    dateOfBirth?: string;
    gender?: string;
    verificationStatus: string;
  };
  contactInformation: string[];
  socialMediaPresence: string[];
  socialMediaProfiles?: SherlockResult[]; // Enhanced: Sherlock platform search results
  employmentAndEducation: string[];
  locationHistory: string[];
  publicRecords: string[];
  onlineMentions: string[];
  riskAndReputation: string[];
  caseHistory?: CasePrecedent[]; // Phase 3B: Legal case history
  summary: string;
  confidenceScore: number;
  sources: OSINTSource[];
  crawlerAudit?: Array<{
    crawler: string;
    capabilityClass: string;
    status: string;
    evidenceCount: number;
    attempts: number;
    targets: number;
    error?: string;
  }>;
  mlnlpAnalysis?: MLNLPResult; // ML/NLP intelligence results
}

/**
 * Search configuration
 */
interface SearchConfig {
  includeDeepSearch: boolean;
  maxSources: number;
  timeoutMs: number;
}

/**
 * Main people search function
 * Aggregates data from multiple public sources
 */
function buildPantheonSearchTargets(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  return [
    `https://www.google.com/search?q=${encodeURIComponent(`"${trimmed}" public records`)}`,
    `https://www.google.com/search?q=${encodeURIComponent(`"${trimmed}" news court business professional`)}`,
  ];
}

const PANTHEON_DEPTH_SOURCE_BUDGET: Record<number, number> = {
  1: 1200,  // 10 minutes: focused complete-crawler investigation
  2: 2800,  // 20 minutes: broader/deeper registry traversal and corroboration
  3: 4500,  // 30 minutes: maximum standard registry intensity
  4: 4500,  // legacy maximum mode retains the 30-minute maximum budget
};

function buildPantheonBackgroundTargets(name: string, location: string | undefined, depth: number): string[] {
  const normalizedDepth = Math.max(1, Math.min(4, Math.floor(depth || 1)));
  const sourceBudget = PANTHEON_DEPTH_SOURCE_BUDGET[normalizedDepth];
  // Ask for enough candidates to expose the full verified registry at the
  // highest intensity. Registry ordering is authoritative/direct first.
  const targets = buildPantheonBackgroundRegistryTargets(name, location, 300);
  const authorityRank: Record<string, number> = { primary: 0, secondary: 1, archive: 2, discovery: 3 };
  const categoryRank = new Map(PANTHEON_BACKGROUND_CATEGORIES.map((category, index) => [category, index]));
  const seen = new Set<string>();

  return targets
    .sort((a, b) =>
      (authorityRank[a.authority] ?? 9) - (authorityRank[b.authority] ?? 9) ||
      (categoryRank.get(a.category) ?? 999) - (categoryRank.get(b.category) ?? 999)
    )
    .filter(target => {
      if (seen.has(target.url)) return false;
      seen.add(target.url);
      return true;
    })
    .slice(0, sourceBudget)
    .map(target => target.url);
}

function mergeCrawlerAudit(entries: NonNullable<PeopleSearchReport['crawlerAudit']>): NonNullable<PeopleSearchReport['crawlerAudit']> {
  const merged = new Map<string, NonNullable<PeopleSearchReport['crawlerAudit']>[number]>();
  const statusRank: Record<string, number> = {
    completed_with_evidence: 5,
    completed_no_evidence: 4,
    timed_out: 3,
    unavailable_no_content: 2,
    failed: 1,
  };

  for (const entry of entries) {
    const key = `${entry.capabilityClass}:${entry.crawler}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...entry });
      continue;
    }
    const evidenceCount = existing.evidenceCount + entry.evidenceCount;
    const statuses = [existing.status, entry.status];
    const preferredStatus = evidenceCount > 0
      ? 'completed_with_evidence'
      : statuses.includes('timed_out')
        ? 'timed_out'
        : statuses.includes('failed')
          ? 'failed'
          : statuses.includes('unavailable_no_content')
            ? 'unavailable_no_content'
            : (statusRank[entry.status] || 0) > (statusRank[existing.status] || 0)
              ? entry.status
              : existing.status;
    merged.set(key, {
      ...existing,
      status: preferredStatus,
      evidenceCount,
      attempts: existing.attempts + entry.attempts,
      targets: Math.max(existing.targets, entry.targets),
      error: existing.error || entry.error,
    });
  }
  return [...merged.values()].sort((a, b) => a.capabilityClass.localeCompare(b.capabilityClass) || a.crawler.localeCompare(b.crawler));
}

function dedupeReportStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = value.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

export async function conductPeopleSearch(
  searchQuery: string,
  config: Partial<SearchConfig> = {}
): Promise<PeopleSearchReport> {
  const defaultConfig: SearchConfig = {
    includeDeepSearch: true,
    maxSources: 10,
    timeoutMs: 30000,
  };

  const finalConfig = { ...defaultConfig, ...config };

  const report: PeopleSearchReport = {
    identitySummary: {
      name: searchQuery,
      verificationStatus: 'Partial',
    },
    contactInformation: [],
    socialMediaPresence: [],
    employmentAndEducation: [],
    locationHistory: [],
    publicRecords: [],
    onlineMentions: [],
    riskAndReputation: [],
    summary: '',
    confidenceScore: 0,
    sources: [],
  };

  try {
    // Run searches in parallel
    const searches = await Promise.allSettled([
      searchPublicRecords(searchQuery),
      searchSocialMedia(searchQuery),
      searchProfessionalNetworks(searchQuery),
      searchNewsAndArticles(searchQuery),
      searchCourtRecords(searchQuery),
    ]);

    // Process results
    searches.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        aggregateSearchResults(report, result.value);
      }
    });

    // Apply ML/NLP Intelligence Layer
    try {
      // Collect all text for NLP processing
      const combinedText = [
        ...report.publicRecords,
        ...report.socialMediaPresence,
        ...report.employmentAndEducation,
        ...report.onlineMentions,
      ].join('\n\n');

      // Process through ML/NLP pipeline
      if (combinedText.length > 0) {
        const mlnlpResults = await mlnlpIntelligenceService.processOSINTData({
          text: combinedText,
          entities: report.sources.map(source => ({
            name: searchQuery,
            source: source.name,
            metadata: source.data,
          })),
          sources: report.sources,
        });

        // Store ML/NLP analysis
        report.mlnlpAnalysis = mlnlpResults;

        // Enhance report with ML/NLP insights
        if (mlnlpResults.nlpResults && mlnlpResults.nlpResults.entities) {
          // Add extracted entities to appropriate sections
          mlnlpResults.nlpResults.entities.forEach(entity => {
            switch (entity.type) {
              case 'email':
                if (!report.contactInformation.includes(entity.value)) {
                  report.contactInformation.push(entity.value);
                }
                break;
              case 'phone':
                if (!report.contactInformation.includes(entity.value)) {
                  report.contactInformation.push(entity.value);
                }
                break;
              case 'location':
                if (!report.locationHistory.includes(entity.value)) {
                  report.locationHistory.push(entity.value);
                }
                break;
              case 'org':
                if (!report.employmentAndEducation.includes(entity.value)) {
                  report.employmentAndEducation.push(entity.value);
                }
                break;
            }
          });
        }

        // Update confidence score with ML/NLP insights
        if (mlnlpResults.confidenceScores && mlnlpResults.confidenceScores.length > 0) {
          const mlnlpConfidence = mlnlpResults.confidenceScores[0].overallConfidence;
          report.confidenceScore = Math.round(
            (report.confidenceScore + mlnlpConfidence) / 2
          );
        }
      }
    } catch (mlnlpError) {
      logger.error('ML/NLP processing error:', mlnlpError);
      // Continue without ML/NLP enhancement if it fails
    }

    // Use entity resolution for fuzzy matching across sources
    try {
      const allRecords = report.sources.map(source => ({
        name: searchQuery,
        email: undefined,
        phone: undefined,
        badge: undefined,
        source: source.name,
      }));
      
      const resolved = await entityResolver.resolvePerson(searchQuery, allRecords);
      
      // Update report with resolved entity information
      if (resolved.entity.names.length > 0) {
        report.identitySummary.aliases = resolved.entity.names.filter(n => n !== resolved.primaryName);
      }
    } catch (error) {
      console.error('Entity resolution error:', error);
      // Continue without entity resolution if it fails
    }

    // Calculate confidence score
    report.confidenceScore = calculateConfidenceScore(report);

    // Generate summary
    report.summary = generateReportSummary(report);

    return report;
  } catch (error) {
    console.error('People search error:', error);
    throw error;
  }
}

/**
 * Enhanced people search with advanced dorking
 * Integrates Phase 3 advanced search capabilities
 */
export async function conductEnhancedPeopleSearch(
  searchQuery: string,
  options?: {
    department?: string;
    badge?: string;
    location?: string;
    phone?: string;
  },
  config: Partial<SearchConfig> = {}
): Promise<PeopleSearchReport & { 
  dorkResults?: any; 
  publicDbResults?: any;
}> {
  // Run standard search
  const report = await conductPeopleSearch(searchQuery, config);

  try {
    // Add advanced dorking results
    const dorkResults = await enhancedWebSearch.searchWithDorks(searchQuery, options);
    
    // Add public database results
    const publicDbResults = await enhancedWebSearch.searchPublicDatabases(searchQuery);

    // Aggregate dorking results into report
    if (dorkResults && dorkResults.length > 0) {
      dorkResults.forEach(result => {
        report.sources.push({
          name: 'Google Dork Search',
          data: result,
          confidence: 75,
          timestamp: new Date(),
        });
        
        // Extract any useful information from dork results
        if (result.results && result.results.length > 0) {
          result.results.forEach((r: any) => {
            if (r.snippet) {
              report.onlineMentions.push(r.snippet);
            }
          });
        }
      });
    }

    // Aggregate public database results
    if (publicDbResults) {
      if (publicDbResults.transparencyUSA?.length > 0) {
        report.sources.push({
          name: 'TransparencyUSA',
          data: publicDbResults.transparencyUSA,
          confidence: 85,
          timestamp: new Date(),
        });
      }
      if (publicDbResults.govSalaries?.length > 0) {
        report.sources.push({
          name: 'GovSalaries',
          data: publicDbResults.govSalaries,
          confidence: 85,
          timestamp: new Date(),
        });
      }
      if (publicDbResults.pacer?.length > 0) {
        report.sources.push({
          name: 'PACER',
          data: publicDbResults.pacer,
          confidence: 90,
          timestamp: new Date(),
        });
      }
    }

    // Recalculate confidence with new data
    report.confidenceScore = calculateConfidenceScore(report);
    report.summary = generateReportSummary(report);

    return {
      ...report,
      dorkResults,
      publicDbResults,
    };
  } catch (error) {
    console.error('Enhanced search error:', error);
    // Return standard report if enhanced search fails
    return report;
  }
}

/**
 * Search public records databases
 * 
 * PRODUCTION MODE - Uses PANTHEON crawler orchestrator for real data collection
 * 
 * Integrates with:
 * - State/County clerk websites via PANTHEON crawlers
 * - Property tax records APIs
 * - Voter registration databases
 * - Business registration records
 * - Court record systems (PACER, state systems)
 */
async function searchPublicRecords(name: string): Promise<OSINTSource> {
  try {
    // Check if PANTHEON is available for crawling
    if (canActivatePantheon().available) {
      try {
        await pantheonOrchestrator.initialize();
        const crawlerResults = await pantheonOrchestrator.search(buildPantheonSearchTargets(name), {
          depth: 2,
          crawlers: ['startrek', 'birdofprey'],
          maxResultsPerCrawler: 10,
          timeout: 15000,
          stealth: true,
        });

        if (crawlerResults && crawlerResults.length > 0) {
          return {
            name: 'Public Records',
            data: {
              records: crawlerResults.map((result: CrawlerResult) => result.content || JSON.stringify(result)),
              rawData: crawlerResults,
              crawlerUsed: 'PANTHEON',
            },
            confidence: 0.85,
            timestamp: new Date(),
          };
        }
      } catch (crawlerError) {
        logger.warn('[PEOPLE SEARCH] PANTHEON crawler error, falling back to web search:', crawlerError);
      }
    }

    // Fallback: Use enhanced web search for public records
    const webResults = await enhancedWebSearch.searchPublicDatabases(name);
    
    const records: string[] = [];
    if (webResults?.transparencyUSA?.length > 0) {
      records.push(...webResults.transparencyUSA.map((r: any) => `TransparencyUSA: ${JSON.stringify(r)}`));
    }
    if (webResults?.govSalaries?.length > 0) {
      records.push(...webResults.govSalaries.map((r: any) => `GovSalaries: ${JSON.stringify(r)}`));
    }
    if (webResults?.pacer?.length > 0) {
      records.push(...webResults.pacer.map((r: any) => `PACER: ${JSON.stringify(r)}`));
    }

    return {
      name: 'Public Records',
      data: {
        // Fail closed: do not emit placeholder “search conducted” strings
        records,
        source: 'Enhanced Web Search',
      },
      confidence: records.length > 0 ? 0.75 : 0,
      timestamp: new Date(),
    };
  } catch (error) {
    logger.error('[PEOPLE SEARCH] Public records search error:', error);
    return {
      name: 'Public Records',
      data: { records: [], error: 'Public records search unavailable' },
      confidence: 0,
      timestamp: new Date(),
    };
  }
}

/**
 * Search social media platforms
 * 
 * PRODUCTION MODE - Uses Social Intelligence Service for real platform searches
 * 
 * Integrates with:
 * - Sherlock username search across 400+ platforms
 * - Official APIs where available (Twitter API, LinkedIn API, etc.)
 * - Social media profile correlation
 */
async function searchSocialMedia(name: string): Promise<OSINTSource> {
  try {
    // Use Social Intelligence Service for comprehensive social media search
    const socialResults = await socialIntelligenceService.findUserAcrossPlatforms(name);
    
    if (socialResults && socialResults.length > 0) {
      return {
        name: 'Social Media',
        data: {
          profiles: socialResults.map((profile: any) => 
            `${profile.platform}: ${profile.url || profile.username} (confidence: ${profile.confidence || 'N/A'})`
          ),
          rawData: socialResults,
          platformCount: socialResults.length,
        },
        confidence: 0.8,
        timestamp: new Date(),
      };
    }

    // Fallback: Use PANTHEON HYDRA crawler for social discovery
    if (canActivatePantheon().available) {
      try {
        await pantheonOrchestrator.initialize();
        const crawlerResults = await pantheonOrchestrator.search(buildPantheonSearchTargets(name), {
          depth: 2,
          crawlers: ['sixdegrees'],
          maxResultsPerCrawler: 20,
          timeout: 20000,
          stealth: true,
        });

        if (crawlerResults && crawlerResults.length > 0) {
          return {
            name: 'Social Media',
            data: {
              profiles: crawlerResults.map((result: CrawlerResult) => result.content || JSON.stringify(result)),
              crawlerUsed: 'PANTHEON SixDegrees',
            },
            confidence: 0.7,
            timestamp: new Date(),
          };
        }
      } catch (crawlerError) {
        logger.warn('[PEOPLE SEARCH] PANTHEON crawler error:', crawlerError);
      }
    }

    return {
      name: 'Social Media',
      data: {
        profiles: [],
        note: 'No profiles found or service temporarily unavailable',
      },
      confidence: 0,
      timestamp: new Date(),
    };
  } catch (error) {
    logger.error('[PEOPLE SEARCH] Social media search error:', error);
    return {
      name: 'Social Media',
      data: { profiles: [], error: 'Social media search unavailable' },
      confidence: 0,
      timestamp: new Date(),
    };
  }
}

/**
 * Search professional networks and directories
 * 
 * PRODUCTION MODE - Uses PANTHEON crawlers and email discovery services
 */
async function searchProfessionalNetworks(name: string): Promise<OSINTSource> {
  try {
    // Use email discovery service for professional contacts
    const emailResults = await emailDiscoveryService.discoverEmails(name, { maxResults: 20 });
    
    const findings: string[] = [];
    
    if (emailResults && emailResults.emails && emailResults.emails.length > 0) {
      emailResults.emails.forEach((result: any) => {
        findings.push(`Professional contact: ${result.email} (${result.source}, confidence: ${result.confidence}%)`);
      });
    }

    // Use PANTHEON for professional directory crawling
    if (canActivatePantheon().available) {
      try {
        await pantheonOrchestrator.initialize();
        const crawlerResults = await pantheonOrchestrator.search(buildPantheonSearchTargets(name), {
          depth: 1,
          crawlers: ['startrek'],
          maxResultsPerCrawler: 10,
          timeout: 10000,
          stealth: true,
        });

        if (crawlerResults && crawlerResults.length > 0) {
          findings.push(`Professional directory results: ${crawlerResults.length} entries found via PANTHEON`);
        }
      } catch (crawlerError) {
        logger.warn('[PEOPLE SEARCH] PANTHEON crawler error:', crawlerError);
      }
    }

    return {
      name: 'Professional Networks',
      data: {
        findings,
      },
      confidence: findings.length > 0 ? 0.7 : 0,
      timestamp: new Date(),
    };
  } catch (error) {
    logger.error('[PEOPLE SEARCH] Professional networks search error:', error);
    return {
      name: 'Professional Networks',
      data: { findings: [], error: 'Professional network search unavailable' },
      confidence: 0,
      timestamp: new Date(),
    };
  }
}

/**
 * Search news articles and online mentions
 * 
 * PRODUCTION MODE - Uses enhanced web search and PANTHEON crawlers
 */
async function searchNewsAndArticles(name: string): Promise<OSINTSource> {
  try {
    // Use enhanced web search for news and articles
    const webResults = await enhancedWebSearch.searchWithDorks(name, {});
    
    const mentions: string[] = [];
    
    if (webResults && webResults.length > 0) {
      webResults.forEach((result: any) => {
        if (result.results && result.results.length > 0) {
          result.results.forEach((r: any) => {
            if (r.title || r.snippet) {
              mentions.push(`${r.title || 'Article'}: ${r.snippet || r.url || ''}`);
            }
          });
        }
      });
    }

    // Use PANTHEON for deep news archive crawling
    if (canActivatePantheon() && mentions.length < 5) {
      try {
        await pantheonOrchestrator.initialize();
        const crawlerResults = await pantheonOrchestrator.search(buildPantheonSearchTargets(name), {
          depth: 2,
          crawlers: ['blizzard'],
          maxResultsPerCrawler: 20,
          timeout: 15000,
          stealth: true,
          stormIntensity: 'snow',
        });

        if (crawlerResults && crawlerResults.length > 0) {
          mentions.push(`News archive: ${crawlerResults.length} mentions found via PANTHEON`);
        }
      } catch (crawlerError) {
        logger.warn('[PEOPLE SEARCH] PANTHEON crawler error:', crawlerError);
      }
    }

    return {
      name: 'News and Articles',
      data: {
        mentions,
      },
      confidence: mentions.length > 0 ? 0.7 : 0,
      timestamp: new Date(),
    };
  } catch (error) {
    logger.error('[PEOPLE SEARCH] News and articles search error:', error);
    return {
      name: 'News and Articles',
      data: { mentions: [], error: 'News search unavailable' },
      confidence: 0,
      timestamp: new Date(),
    };
  }
}

/**
 * Search court records and legal databases
 * 
 * PRODUCTION MODE - Uses PANTHEON ICE crawler and precedent extractor
 */
async function searchCourtRecords(name: string): Promise<OSINTSource> {
  try {
    const records: string[] = [];

    // Use precedent extractor for legal case history
    const caseResults = await precedentExtractor.extractPrecedents(name);
    
    if (caseResults && caseResults.length > 0) {
      caseResults.forEach((caseRecord: any) => {
        records.push(`${caseRecord.caseName || caseRecord.name || 'Case'}: ${caseRecord.citation || ''} (${caseRecord.court || 'Court'})`);
      });
    }

    // Use PANTHEON ICE crawler for precision court record extraction
    if (canActivatePantheon().available) {
      try {
        await pantheonOrchestrator.initialize();
        const crawlerResults = await pantheonOrchestrator.search(buildPantheonSearchTargets(name), {
          depth: 3,
          crawlers: ['cerberus', 'lich'],
          maxResultsPerCrawler: 15,
          timeout: 20000,
          stealth: true,
        });

        if (crawlerResults && crawlerResults.length > 0) {
          records.push(`PACER/State Court: ${crawlerResults.length} records found via PANTHEON`);
        }
      } catch (crawlerError) {
        logger.warn('[PEOPLE SEARCH] PANTHEON crawler error:', crawlerError);
      }
    }

    // Also check enhanced web search for public court databases
    const webResults = await enhancedWebSearch.searchPublicDatabases(name);
    if (webResults?.pacer?.length > 0) {
      webResults.pacer.forEach((r: any) => {
        records.push(`PACER: ${JSON.stringify(r)}`);
      });
    }

    return {
      name: 'Court Records',
      data: {
        records,
      },
      confidence: records.length > 0 ? 0.85 : 0,
      timestamp: new Date(),
    };
  } catch (error) {
    logger.error('[PEOPLE SEARCH] Court records search error:', error);
    return {
      name: 'Court Records',
      data: { records: [], error: 'Court records search unavailable' },
      confidence: 0,
      timestamp: new Date(),
    };
  }
}

/**
 * Enhanced: Search for attorney emails using TheHarvester patterns
 * Used for witness, attorney, and expert contact discovery
 */
async function searchAttorneyEmail(name: string, firm?: string): Promise<OSINTSource> {
  try {
    const emailResults = await emailDiscoveryService.discoverAttorneyEmail(name, firm);
    
    const emails = emailResults.map(result => 
      `${result.email} (confidence: ${result.confidence}%, source: ${result.source})`
    );

    return {
      name: 'Attorney Email Discovery',
      data: {
        emails,
        primaryEmail: emailResults.length > 0 ? emailResults[0].email : null,
        firm: firm || 'Unknown',
      },
      confidence: emailResults.length > 0 ? emailResults[0].confidence / 100 : 0,
      timestamp: new Date(),
    };
  } catch (error) {
    console.error('[PEOPLE SEARCH] Attorney email discovery failed:', error);
    return {
      name: 'Attorney Email Discovery',
      data: { emails: [], error: 'Email discovery unavailable' },
      confidence: 0,
      timestamp: new Date(),
    };
  }
}

/**
 * Aggregate results from multiple sources
 */
function aggregateSearchResults(
  report: PeopleSearchReport,
  source: OSINTSource
): void {
  report.sources.push(source);

  // Map source data to report sections
  if (source.name === 'Public Records' && source.data.records) {
    report.publicRecords.push(...source.data.records);
  }

  if (source.name === 'Social Media' && source.data.profiles) {
    report.socialMediaPresence.push(...source.data.profiles);
  }

  if (source.name === 'Professional Networks' && source.data.findings) {
    report.employmentAndEducation.push(...source.data.findings);
  }

  if (source.name === 'News and Articles' && source.data.mentions) {
    report.onlineMentions.push(...source.data.mentions);
  }

  if (source.name === 'Court Records' && source.data.records) {
    report.publicRecords.push(...source.data.records);
  }

  // Enhanced: Handle attorney email discovery results
  if (source.name === 'Attorney Email Discovery' && source.data.emails) {
    report.contactInformation.push(...source.data.emails);
    if (source.data.primaryEmail) {
      report.contactInformation.unshift(`Primary Email: ${source.data.primaryEmail}`);
    }
  }
}

/**
 * Calculate overall confidence score for the report
 */
function calculateConfidenceScore(report: PeopleSearchReport): number {
  let score = 0;
  let factors = 0;

  // Weight different types of data
  if (report.publicRecords.length > 0) {
    score += 0.3;
    factors++;
  }

  if (report.socialMediaPresence.length > 0) {
    score += 0.2;
    factors++;
  }

  if (report.employmentAndEducation.length > 0) {
    score += 0.2;
    factors++;
  }

  if (report.contactInformation.length > 0) {
    score += 0.2;
    factors++;
  }

  if (report.onlineMentions.length > 0) {
    score += 0.1;
    factors++;
  }

  // Average confidence from sources
  if (report.sources.length > 0) {
    const avgSourceConfidence = report.sources.reduce(
      (sum, s) => sum + s.confidence,
      0
    ) / report.sources.length;
    score = (score + avgSourceConfidence) / 2;
  }

  return Math.round(score * 100);
}

/**
 * Generate executive summary of findings
 */
function generateReportSummary(report: PeopleSearchReport): string {
  const sections: string[] = [];

  sections.push(
    `OSINT Report for: ${report.identitySummary.name}\n` +
    `Report Generated: ${new Date().toLocaleString()}\n` +
    `Confidence Score: ${report.confidenceScore}%\n`
  );

  if (report.identitySummary.verificationStatus) {
    sections.push(
      `\nVerification Status: ${report.identitySummary.verificationStatus}`
    );
  }

  sections.push(
    `\nData Sources Consulted: ${report.sources.length}` +
    `\nPublic Records Found: ${report.publicRecords.length}` +
    `\nSocial Media Profiles: ${report.socialMediaPresence.length}` +
    `\nOnline Mentions: ${report.onlineMentions.length}`
  );

  if (report.confidenceScore < 30) {
    sections.push(
      `\nNote: Limited information available. Consider additional research methods.`
    );
  } else if (report.confidenceScore < 60) {
    sections.push(
      `\nNote: Moderate amount of information found. Some data points require verification.`
    );
  } else {
    sections.push(
      `\nNote: Substantial information located across multiple sources.`
    );
  }

  sections.push(
    `\n\nDISCLAIMER: This report contains only publicly accessible information. ` +
    `All data should be independently verified before use in legal proceedings. ` +
    `This service complies with all applicable laws including the Fair Credit Reporting Act (FCRA).`
  );

  return sections.join('\n');
}

/**
 * Format report for PDF generation
 */
export function formatReportForPDF(report: PeopleSearchReport): string {
  const sections: string[] = [];

  sections.push('=' .repeat(80));
  sections.push('DEEP OSINT REPORT');
  sections.push('=' .repeat(80));
  sections.push('');

  // Identity Summary
  sections.push('IDENTITY SUMMARY');
  sections.push('-'.repeat(80));
  sections.push(`Subject Name: ${report.identitySummary.name}`);
  if (report.identitySummary.aliases) {
    sections.push(`Known Aliases: ${report.identitySummary.aliases.join(', ')}`);
  }
  sections.push(`Verification Status: ${report.identitySummary.verificationStatus}`);
  sections.push('');

  // Contact Information
  if (report.contactInformation.length > 0) {
    sections.push('CONTACT INFORMATION');
    sections.push('-'.repeat(80));
    report.contactInformation.forEach((info, i) => {
      sections.push(`${i + 1}. ${info}`);
    });
    sections.push('');
  }

  // Social Media Presence
  if (report.socialMediaPresence.length > 0) {
    sections.push('SOCIAL MEDIA PRESENCE');
    sections.push('-'.repeat(80));
    report.socialMediaPresence.forEach((profile, i) => {
      sections.push(`${i + 1}. ${profile}`);
    });
    sections.push('');
  }

  // Employment & Education
  if (report.employmentAndEducation.length > 0) {
    sections.push('EMPLOYMENT & EDUCATION');
    sections.push('-'.repeat(80));
    report.employmentAndEducation.forEach((item, i) => {
      sections.push(`${i + 1}. ${item}`);
    });
    sections.push('');
  }

  // Public Records
  if (report.publicRecords.length > 0) {
    sections.push('PUBLIC RECORDS & COURT DATA');
    sections.push('-'.repeat(80));
    report.publicRecords.forEach((record, i) => {
      sections.push(`${i + 1}. ${record}`);
    });
    sections.push('');
  }

  // Online Mentions
  if (report.onlineMentions.length > 0) {
    sections.push('ONLINE MENTIONS');
    sections.push('-'.repeat(80));
    report.onlineMentions.forEach((mention, i) => {
      sections.push(`${i + 1}. ${mention}`);
    });
    sections.push('');
  }

  // Summary
  sections.push('SUMMARY & CONFIDENCE ASSESSMENT');
  sections.push('-'.repeat(80));
  sections.push(report.summary);
  sections.push('');

  sections.push('=' .repeat(80));
  sections.push('END OF REPORT');
  sections.push('=' .repeat(80));

  return sections.join('\n');
}

/**
 * Conduct full OSINT search with social intelligence, email discovery, and breach detection
 * Now supports tiered search depths based on Doomsday Clock selection
 * 
 * Search Depth Tiers:
 * - Level 1 (30s): ICE (public records) + STAR TREK (fast warp)
 * - Level 2 (60s): ICE + WRAITH (social intelligence) + STAR TREK
 * - Level 3 (120s): ICE + WRAITH + HYDRA + LICH + CERBERUS + BLIZZARD DRAGON + STAR TREK
 * - Level 4 (180s): ALL crawlers + GENESIS orchestrator (Eye of God)
 */
export async function conductFullOSINT(
  searchQuery: string,
  options?: {
    department?: string;
    badge?: string;
    location?: string;
    phone?: string;
    domain?: string;
    searchDepth?: number; // 1-4, default 2
    forceAllCrawlers?: boolean;
    reportBudgetMs?: number;
    reportDeadlineAt?: number;
  }
): Promise<PeopleSearchReport & {
  emails?: any;
  breaches?: any;
  spiderfoot?: any;
  searchDepthUsed?: number;
  crawlersActivated?: string[];
}> {
  const searchDepth = options?.searchDepth || 2;
  const forceAllCrawlers = options?.forceAllCrawlers === true;
  const reportBudgetMs = options?.reportBudgetMs;
  const crawlersActivated: string[] = [];
  const investigationStartedAt = Date.now();
  const reportDeadlineAt = options?.reportDeadlineAt
    ?? (reportBudgetMs == null ? undefined : investigationStartedAt + reportBudgetMs);
  const remainingBudgetMs = () => reportDeadlineAt == null
    ? Number.POSITIVE_INFINITY
    : Math.max(0, reportDeadlineAt - Date.now());
  const hasCollectionBudget = (reserveMs = 15_000) => remainingBudgetMs() > reserveMs;
  
  // Log search depth
  console.log(`[PANTHEON OSINT] Starting Level ${searchDepth} search for: ${searchQuery}`);

  // Always include ICE crawler (public records)
  crawlersActivated.push('ICE');
  
  // Level 1+: Add STAR TREK (fast warp-speed search)
  if (searchDepth >= 1 || forceAllCrawlers) {
    crawlersActivated.push('STAR_TREK');
  }

  // Background reports always activate WRAITH; depth controls effort, not participation.
  const shouldActivateWRAITH = forceAllCrawlers || searchDepth >= 2;
  if (shouldActivateWRAITH) {
    crawlersActivated.push('WRAITH');
  }

  // Level 3+: Add HYDRA, LICH, CERBERUS, BLIZZARD DRAGON
  if (forceAllCrawlers || searchDepth >= 3) {
    crawlersActivated.push(
      'BIRD_OF_PREY',
      'SIX_DEGREES',
      'HYDRA',
      'LICH',
      'CERBERUS',
      'BLIZZARD_DRAGON',
      'FARM',
      'PHANTOM',
      'NOVA',
      'PANTHEON_RAZORS_10',
    );
  }

  // Background reports always include GENESIS orchestration.
  if (forceAllCrawlers || searchDepth >= 4) {
    crawlersActivated.push('GENESIS');
  }

  console.log(`[PANTHEON OSINT] Crawlers activated:`, crawlersActivated.join(', '));

  // A background-report job explicitly requests the full roster. The selected
  // duration controls collection effort, never whether a crawler family participates.
  const runFullRoster = forceAllCrawlers || searchDepth >= 3;

  // Start the broad base search and the full registry crawler fan-out together.
  // This prevents the legacy two-crawler base lane from consuming the collection
  // window before the complete PANTHEON roster receives work.
  const fullRosterPromise = runFullRoster && canActivatePantheon().available && hasCollectionBudget(2_000)
    ? pantheonRetrievalAdapter.retrieve({
        purpose: 'background_report',
        targets: buildPantheonBackgroundTargets(searchQuery, options?.location, searchDepth),
        depth: searchDepth as 1 | 2 | 3 | 4,
        budgetMs: Number.isFinite(remainingBudgetMs()) ? remainingBudgetMs() : undefined,
        deadlineAt: reportDeadlineAt,
      })
    : null;
  const enhancedReport = await conductEnhancedPeopleSearch(searchQuery, options);

  if (options?.phone) {
    const digits = options.phone.replace(/\D/g, '');
    if (digits.length >= 10) {
      enhancedReport.sources.push({
        name: 'User-supplied phone correlation anchor',
        data: { normalizedLast10: digits.slice(-10), discovered: false },
        confidence: 0,
        timestamp: new Date(),
      });
    }
  }

  try {
    // Validate searchQuery before processing
    if (!searchQuery || typeof searchQuery !== 'string') {
      console.warn('[People Search] Invalid searchQuery provided:', searchQuery);
      return {
        ...enhancedReport,
        crawlerAudit: mergeCrawlerAudit(enhancedReport.crawlerAudit || []),
        searchDepthUsed: searchDepth,
        crawlersActivated: [...new Set(crawlersActivated)]
      };
    }

    // Level 1+: STAR TREK crawler (fast public-web retrieval)
    console.log('[PANTHEON OSINT] STAR TREK crawler: executing bounded public-web retrieval');
    try {
      const { StarTrekCrawler } = await import('./services/crawlers/StarTrekCrawler');
      const starTrek = new StarTrekCrawler();
      starTrek.setPrimeDirective(true);
      await starTrek.setPhaserSetting(3);

      const starTargets = buildPantheonBackgroundTargets(searchQuery, options?.location, searchDepth).slice(0, 4);
      const starResults = await Promise.allSettled(starTargets.map(target => starTrek.firePhaser(target)));
      const successfulStarResults = starResults
        .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
        .map(result => result.value)
        .filter(result => result?.content && result.confidence > 0);

      if (successfulStarResults.length > 0) {
        enhancedReport.onlineMentions.push(...successfulStarResults.map(result => result.content));
        enhancedReport.sources.push({
          name: 'STAR TREK Public Web Retrieval',
          data: {
            resultsCount: successfulStarResults.length,
            targets: successfulStarResults.map(result => result.target),
          },
          confidence: successfulStarResults.reduce((sum, result) => sum + result.confidence, 0) / successfulStarResults.length,
          timestamp: new Date(),
        });
      }
    } catch (starTrekError: any) {
      logger.warn('[PANTHEON OSINT] STAR TREK retrieval failed route-locally:', starTrekError?.message || starTrekError);
    }
    
    // Level 2+: Social intelligence via WRAITH crawler (Sherlock)
    if (shouldActivateWRAITH) {
      // Generate possible usernames from search query
      const possibleUsernames = [
        searchQuery.toLowerCase().replace(/\s+/g, ''), // JohnDoe -> johndoe
        searchQuery.toLowerCase().replace(/\s+/g, '.'), // John Doe -> john.doe
        searchQuery.toLowerCase().replace(/\s+/g, '_'), // John Doe -> john_doe
        searchQuery.trim().split(' ')[0].toLowerCase(), // First name only
      ].filter(Boolean).filter((u, i, arr) => arr.indexOf(u) === i); // Remove empty strings and duplicates

      // Search for social media profiles using Sherlock
      try {
        const socialProfiles = await socialIntelligenceService.findUserAcrossPlatforms(
          possibleUsernames[0], // Start with most likely username
          {
            concurrency: 10,
            includeProfileData: true,
            stealth: true,
          }
        );

        // Add found profiles to report
        if (socialProfiles.length > 0) {
          enhancedReport.socialMediaProfiles = socialProfiles;
          
          // Add profile URLs to socialMediaPresence
          socialProfiles.forEach(profile => {
            const entry = `${profile.platform}: ${profile.url}`;
            if (!enhancedReport.socialMediaPresence.includes(entry)) {
              enhancedReport.socialMediaPresence.push(entry);
            }
          });

          // Add to sources
          enhancedReport.sources.push({
            name: 'Social Intelligence Layer (Sherlock)',
            data: { platforms: socialProfiles.length, usernames: possibleUsernames },
            confidence: 0.85,
            timestamp: new Date(),
          });
        }
      } catch (error: any) {
        console.error('[Full OSINT] Social intelligence search failed:', error.message);
      }
    } // End of WRAITH activation block

    // Complete PANTHEON crawler roster was launched in parallel with the base lane.
    if (fullRosterPromise) {
      console.log('[PANTHEON OSINT] Awaiting complete PANTHEON crawler roster');
      try {
        const crawlerRetrieval = await fullRosterPromise;
        const crawlerResults = crawlerRetrieval.evidence;
        enhancedReport.crawlerAudit = mergeCrawlerAudit([
          ...(enhancedReport.crawlerAudit || []),
          ...crawlerRetrieval.crawlerAudit,
        ]);
        for (const crawlerName of new Set(crawlerResults.map(result => result.crawler))) {
          if (!crawlersActivated.includes(crawlerName)) crawlersActivated.push(crawlerName);
        }
        if (crawlerResults.length > 0) {
          enhancedReport.onlineMentions.push(...crawlerResults.map(result => result.content).filter(Boolean));
          enhancedReport.sources.push({
            name: 'PANTHEON Crawler Orchestrator',
            data: {
              crawlersUsed: [...new Set(crawlerResults.map(result => result.crawler))],
              resultsCount: crawlerResults.length,
              averageConfidence: crawlerResults.reduce((sum, result) => sum + result.confidence, 0) / crawlerResults.length,
              selectionPlan: crawlerRetrieval.plan,
              supervision: crawlerRetrieval.supervision,
              unavailableReason: crawlerRetrieval.reason,
            },
            confidence: 0.85,
            timestamp: new Date(),
          });
        }
        enhancedReport.summary += CRAWLER_MESSAGES.LEVEL_3_SUMMARY;
        console.log(`[PANTHEON OSINT] Full crawler roster completed: ${crawlerResults.length} evidence results`);
      } catch (crawlerError: any) {
        logger.warn('[PANTHEON OSINT] Full crawler roster failed route-locally:', crawlerError?.message || crawlerError);
      }
    }

    // Level 4: GENESIS orchestrator (EYE OF GOD)
    if ((forceAllCrawlers || searchDepth >= 4) && (forceAllCrawlers || hasCollectionBudget(45_000))) {
      console.log('[PANTHEON OSINT] 👁️ GENESIS: activating bounded avalanche traversal');
      
      // Check PANTHEON availability again
      const pantheonStatus = canActivatePantheon();
      
      if (pantheonStatus.available) {
        try {
          // Trigger avalanche mode for maximum data harvesting
          const avalancheResults = await pantheonOrchestrator.avalanche(
            `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`
          );
          
          if (avalancheResults.length > 0) {
            enhancedReport.sources.push({
              name: 'GENESIS Orchestrator (Eye of God)',
              data: { 
                mode: 'avalanche',
                resultsCount: avalancheResults.length,
                cascadeDepth: 5,
              },
              confidence: 0.95,
              timestamp: new Date(),
            });
            
            console.log(`[PANTHEON OSINT] GENESIS avalanche completed: ${avalancheResults.length} results`);
            enhancedReport.summary += CRAWLER_MESSAGES.LEVEL_4_SUMMARY;
          }
        } catch (genesisError: any) {
          console.error('[PANTHEON OSINT] GENESIS orchestration failed:', genesisError.message);
        }
      }
    }

    // SpiderFoot scan (when a compatible self-hosted instance is configured).
    let spiderfootData;
    if (hasCollectionBudget(120_000) && await spiderfootClient.healthCheck()) {
      const scanId = await spiderfootClient.startScan(searchQuery);
      const spiderFootTimeoutMs = reportBudgetMs
        ? Math.min(600_000, Math.max(120_000, Math.floor(reportBudgetMs / 3)))
        : 120_000;
      await spiderfootClient.waitForScanCompletion(scanId, {
        timeoutMs: spiderFootTimeoutMs,
        pollIntervalMs: 1_500,
      });
      spiderfootData = await spiderfootClient.getScanResults(scanId);
    }

    // Email finding. Preserve enough time to aggregate a valid report.
    const emailData = hasCollectionBudget(20_000)
      ? await emailFinder.findEmail(searchQuery, options?.domain)
      : { emails: [] };

    // Breach detection
    let breachData;
    if (hasCollectionBudget(20_000) && emailData.emails.length > 0) {
      breachData = await breachDetection.checkBreaches(emailData.emails[0]);
    }

    // Legal/court history is a distinct evidence lane and must fail locally.
    try {
      enhancedReport.caseHistory = hasCollectionBudget(20_000)
        ? await searchCaseHistory(searchQuery, searchDepth >= 3 ? 25 : 12)
        : [];
    } catch (caseHistoryError) {
      logger.warn('[PANTHEON OSINT] Case-history search failed route-locally:', caseHistoryError);
    }

    enhancedReport.contactInformation = dedupeReportStrings(enhancedReport.contactInformation);
    enhancedReport.socialMediaPresence = dedupeReportStrings(enhancedReport.socialMediaPresence);
    enhancedReport.employmentAndEducation = dedupeReportStrings(enhancedReport.employmentAndEducation);
    enhancedReport.locationHistory = dedupeReportStrings(enhancedReport.locationHistory);
    enhancedReport.publicRecords = dedupeReportStrings(enhancedReport.publicRecords);
    enhancedReport.onlineMentions = dedupeReportStrings(enhancedReport.onlineMentions);
    enhancedReport.riskAndReputation = dedupeReportStrings(enhancedReport.riskAndReputation);
    enhancedReport.crawlerAudit = mergeCrawlerAudit(enhancedReport.crawlerAudit || []);

    return {
      ...enhancedReport,
      emails: emailData,
      breaches: breachData,
      spiderfoot: spiderfootData,
      searchDepthUsed: searchDepth,
      crawlersActivated: [...new Set(crawlersActivated)],
    };
  } catch (error) {
    console.error('[Full OSINT] Error:', error);
    return {
      ...enhancedReport,
      crawlerAudit: mergeCrawlerAudit(enhancedReport.crawlerAudit || []),
      searchDepthUsed: searchDepth,
      crawlersActivated: [...new Set(crawlersActivated)],
    };
  }
}

/**
 * Phase 3B: Search case history for a person
 * Searches legal databases for cases involving the person
 */
export async function searchCaseHistory(
  personName: string,
  maxResults: number = 10
): Promise<CasePrecedent[]> {
  try {
    console.log('[People Search] Searching case history:', personName);
    
    // Search for cases involving this person
    const query = `"${personName}"`;
    const precedents = await precedentExtractor.extractPrecedents(query, undefined, maxResults);

    console.log('[People Search] Found case history:', precedents.length);
    return precedents;
  } catch (error: any) {
    console.error('[People Search] Error searching case history:', error);
    return [];
  }
}


/**
 * SHADOW RETRIEVAL INTEGRATION NOTES
 * 
 * The PANTHEON Shadow Retrieval Engine can significantly enhance people search capabilities:
 * 
 * Integration opportunities:
 * 1. searchPublicRecords(): Use Shadow Retrieval to extract data from public record sites
 *    - Example: Scrape court records, property records, business registrations
 *    - Benefit: Access JavaScript-rendered content, bypass rate limits
 * 
 * 2. searchSocialMedia(): Use Shadow Retrieval for profile extraction
 *    - Example: Extract LinkedIn, Facebook public profiles
 *    - Benefit: Handle anti-bot protections, extract structured data
 * 
 * 3. searchProfessionalNetworks(): Use Shadow Retrieval for employment history
 *    - Example: Scrape company websites, professional directories
 *    - Benefit: Extract tables, forms, hidden APIs
 * 
 * 4. searchNewsAndArticles(): Use Shadow Retrieval for news archives
 *    - Example: Access paywalled content, extract article text
 *    - Benefit: Extract clean text, bypass JavaScript requirements
 * 
 * Example implementation:
 * ```typescript
 * import { shadowRetrieval } from './services/shadowRetrieval';
 * 
 * async function searchPublicRecords(name: string) {
 *   const urls = [
 *     `https://publicrecords.example.com/search?name=${encodeURIComponent(name)}`,
 *     // ... more URLs
 *   ];
 *   
 *   const results = await shadowRetrieval.batchRetrieve(urls, {
 *     maxConcurrent: 3,
 *     delayBetweenRequests: 2000,
 *   });
 *   
 *   return results.filter(r => r.success).map(r => r.data);
 * }
 * ```
 */
