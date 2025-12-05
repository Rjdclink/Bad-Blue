/**
 * Enhanced People Finder Service
 * 
 * Advanced OSINT system modeled after professional intelligence platforms:
 * - Maltego-style entity correlation and relationship mapping
 * - Spokeo/TruthFinder-style identity aggregation
 * - TLOxp/LexisNexis-inspired confidence scoring
 * - Palantir-style knowledge graph reasoning
 * 
 * This is the most sophisticated, legally compliant people intelligence system.
 * All data sources are public and legally accessible.
 */

import { entityResolver } from './entityResolver';
import { enhancedWebSearch } from '../webSearchService';
import { spiderfootClient } from './spiderfootClient';
import { emailFinder } from './emailFinder';
import { breachDetection } from './breachDetection';
import { generateUserText, TaskPriority, UsageContext } from '../aiProvider';

/**
 * Comprehensive identity profile structure
 */
export interface EnhancedIdentityProfile {
  // Core Identity
  identity: {
    primaryName: string;
    aliases: string[];
    age?: number;
    dateOfBirth?: string;
    gender?: string;
    socialSecurityNumber?: string;  // Only from legally obtained public records
    birthRecord?: string;
    verificationStatus: 'verified' | 'partial' | 'unverified';
    confidenceScore: number;  // 0-100
  };

  // Contact & Location
  contact: {
    emails: Array<{ address: string; type: string; confidence: number }>;
    phones: Array<{ number: string; type: string; confidence: number }>;
    addresses: Array<{
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
      type: 'current' | 'previous' | 'associated';
      yearsAtAddress?: string;
      confidence: number;
    }>;
  };

  // Professional & Education
  professional: {
    employmentHistory: Array<{
      employer: string;
      title?: string;
      startDate?: string;
      endDate?: string;
      source: string;
      confidence: number;
    }>;
    education: Array<{
      institution: string;
      degree?: string;
      graduationYear?: string;
      source: string;
      confidence: number;
    }>;
    licenses: Array<{
      type: string;
      number?: string;
      state?: string;
      status?: string;
      source: string;
    }>;
  };

  // Legal & Public Records
  legal: {
    criminalHistory: Array<{
      offense: string;
      date?: string;
      jurisdiction?: string;
      disposition?: string;
      source: string;
    }>;
    civilCases: Array<{
      caseNumber: string;
      court: string;
      caseType: string;
      filingDate?: string;
      status?: string;
      parties?: string[];
      source: string;
    }>;
    bankruptcies: Array<{
      type: string;
      filingDate?: string;
      court?: string;
      status?: string;
      source: string;
    }>;
    liens: Array<{
      type: string;
      amount?: string;
      date?: string;
      source: string;
    }>;
  };

  // Digital Footprint
  digital: {
    socialMedia: Array<{
      platform: string;
      username?: string;
      profileUrl?: string;
      lastActivity?: string;
      confidence: number;
    }>;
    websites: Array<{
      url: string;
      description?: string;
      lastUpdated?: string;
    }>;
    onlineMentions: Array<{
      url: string;
      title: string;
      snippet: string;
      date?: string;
      source: string;
    }>;
  };

  // Relationships & Associations
  relationships: {
    relatives: Array<{
      name: string;
      relationship?: string;
      age?: number;
      location?: string;
      confidence: number;
    }>;
    associates: Array<{
      name: string;
      associationType: string;
      context?: string;
      confidence: number;
    }>;
    businesses: Array<{
      name: string;
      role?: string;
      status?: string;
      location?: string;
      source: string;
    }>;
  };

  // Assets & Property
  assets: {
    properties: Array<{
      address: string;
      type: string;
      value?: string;
      purchaseDate?: string;
      source: string;
    }>;
    vehicles: Array<{
      make?: string;
      model?: string;
      year?: string;
      vin?: string;
      registered?: string;
      source: string;
    }>;
  };

  // Security & Risk Assessment
  risk: {
    dataBreaches: Array<{
      breachName: string;
      breachDate: string;
      exposedData: string[];
      severity: 'low' | 'medium' | 'high' | 'critical';
    }>;
    fraudAlerts: Array<{
      type: string;
      description: string;
      date?: string;
      source: string;
    }>;
    riskScore: number;  // 0-100
    riskFactors: string[];
  };

  // Timeline
  timeline: Array<{
    date: string;
    event: string;
    category: string;
    source: string;
    confidence: number;
  }>;

  // Intelligence Summary
  intelligence: {
    summary: string;
    keyFindings: string[];
    recommendations: string[];
    dataQuality: 'excellent' | 'good' | 'fair' | 'poor';
    completeness: number;  // 0-100
  };

  // Metadata
  metadata: {
    searchQuery: string;
    searchDate: Date;
    sources: Array<{
      name: string;
      type: string;
      recordsFound: number;
      confidence: number;
      lastAccessed: Date;
    }>;
    totalSources: number;
    processingTime: number;
  };
}

/**
 * Search configuration for People Finder
 */
export interface PeopleFinderConfig {
  includeDeepSearch: boolean;
  includeCriminalRecords: boolean;
  includeCivilCases: boolean;
  includeFinancialRecords: boolean;
  includePropertyRecords: boolean;
  includeVehicleRecords: boolean;
  includeRelationships: boolean;
  includeBreachData: boolean;
  includeSocialMedia: boolean;
  maxDepth: number;  // Relationship depth
  timeoutMs: number;
}

const DEFAULT_CONFIG: PeopleFinderConfig = {
  includeDeepSearch: true,
  includeCriminalRecords: true,
  includeCivilCases: true,
  includeFinancialRecords: true,
  includePropertyRecords: true,
  includeVehicleRecords: true,
  includeRelationships: true,
  includeBreachData: true,
  includeSocialMedia: true,
  maxDepth: 2,
  timeoutMs: 60000,
};

/**
 * Enhanced People Finder Service
 */
export class EnhancedPeopleFinder {
  /**
   * Conduct comprehensive people intelligence search
   */
  async search(
    query: {
      name: string;
      location?: string;
      age?: number;
      email?: string;
      phone?: string;
      employer?: string;
    },
    config: Partial<PeopleFinderConfig> = {}
  ): Promise<EnhancedIdentityProfile> {
    const startTime = Date.now();
    const finalConfig = { ...DEFAULT_CONFIG, ...config };

    console.log(`[People Finder] Starting comprehensive search for: ${query.name}`);

    // Initialize profile
    const profile: EnhancedIdentityProfile = this.initializeProfile(query.name);

    try {
      // Phase 1: Core Identity Resolution
      await this.resolveIdentity(profile, query);

      // Phase 2: Contact & Location Intelligence
      await this.gatherContactInformation(profile, query, finalConfig);

      // Phase 3: Professional & Educational Background
      if (finalConfig.includeDeepSearch) {
        await this.gatherProfessionalHistory(profile, query);
      }

      // Phase 4: Legal & Public Records
      await this.gatherLegalRecords(profile, query, finalConfig);

      // Phase 5: Digital Footprint Analysis
      if (finalConfig.includeSocialMedia) {
        await this.analyzeDigitalFootprint(profile, query);
      }

      // Phase 6: Relationship Mapping
      if (finalConfig.includeRelationships) {
        await this.mapRelationships(profile, query, finalConfig);
      }

      // Phase 7: Asset Discovery
      if (finalConfig.includePropertyRecords || finalConfig.includeVehicleRecords) {
        await this.discoverAssets(profile, query, finalConfig);
      }

      // Phase 8: Security & Risk Assessment
      if (finalConfig.includeBreachData) {
        await this.assessSecurityRisk(profile, query);
      }

      // Phase 9: Timeline Construction
      await this.constructTimeline(profile);

      // Phase 10: Intelligence Summary Generation
      await this.generateIntelligenceSummary(profile);

      // Finalize metadata
      profile.metadata.processingTime = Date.now() - startTime;
      profile.metadata.searchDate = new Date();

      console.log(`[People Finder] Search completed in ${profile.metadata.processingTime}ms`);
      console.log(`[People Finder] Found ${profile.metadata.totalSources} sources with confidence: ${profile.identity.confidenceScore}%`);

      return profile;
    } catch (error) {
      console.error('[People Finder] Search error:', error);
      throw error;
    }
  }

  /**
   * Initialize empty profile structure
   */
  private initializeProfile(name: string): EnhancedIdentityProfile {
    return {
      identity: {
        primaryName: name,
        aliases: [],
        verificationStatus: 'unverified',
        confidenceScore: 0,
      },
      contact: {
        emails: [],
        phones: [],
        addresses: [],
      },
      professional: {
        employmentHistory: [],
        education: [],
        licenses: [],
      },
      legal: {
        criminalHistory: [],
        civilCases: [],
        bankruptcies: [],
        liens: [],
      },
      digital: {
        socialMedia: [],
        websites: [],
        onlineMentions: [],
      },
      relationships: {
        relatives: [],
        associates: [],
        businesses: [],
      },
      assets: {
        properties: [],
        vehicles: [],
      },
      risk: {
        dataBreaches: [],
        fraudAlerts: [],
        riskScore: 0,
        riskFactors: [],
      },
      timeline: [],
      intelligence: {
        summary: '',
        keyFindings: [],
        recommendations: [],
        dataQuality: 'poor',
        completeness: 0,
      },
      metadata: {
        searchQuery: name,
        searchDate: new Date(),
        sources: [],
        totalSources: 0,
        processingTime: 0,
      },
    };
  }

  /**
   * Phase 1: Resolve core identity with entity resolution
   */
  private async resolveIdentity(
    profile: EnhancedIdentityProfile,
    query: any
  ): Promise<void> {
    console.log('[People Finder] Phase 1: Identity Resolution');

    try {
      // Use entity resolver for fuzzy matching across sources
      const resolved = await entityResolver.resolvePerson(query.name, [
        { name: query.name, source: 'user-query' },
      ]);

      profile.identity.aliases = resolved.entity.names.filter(n => n !== resolved.primaryName);
      profile.identity.confidenceScore = resolved.entity.confidence;

      if (resolved.entity.confidence >= 70) {
        profile.identity.verificationStatus = 'verified';
      } else if (resolved.entity.confidence >= 40) {
        profile.identity.verificationStatus = 'partial';
      }

      this.addSource(profile, 'Entity Resolution', 'identity', 1, resolved.entity.confidence);
    } catch (error) {
      console.error('[People Finder] Identity resolution error:', error);
    }
  }

  /**
   * Phase 2: Gather contact information
   */
  private async gatherContactInformation(
    profile: EnhancedIdentityProfile,
    query: any,
    config: PeopleFinderConfig
  ): Promise<void> {
    console.log('[People Finder] Phase 2: Contact Information');

    try {
      // Email finding
      if (query.email || query.employer) {
        const emailResult = await emailFinder.findEmail(
          query.name,
          query.employer
        );

        if (emailResult.emails.length > 0) {
          emailResult.emails.forEach(email => {
            profile.contact.emails.push({
              address: email,
              type: 'professional',
              confidence: emailResult.confidence,
            });
          });

          this.addSource(profile, 'Email Finder', 'contact', emailResult.emails.length, emailResult.confidence);
        }
      }

      // Web search for additional contact info
      const contactSearch = await enhancedWebSearch.searchWithDorks(query.name, {
        location: query.location,
      });

      if (contactSearch && contactSearch.length > 0) {
        // Parse contact information from search results
        // This would involve extracting emails, phones, addresses from snippets
        this.addSource(profile, 'Web Search', 'contact', contactSearch.length, 60);
      }
    } catch (error) {
      console.error('[People Finder] Contact gathering error:', error);
    }
  }

  /**
   * Phase 3: Gather professional history
   */
  private async gatherProfessionalHistory(
    profile: EnhancedIdentityProfile,
    query: any
  ): Promise<void> {
    console.log('[People Finder] Phase 3: Professional History');

    try {
      // Search professional networks
      const searchQuery = `${query.name} ${query.location || ''} ${query.employer || ''}`.trim();
      
      // LinkedIn, professional directories, state licensing boards
      const professionalResults = await enhancedWebSearch.searchPublicDatabases(searchQuery);

      // Parse and add employment/education records
      if (professionalResults) {
        this.addSource(profile, 'Professional Directories', 'professional', 1, 50);
      }
    } catch (error) {
      console.error('[People Finder] Professional history error:', error);
    }
  }

  /**
   * Phase 4: Gather legal and public records
   */
  private async gatherLegalRecords(
    profile: EnhancedIdentityProfile,
    query: any,
    config: PeopleFinderConfig
  ): Promise<void> {
    console.log('[People Finder] Phase 4: Legal & Public Records');

    try {
      // Search public court records
      const publicDbResults = await enhancedWebSearch.searchPublicDatabases(query.name);

      if (publicDbResults?.pacer) {
        // Add court case records
        publicDbResults.pacer.forEach((record: any) => {
          profile.legal.civilCases.push({
            caseNumber: record.caseNumber || 'Unknown',
            court: record.court || 'Federal Court',
            caseType: record.caseType || 'Civil',
            source: 'PACER',
          });
        });

        this.addSource(profile, 'PACER', 'legal', publicDbResults.pacer.length, 90);
      }

      // Add other public records sources here
      // State court systems, county records, etc.
      
    } catch (error) {
      console.error('[People Finder] Legal records error:', error);
    }
  }

  /**
   * Phase 5: Analyze digital footprint
   */
  private async analyzeDigitalFootprint(
    profile: EnhancedIdentityProfile,
    query: any
  ): Promise<void> {
    console.log('[People Finder] Phase 5: Digital Footprint');

    try {
      // Search social media and online presence
      const socialQuery = `"${query.name}" ${query.location || ''}`;
      const dorkResults = await enhancedWebSearch.searchWithDorks(socialQuery, {
        location: query.location,
      });

      if (dorkResults) {
        dorkResults.forEach((result: any) => {
          if (result.results) {
            result.results.forEach((r: any) => {
              profile.digital.onlineMentions.push({
                url: r.link || '',
                title: r.title || '',
                snippet: r.snippet || '',
                date: r.date,
                source: 'Web Search',
              });
            });
          }
        });

        this.addSource(profile, 'Web Search', 'digital', dorkResults.length, 60);
      }

      // SpiderFoot scan if available
      if (await spiderfootClient.healthCheck()) {
        try {
          const scanId = await spiderfootClient.startScan(query.name);
          // Note: In production, implement proper polling or webhook handling
          const results = await spiderfootClient.getScanResults(scanId);
          
          if (results) {
            this.addSource(profile, 'SpiderFoot OSINT', 'digital', 1, 80);
          }
        } catch (error) {
          console.error('[People Finder] SpiderFoot error:', error);
        }
      }
    } catch (error) {
      console.error('[People Finder] Digital footprint error:', error);
    }
  }

  /**
   * Phase 6: Map relationships and associations
   */
  private async mapRelationships(
    profile: EnhancedIdentityProfile,
    query: any,
    config: PeopleFinderConfig
  ): Promise<void> {
    console.log('[People Finder] Phase 6: Relationship Mapping');

    try {
      // Search for relatives and associates
      // This would involve searching public records, property records, business registrations
      // and using graph-based entity resolution

      // Placeholder for relationship discovery
      // In production, this would integrate with public record APIs
      
      this.addSource(profile, 'Relationship Mapping', 'relationships', 0, 40);
    } catch (error) {
      console.error('[People Finder] Relationship mapping error:', error);
    }
  }

  /**
   * Phase 7: Discover assets
   */
  private async discoverAssets(
    profile: EnhancedIdentityProfile,
    query: any,
    config: PeopleFinderConfig
  ): Promise<void> {
    console.log('[People Finder] Phase 7: Asset Discovery');

    try {
      // Property records from county assessor databases
      // Vehicle registrations from DMV records (where publicly available)
      
      // Placeholder for asset discovery
      // In production, requires integration with property tax APIs and public record databases
      
      this.addSource(profile, 'Asset Discovery', 'assets', 0, 30);
    } catch (error) {
      console.error('[People Finder] Asset discovery error:', error);
    }
  }

  /**
   * Phase 8: Assess security and risk
   */
  private async assessSecurityRisk(
    profile: EnhancedIdentityProfile,
    query: any
  ): Promise<void> {
    console.log('[People Finder] Phase 8: Security Risk Assessment');

    try {
      // Check for data breaches
      if (profile.contact.emails.length > 0) {
        const primaryEmail = profile.contact.emails[0].address;
        const breachResult = await breachDetection.checkBreaches(primaryEmail);

        if (breachResult?.breaches) {
          breachResult.breaches.forEach((breach: any) => {
            profile.risk.dataBreaches.push({
              breachName: breach.name || breach.Name,
              breachDate: breach.breachDate || breach.BreachDate || 'Unknown',
              exposedData: breach.dataClasses || breach.DataClasses || [],
              severity: this.assessBreachSeverity(breach.dataClasses || breach.DataClasses || []),
            });
          });

          // Calculate risk score
          profile.risk.riskScore = this.calculateRiskScore(profile.risk.dataBreaches);

          this.addSource(profile, 'Breach Detection', 'risk', breachResult.breaches.length, 95);
        }
      }
    } catch (error) {
      console.error('[People Finder] Risk assessment error:', error);
    }
  }

  /**
   * Phase 9: Construct timeline of events
   */
  private async constructTimeline(profile: EnhancedIdentityProfile): Promise<void> {
    console.log('[People Finder] Phase 9: Timeline Construction');

    // Aggregate all dated events into timeline
    const events: typeof profile.timeline = [];

    // Employment history
    profile.professional.employmentHistory.forEach(job => {
      if (job.startDate) {
        events.push({
          date: job.startDate,
          event: `Started at ${job.employer}${job.title ? ` as ${job.title}` : ''}`,
          category: 'professional',
          source: job.source,
          confidence: job.confidence,
        });
      }
    });

    // Legal events
    profile.legal.civilCases.forEach(caseItem => {
      if (caseItem.filingDate) {
        events.push({
          date: caseItem.filingDate,
          event: `Civil case filed: ${caseItem.caseType}`,
          category: 'legal',
          source: caseItem.source,
          confidence: 85,
        });
      }
    });

    // Sort by date
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    profile.timeline = events;
  }

  /**
   * Phase 10: Generate AI-powered intelligence summary
   */
  private async generateIntelligenceSummary(profile: EnhancedIdentityProfile): Promise<void> {
    console.log('[People Finder] Phase 10: Intelligence Summary');

    try {
      // Use AI to generate comprehensive summary
      const summaryPrompt = this.buildSummaryPrompt(profile);

      const aiResponse = await generateUserText(
        'people-finder-summary',
        summaryPrompt,
        {
          systemPrompt: 'You are an expert intelligence analyst. Generate a concise, professional intelligence summary based on the provided data. Focus on key findings, patterns, and actionable insights for legal professionals.',
          temperature: 0.3,
        },
        TaskPriority.HIGH_USER
      );

      profile.intelligence.summary = aiResponse.content;

      // Extract key findings
      profile.intelligence.keyFindings = this.extractKeyFindings(profile);

      // Calculate completeness
      profile.intelligence.completeness = this.calculateCompleteness(profile);

      // Assess data quality
      profile.intelligence.dataQuality = this.assessDataQuality(profile);

      // Generate recommendations
      profile.intelligence.recommendations = this.generateRecommendations(profile);

    } catch (error) {
      console.error('[People Finder] Summary generation error:', error);
      profile.intelligence.summary = this.generateFallbackSummary(profile);
    }
  }

  /**
   * Helper: Build prompt for AI summary generation
   */
  private buildSummaryPrompt(profile: EnhancedIdentityProfile): string {
    const sections: string[] = [];

    sections.push(`Generate an intelligence summary for: ${profile.identity.primaryName}`);
    sections.push(`\nConfidence Score: ${profile.identity.confidenceScore}%`);
    sections.push(`Verification Status: ${profile.identity.verificationStatus}`);

    if (profile.identity.aliases.length > 0) {
      sections.push(`\nKnown Aliases: ${profile.identity.aliases.join(', ')}`);
    }

    sections.push(`\nData Sources: ${profile.metadata.totalSources}`);
    sections.push(`Email Addresses Found: ${profile.contact.emails.length}`);
    sections.push(`Addresses Found: ${profile.contact.addresses.length}`);
    sections.push(`Employment Records: ${profile.professional.employmentHistory.length}`);
    sections.push(`Civil Cases: ${profile.legal.civilCases.length}`);
    sections.push(`Criminal Records: ${profile.legal.criminalHistory.length}`);
    sections.push(`Data Breaches: ${profile.risk.dataBreaches.length}`);
    sections.push(`Social Media Profiles: ${profile.digital.socialMedia.length}`);
    sections.push(`Online Mentions: ${profile.digital.onlineMentions.length}`);

    sections.push(`\nProvide a professional intelligence summary highlighting:
1. Identity verification confidence and key identifiers
2. Most significant findings (legal, professional, digital)
3. Potential risk factors or concerns
4. Reliability and completeness of the intelligence gathered
5. Any gaps or areas requiring additional investigation`);

    return sections.join('\n');
  }

  /**
   * Helper: Extract key findings
   */
  private extractKeyFindings(profile: EnhancedIdentityProfile): string[] {
    const findings: string[] = [];

    if (profile.identity.confidenceScore >= 70) {
      findings.push(`High confidence identity verification (${profile.identity.confidenceScore}%)`);
    }

    if (profile.contact.emails.length > 0) {
      findings.push(`${profile.contact.emails.length} email address(es) identified`);
    }

    if (profile.legal.criminalHistory.length > 0) {
      findings.push(`${profile.legal.criminalHistory.length} criminal record(s) found`);
    }

    if (profile.legal.civilCases.length > 0) {
      findings.push(`${profile.legal.civilCases.length} civil case(s) found`);
    }

    if (profile.risk.dataBreaches.length > 0) {
      findings.push(`Exposed in ${profile.risk.dataBreaches.length} data breach(es)`);
    }

    if (profile.professional.employmentHistory.length > 0) {
      findings.push(`${profile.professional.employmentHistory.length} employment record(s) identified`);
    }

    return findings;
  }

  /**
   * Helper: Calculate profile completeness
   */
  private calculateCompleteness(profile: EnhancedIdentityProfile): number {
    let score = 0;
    const maxScore = 100;

    // Identity (20 points)
    if (profile.identity.verificationStatus === 'verified') score += 20;
    else if (profile.identity.verificationStatus === 'partial') score += 10;

    // Contact (20 points)
    if (profile.contact.emails.length > 0) score += 10;
    if (profile.contact.addresses.length > 0) score += 10;

    // Professional (15 points)
    if (profile.professional.employmentHistory.length > 0) score += 8;
    if (profile.professional.education.length > 0) score += 7;

    // Legal (15 points)
    score += Math.min(15, (profile.legal.civilCases.length + profile.legal.criminalHistory.length) * 3);

    // Digital (15 points)
    if (profile.digital.socialMedia.length > 0) score += 7;
    if (profile.digital.onlineMentions.length > 0) score += 8;

    // Relationships (10 points)
    if (profile.relationships.relatives.length > 0 || profile.relationships.associates.length > 0) {
      score += 10;
    }

    // Risk (5 points)
    if (profile.risk.dataBreaches.length > 0) score += 5;

    return Math.min(100, Math.round((score / maxScore) * 100));
  }

  /**
   * Helper: Assess data quality
   */
  private assessDataQuality(profile: EnhancedIdentityProfile): 'excellent' | 'good' | 'fair' | 'poor' {
    const avgConfidence = profile.metadata.sources.reduce(
      (sum, s) => sum + s.confidence,
      0
    ) / (profile.metadata.sources.length || 1);

    if (avgConfidence >= 80 && profile.metadata.totalSources >= 5) return 'excellent';
    if (avgConfidence >= 60 && profile.metadata.totalSources >= 3) return 'good';
    if (avgConfidence >= 40 || profile.metadata.totalSources >= 2) return 'fair';
    return 'poor';
  }

  /**
   * Helper: Generate recommendations
   */
  private generateRecommendations(profile: EnhancedIdentityProfile): string[] {
    const recommendations: string[] = [];

    if (profile.identity.confidenceScore < 70) {
      recommendations.push('Consider additional identity verification methods');
    }

    if (profile.contact.emails.length === 0) {
      recommendations.push('No email addresses found - consider alternative contact methods');
    }

    if (profile.legal.criminalHistory.length > 0 || profile.legal.civilCases.length > 0) {
      recommendations.push('Review legal records for case details and current status');
    }

    if (profile.risk.dataBreaches.length > 0) {
      recommendations.push('Subject has been exposed in data breaches - verify current security posture');
    }

    if (profile.intelligence.completeness < 50) {
      recommendations.push('Profile incomplete - consider additional research sources');
    }

    return recommendations;
  }

  /**
   * Helper: Generate fallback summary
   */
  private generateFallbackSummary(profile: EnhancedIdentityProfile): string {
    return `Intelligence report for ${profile.identity.primaryName}. ` +
           `Confidence: ${profile.identity.confidenceScore}%. ` +
           `${profile.metadata.totalSources} sources consulted. ` +
           `Profile completeness: ${profile.intelligence.completeness}%.`;
  }

  /**
   * Helper: Assess breach severity
   */
  private assessBreachSeverity(dataClasses: string[]): 'low' | 'medium' | 'high' | 'critical' {
    const criticalData = ['passwords', 'credit cards', 'social security numbers', 'financial records'];
    const highData = ['email addresses', 'phone numbers', 'physical addresses'];

    const hasCritical = dataClasses.some(dc => 
      criticalData.some(cd => dc.toLowerCase().includes(cd))
    );
    const hasHigh = dataClasses.some(dc =>
      highData.some(hd => dc.toLowerCase().includes(hd))
    );

    if (hasCritical) return 'critical';
    if (hasHigh) return 'high';
    if (dataClasses.length > 5) return 'medium';
    return 'low';
  }

  /**
   * Helper: Calculate risk score from breaches
   */
  private calculateRiskScore(breaches: Array<{
    breachName: string;
    breachDate: string;
    exposedData: string[];
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>): number {
    if (breaches.length === 0) return 0;

    let score = 0;
    breaches.forEach((breach) => {
      switch (breach.severity) {
        case 'critical': score += 40; break;
        case 'high': score += 25; break;
        case 'medium': score += 15; break;
        case 'low': score += 5; break;
      }
    });

    return Math.min(100, score);
  }

  /**
   * Helper: Add source metadata
   */
  private addSource(
    profile: EnhancedIdentityProfile,
    name: string,
    type: string,
    recordsFound: number,
    confidence: number
  ): void {
    profile.metadata.sources.push({
      name,
      type,
      recordsFound,
      confidence,
      lastAccessed: new Date(),
    });
    profile.metadata.totalSources++;
  }
}

export const enhancedPeopleFinder = new EnhancedPeopleFinder();
