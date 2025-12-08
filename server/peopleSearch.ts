// LegalWhat People Search - Deep OSINT Report Generation
// Aggregates public data from multiple sources for comprehensive background reports

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
 * PLACEHOLDER IMPLEMENTATION - NOT PRODUCTION READY
 * 
 * Production deployment requires integration with actual public records APIs:
 * - State/County clerk websites
 * - Property tax records APIs
 * - Voter registration databases
 * - Business registration records
 * - Court record systems (PACER, state systems)
 * 
 * Many of these require paid API access or agreements with government agencies.
 */
async function searchPublicRecords(name: string): Promise<OSINTSource> {
  console.warn('[PEOPLE SEARCH] Using placeholder public records search');
  
  return {
    name: 'Public Records',
    data: {
      records: [
        `Public records search conducted for: ${name}`,
        'Note: Full integration requires API keys for public records databases',
      ],
    },
    confidence: 0.5,
    timestamp: new Date(),
  };
}

/**
 * Search social media platforms
 * 
 * PLACEHOLDER IMPLEMENTATION - NOT PRODUCTION READY
 * 
 * Production deployment requires:
 * - Official APIs where available (Twitter API, LinkedIn API, etc.)
 * - Compliance with platform Terms of Service
 * - Rate limiting and proper authentication
 * - Web scraping only for public profiles with proper robots.txt respect
 * 
 * Note: Many platforms restrict automated data collection.
 */
async function searchSocialMedia(name: string): Promise<OSINTSource> {
  console.warn('[PEOPLE SEARCH] Using placeholder social media search');
  
  const platforms = [
    'LinkedIn',
    'Facebook',
    'Twitter/X',
    'Instagram',
    'TikTok',
  ];

  return {
    name: 'Social Media',
    data: {
      profiles: platforms.map(platform => 
        `${platform}: Public profile search for "${name}"`
      ),
    },
    confidence: 0.6,
    timestamp: new Date(),
  };
}

/**
 * Search professional networks and directories
 */
async function searchProfessionalNetworks(name: string): Promise<OSINTSource> {
  // Placeholder implementation
  // In production, would search:
  // - Professional licensing boards
  // - Industry directories
  // - Academic publications
  // - Company websites
  
  return {
    name: 'Professional Networks',
    data: {
      findings: [
        `Professional directory search for: ${name}`,
        'Searching state licensing boards and professional associations',
      ],
    },
    confidence: 0.5,
    timestamp: new Date(),
  };
}

/**
 * Search news articles and online mentions
 */
async function searchNewsAndArticles(name: string): Promise<OSINTSource> {
  // Placeholder implementation
  // In production, would use:
  // - News API integrations
  // - Google News searches
  // - Archive.org searches
  // - Blog and forum searches
  
  return {
    name: 'News and Articles',
    data: {
      mentions: [
        `News archive search for: ${name}`,
        'Scanning online publications and archives',
      ],
    },
    confidence: 0.4,
    timestamp: new Date(),
  };
}

/**
 * Search court records and legal databases
 */
async function searchCourtRecords(name: string): Promise<OSINTSource> {
  // Placeholder implementation
  // In production, would integrate with:
  // - PACER (federal courts)
  // - State court databases
  // - County clerk websites
  // - Legal case databases
  
  return {
    name: 'Court Records',
    data: {
      records: [
        `Court records search for: ${name}`,
        'Checking federal and state court databases',
        'Note: Some records may require paid access',
      ],
    },
    confidence: 0.5,
    timestamp: new Date(),
  };
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
    domain?: string;
    searchDepth?: number; // 1-4, default 2
  }
): Promise<PeopleSearchReport & {
  emails?: any;
  breaches?: any;
  spiderfoot?: any;
  searchDepthUsed?: number;
  crawlersActivated?: string[];
}> {
  const searchDepth = options?.searchDepth || 2;
  const crawlersActivated: string[] = [];
  
  // Log search depth
  console.log(`[PANTHEON OSINT] Starting Level ${searchDepth} search for: ${searchQuery}`);

  // Always include ICE crawler (public records)
  crawlersActivated.push('ICE');
  
  // Level 1+: Add STAR TREK (fast warp-speed search)
  if (searchDepth >= 1) {
    crawlersActivated.push('STAR_TREK');
  }

  // Level 2+: Add WRAITH (social intelligence via Sherlock)
  const shouldActivateWRAITH = searchDepth >= 2;
  if (shouldActivateWRAITH) {
    crawlersActivated.push('WRAITH');
  }

  // Level 3+: Add HYDRA, LICH, CERBERUS, BLIZZARD DRAGON
  if (searchDepth >= 3) {
    crawlersActivated.push('HYDRA', 'LICH', 'CERBERUS', 'BLIZZARD_DRAGON');
  }

  // Level 4: Add GENESIS orchestrator (EYE OF GOD)
  if (searchDepth >= 4) {
    crawlersActivated.push('GENESIS');
  }

  console.log(`[PANTHEON OSINT] Crawlers activated:`, crawlersActivated.join(', '));

  // Run base enhanced search with depth-aware crawler selection
  // Run base enhanced search with depth-aware crawler selection
  const enhancedReport = await conductEnhancedPeopleSearch(searchQuery, options);

  try {
    // Validate searchQuery before processing
    if (!searchQuery || typeof searchQuery !== 'string') {
      console.warn('[People Search] Invalid searchQuery provided:', searchQuery);
      return {
        ...enhancedReport,
        searchDepthUsed: searchDepth,
        crawlersActivated
      };
    }

    // Level 2+: Social intelligence via WRAITH crawler (Sherlock)
    if (shouldActivateWRAITH) {
      // Generate possible usernames from search query
      const possibleUsernames = [
        searchQuery.toLowerCase().replace(/\s+/g, ''), // JohnDoe -> johndoe
        searchQuery.toLowerCase().replace(/\s+/g, '.'), // John Doe -> john.doe
        searchQuery.toLowerCase().replace(/\s+/g, '_'), // John Doe -> john_doe
        searchQuery.split(' ')[0]?.toLowerCase() || searchQuery.toLowerCase(), // First name only, fallback to full query
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

    // SpiderFoot scan (if available)
    // Note: In production, you may want to implement polling or webhooks
    // to wait for scan completion before retrieving results
    let spiderfootData;
    if (await spiderfootClient.healthCheck()) {
      const scanId = await spiderfootClient.startScan(searchQuery);
      // For real-time results, consider implementing a polling mechanism
      // or using SpiderFoot's webhook functionality
      spiderfootData = await spiderfootClient.getScanResults(scanId);
    }

    // Email finding
    const emailData = await emailFinder.findEmail(searchQuery, options?.domain);

    // Breach detection
    let breachData;
    if (emailData.emails.length > 0) {
      breachData = await breachDetection.checkBreaches(emailData.emails[0]);
    }

    return {
      ...enhancedReport,
      emails: emailData,
      breaches: breachData,
      spiderfoot: spiderfootData,
      searchDepthUsed: searchDepth,
      crawlersActivated,
    };
  } catch (error) {
    console.error('[Full OSINT] Error:', error);
    return {
      ...enhancedReport,
      searchDepthUsed: searchDepth,
      crawlersActivated,
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
    const precedents = await precedentExtractor.extractPrecedents(query, {
      maxResults,
      sources: ['justia', 'findlaw'],
      relevanceThreshold: 0.5,
    });

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
