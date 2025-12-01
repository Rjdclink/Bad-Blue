/**
 * Sub-Agent Harvester Module
 * 
 * Dedicated officer data collection with failover logging and population priority integration.
 * Features:
 * - Failover logging to data/subagent/harvest.log
 * - Population-based search prioritization
 * - Adaptive scheduling based on session budgets
 * - Jurisdiction tracking for balanced coverage
 */

import { promises as fs } from 'fs';
import path from 'path';
import { searchSessionManager } from './searchSessionManager';
import { populationPriorityQueue } from './populationPriorityQueue';
import { db } from './db';
import { officerProfiles, jurisdictionPopulations, subagentSearchQueue } from '@shared/schema';
import { eq, sql, desc, and, gte, lte } from 'drizzle-orm';
import { unifiedSearch } from './webSearchService';

interface HarvesterConfig {
  dailyHarvestHourUTC: number;
  dailyHarvestMinuteUTC: number;
  maxSearchesPerCycle: number;
  minDelayBetweenSearchesMs: number;
  highPopulationThreshold: number;
  mediumPopulationThreshold: number;
}

interface HarvestLogEntry {
  timestamp: string;
  type: 'attempt' | 'success' | 'failure' | 'info';
  jurisdiction?: string;
  state?: string;
  population?: number;
  officersFound?: number;
  officersAdded?: number;
  officersUpdated?: number;
  error?: string;
  duration?: number;
  provider?: string;
}

interface HarvestCycleResult {
  success: boolean;
  jurisdictionsSearched: number;
  officersFound: number;
  officersAdded: number;
  officersUpdated: number;
  errors: string[];
  duration: number;
  priorityBreakdown: {
    high: number;
    medium: number;
    low: number;
  };
}

interface PrioritizedJurisdiction {
  id: string;
  city: string;
  state: string;
  population: number;
  priorityScore: number;
  priorityLevel: 'high' | 'medium' | 'low';
  lastSearchedAt: Date | null;
  searchFrequencyHours: number;
}

const DEFAULT_CONFIG: HarvesterConfig = {
  dailyHarvestHourUTC: 3,
  dailyHarvestMinuteUTC: 0,
  maxSearchesPerCycle: 7,  // Reduced from 15 for 50% Groq reduction
  minDelayBetweenSearchesMs: 6000,  // Doubled from 3000 for 50% Groq reduction
  highPopulationThreshold: 100000,
  mediumPopulationThreshold: 25000,
};

class SubAgentHarvester {
  private static instance: SubAgentHarvester;
  private config: HarvesterConfig;
  private initialized = false;
  private isRunning = false;
  private dailyScheduleTimer: NodeJS.Timeout | null = null;
  private lastHarvestAt: Date | null = null;
  private recentlySearchedJurisdictions: Map<string, Date> = new Map();

  private readonly DATA_DIR = path.join(process.cwd(), 'data', 'subagent');
  private readonly HARVEST_LOG_FILE = path.join(this.DATA_DIR, 'harvest.log');

  private constructor() {
    this.config = { ...DEFAULT_CONFIG };
  }

  static getInstance(): SubAgentHarvester {
    if (!SubAgentHarvester.instance) {
      SubAgentHarvester.instance = new SubAgentHarvester();
    }
    return SubAgentHarvester.instance;
  }

  async initializeHarvester(customConfig?: Partial<HarvesterConfig>): Promise<void> {
    if (this.initialized) {
      console.log('[SubAgentHarvester] Already initialized');
      return;
    }

    console.log('[SubAgentHarvester] Initializing harvester...');

    if (customConfig) {
      this.config = { ...this.config, ...customConfig };
    }

    await this.ensureDataDirectory();
    await this.logToHarvestLog({
      timestamp: new Date().toISOString(),
      type: 'info',
      error: 'Harvester initialized'
    });

    try {
      await searchSessionManager.initialize();
      console.log('[SubAgentHarvester] ✓ Search session manager connected');
    } catch (e: any) {
      console.warn('[SubAgentHarvester] Session manager init warning:', e.message);
      await this.logToHarvestLog({
        timestamp: new Date().toISOString(),
        type: 'failure',
        error: `Session manager init failed: ${e.message}`
      });
    }

    try {
      await populationPriorityQueue.initialize();
      console.log('[SubAgentHarvester] ✓ Population priority queue connected');
    } catch (e: any) {
      console.warn('[SubAgentHarvester] Priority queue init warning:', e.message);
      await this.logToHarvestLog({
        timestamp: new Date().toISOString(),
        type: 'failure',
        error: `Priority queue init failed: ${e.message}`
      });
    }

    this.scheduleDailyHarvest();
    this.initialized = true;

    console.log('[SubAgentHarvester] ✓ Harvester initialized successfully');
    console.log(`[SubAgentHarvester] Harvest scheduled every 36 hours (50% reduction from daily)`);
  }

  private async ensureDataDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.DATA_DIR, { recursive: true });
    } catch (e: any) {
      console.warn('[SubAgentHarvester] Could not create data directory:', e.message);
    }
  }

  private async logToHarvestLog(entry: HarvestLogEntry): Promise<void> {
    try {
      await this.ensureDataDirectory();
      const logLine = JSON.stringify(entry) + '\n';
      await fs.appendFile(this.HARVEST_LOG_FILE, logLine, 'utf-8');
    } catch (e: any) {
      console.warn('[SubAgentHarvester] Failed to write to harvest log:', e.message);
    }
  }

  scheduleDailyHarvest(): void {
    if (this.dailyScheduleTimer) {
      clearTimeout(this.dailyScheduleTimer);
    }

    const HARVEST_INTERVAL_HOURS = 36;  // Changed from 24h to 36h for 50% Groq reduction

    const scheduleNext = () => {
      const now = new Date();
      // Calculate next harvest as 36 hours from last harvest or startup
      const nextHarvest = new Date(now.getTime() + (HARVEST_INTERVAL_HOURS * 60 * 60 * 1000));

      const delayMs = nextHarvest.getTime() - now.getTime();

      this.dailyScheduleTimer = setTimeout(async () => {
        console.log('[SubAgentHarvester] Starting scheduled harvest (36h interval)...');
        await this.logToHarvestLog({
          timestamp: new Date().toISOString(),
          type: 'info',
          error: 'Harvest triggered by 36h schedule'
        });

        try {
          await this.executeHarvestCycle();
        } catch (e: any) {
          console.error('[SubAgentHarvester] Scheduled harvest failed:', e.message);
          await this.logToHarvestLog({
            timestamp: new Date().toISOString(),
            type: 'failure',
            error: `Scheduled harvest failed: ${e.message}`
          });
        }

        scheduleNext();
      }, delayMs);

      console.log(`[SubAgentHarvester] Next harvest: ${nextHarvest.toISOString()}`);
    };

    scheduleNext();
  }

  async executeHarvestCycle(): Promise<HarvestCycleResult> {
    if (this.isRunning) {
      console.log('[SubAgentHarvester] Harvest already in progress, skipping');
      return {
        success: false,
        jurisdictionsSearched: 0,
        officersFound: 0,
        officersAdded: 0,
        officersUpdated: 0,
        errors: ['Harvest already in progress'],
        duration: 0,
        priorityBreakdown: { high: 0, medium: 0, low: 0 }
      };
    }

    this.isRunning = true;
    const startTime = Date.now();
    const errors: string[] = [];
    let jurisdictionsSearched = 0;
    let totalOfficersFound = 0;
    let totalOfficersAdded = 0;
    let totalOfficersUpdated = 0;
    const priorityBreakdown = { high: 0, medium: 0, low: 0 };

    await this.logToHarvestLog({
      timestamp: new Date().toISOString(),
      type: 'attempt',
      error: 'Starting harvest cycle'
    });

    try {
      const canSearch = await searchSessionManager.canStartSearch();
      if (!canSearch.allowed) {
        const errorMsg = `Session not allowing search: ${canSearch.reason}`;
        errors.push(errorMsg);
        await this.logToHarvestLog({
          timestamp: new Date().toISOString(),
          type: 'failure',
          error: errorMsg
        });

        this.isRunning = false;
        return {
          success: false,
          jurisdictionsSearched: 0,
          officersFound: 0,
          officersAdded: 0,
          officersUpdated: 0,
          errors,
          duration: Date.now() - startTime,
          priorityBreakdown
        };
      }

      const prioritizedTargets = await this.prioritizeSearches(this.config.maxSearchesPerCycle);

      console.log(`[SubAgentHarvester] Found ${prioritizedTargets.length} prioritized jurisdictions`);

      for (const target of prioritizedTargets) {
        try {
          await searchSessionManager.recordSearchStart();

          await this.logToHarvestLog({
            timestamp: new Date().toISOString(),
            type: 'attempt',
            jurisdiction: target.city,
            state: target.state,
            population: target.population
          });

          const searchStart = Date.now();
          const result = await this.searchJurisdiction(target);
          const searchDuration = Date.now() - searchStart;

          jurisdictionsSearched++;
          totalOfficersFound += result.officersFound;
          totalOfficersAdded += result.officersAdded;
          totalOfficersUpdated += result.officersUpdated;

          priorityBreakdown[target.priorityLevel]++;

          this.recentlySearchedJurisdictions.set(target.id, new Date());

          await this.logToHarvestLog({
            timestamp: new Date().toISOString(),
            type: 'success',
            jurisdiction: target.city,
            state: target.state,
            population: target.population,
            officersFound: result.officersFound,
            officersAdded: result.officersAdded,
            officersUpdated: result.officersUpdated,
            duration: searchDuration
          });

          const durationMinutes = Math.ceil(searchDuration / 60000);
          await searchSessionManager.recordSearchTime(durationMinutes);
          await searchSessionManager.recordSearchCompletion(result.officersFound);

          if (target.id) {
            await populationPriorityQueue.markCompleted(target.id, result.officersFound);
          }

          await this.delay(this.config.minDelayBetweenSearchesMs);

        } catch (e: any) {
          const errorMsg = `Failed to search ${target.city}, ${target.state}: ${e.message}`;
          errors.push(errorMsg);

          await this.logToHarvestLog({
            timestamp: new Date().toISOString(),
            type: 'failure',
            jurisdiction: target.city,
            state: target.state,
            population: target.population,
            error: e.message
          });

          if (target.id) {
            try {
              await populationPriorityQueue.markFailed(target.id, e.message);
            } catch {}
          }
        }
      }

      this.lastHarvestAt = new Date();

    } catch (e: any) {
      errors.push(`Harvest cycle error: ${e.message}`);
      await this.logToHarvestLog({
        timestamp: new Date().toISOString(),
        type: 'failure',
        error: `Harvest cycle error: ${e.message}`
      });
    } finally {
      this.isRunning = false;
    }

    const duration = Date.now() - startTime;

    await this.logToHarvestLog({
      timestamp: new Date().toISOString(),
      type: 'info',
      officersFound: totalOfficersFound,
      officersAdded: totalOfficersAdded,
      officersUpdated: totalOfficersUpdated,
      duration,
      error: `Harvest cycle complete: ${jurisdictionsSearched} jurisdictions, ${totalOfficersFound} officers found`
    });

    console.log(`[SubAgentHarvester] Harvest cycle complete: ${jurisdictionsSearched} jurisdictions, ${totalOfficersFound} officers found in ${Math.round(duration / 1000)}s`);

    return {
      success: errors.length === 0,
      jurisdictionsSearched,
      officersFound: totalOfficersFound,
      officersAdded: totalOfficersAdded,
      officersUpdated: totalOfficersUpdated,
      errors,
      duration,
      priorityBreakdown
    };
  }

  async prioritizeSearches(limit: number): Promise<PrioritizedJurisdiction[]> {
    const results: PrioritizedJurisdiction[] = [];

    try {
      const queueTarget = await populationPriorityQueue.getNextPriorityTarget();
      
      if (queueTarget) {
        const { jurisdiction } = queueTarget;
        const priorityLevel = this.getPriorityLevel(jurisdiction.population || 0);
        
        results.push({
          id: jurisdiction.id,
          city: jurisdiction.city,
          state: jurisdiction.state,
          population: jurisdiction.population || 0,
          priorityScore: jurisdiction.priorityScore || 0,
          priorityLevel,
          lastSearchedAt: jurisdiction.lastSearchedAt,
          searchFrequencyHours: this.getSearchFrequency(priorityLevel)
        });
      }

      const highPopTargets = await this.getHighPriorityJurisdictions(
        Math.ceil(limit * 0.5)
      );
      
      for (const target of highPopTargets) {
        if (results.length >= limit) break;
        if (!results.find(r => r.id === target.id)) {
          results.push(target);
        }
      }

      const mediumPopTargets = await this.getMediumPriorityJurisdictions(
        Math.ceil(limit * 0.3)
      );
      
      for (const target of mediumPopTargets) {
        if (results.length >= limit) break;
        if (!results.find(r => r.id === target.id)) {
          results.push(target);
        }
      }

      const lowPopTargets = await this.getLowPriorityJurisdictions(
        Math.ceil(limit * 0.2)
      );
      
      for (const target of lowPopTargets) {
        if (results.length >= limit) break;
        if (!results.find(r => r.id === target.id)) {
          results.push(target);
        }
      }

    } catch (e: any) {
      console.warn('[SubAgentHarvester] Error prioritizing searches:', e.message);
      await this.logToHarvestLog({
        timestamp: new Date().toISOString(),
        type: 'failure',
        error: `Prioritization error: ${e.message}`
      });
    }

    results.sort((a, b) => b.priorityScore - a.priorityScore);

    return results.slice(0, limit);
  }

  private getPriorityLevel(population: number): 'high' | 'medium' | 'low' {
    if (population >= this.config.highPopulationThreshold) return 'high';
    if (population >= this.config.mediumPopulationThreshold) return 'medium';
    return 'low';
  }

  private getSearchFrequency(level: 'high' | 'medium' | 'low'): number {
    switch (level) {
      case 'high': return 24;
      case 'medium': return 72;
      case 'low': return 168;
    }
  }

  private shouldSearchJurisdiction(jurisdictionId: string, priorityLevel: 'high' | 'medium' | 'low'): boolean {
    const lastSearch = this.recentlySearchedJurisdictions.get(jurisdictionId);
    if (!lastSearch) return true;

    const hoursSinceSearch = (Date.now() - lastSearch.getTime()) / (1000 * 60 * 60);
    const requiredHours = this.getSearchFrequency(priorityLevel);

    return hoursSinceSearch >= requiredHours;
  }

  private async getHighPriorityJurisdictions(limit: number): Promise<PrioritizedJurisdiction[]> {
    try {
      const results = await db
        .select()
        .from(jurisdictionPopulations)
        .where(gte(jurisdictionPopulations.population, this.config.highPopulationThreshold))
        .orderBy(desc(jurisdictionPopulations.priorityScore))
        .limit(limit * 2);

      return results
        .filter(j => this.shouldSearchJurisdiction(j.id, 'high'))
        .slice(0, limit)
        .map(j => ({
          id: j.id,
          city: j.city,
          state: j.state,
          population: j.population || 0,
          priorityScore: j.priorityScore || 0,
          priorityLevel: 'high' as const,
          lastSearchedAt: j.lastSearchedAt,
          searchFrequencyHours: 24
        }));
    } catch (e: any) {
      console.warn('[SubAgentHarvester] Error getting high priority jurisdictions:', e.message);
      return [];
    }
  }

  private async getMediumPriorityJurisdictions(limit: number): Promise<PrioritizedJurisdiction[]> {
    try {
      const results = await db
        .select()
        .from(jurisdictionPopulations)
        .where(
          and(
            gte(jurisdictionPopulations.population, this.config.mediumPopulationThreshold),
            lte(jurisdictionPopulations.population, this.config.highPopulationThreshold - 1)
          )
        )
        .orderBy(desc(jurisdictionPopulations.priorityScore))
        .limit(limit * 2);

      return results
        .filter(j => this.shouldSearchJurisdiction(j.id, 'medium'))
        .slice(0, limit)
        .map(j => ({
          id: j.id,
          city: j.city,
          state: j.state,
          population: j.population || 0,
          priorityScore: j.priorityScore || 0,
          priorityLevel: 'medium' as const,
          lastSearchedAt: j.lastSearchedAt,
          searchFrequencyHours: 72
        }));
    } catch (e: any) {
      console.warn('[SubAgentHarvester] Error getting medium priority jurisdictions:', e.message);
      return [];
    }
  }

  private async getLowPriorityJurisdictions(limit: number): Promise<PrioritizedJurisdiction[]> {
    try {
      const results = await db
        .select()
        .from(jurisdictionPopulations)
        .where(lte(jurisdictionPopulations.population, this.config.mediumPopulationThreshold - 1))
        .orderBy(desc(jurisdictionPopulations.priorityScore))
        .limit(limit * 2);

      return results
        .filter(j => this.shouldSearchJurisdiction(j.id, 'low'))
        .slice(0, limit)
        .map(j => ({
          id: j.id,
          city: j.city,
          state: j.state,
          population: j.population || 0,
          priorityScore: j.priorityScore || 0,
          priorityLevel: 'low' as const,
          lastSearchedAt: j.lastSearchedAt,
          searchFrequencyHours: 168
        }));
    } catch (e: any) {
      console.warn('[SubAgentHarvester] Error getting low priority jurisdictions:', e.message);
      return [];
    }
  }

  private async searchJurisdiction(target: PrioritizedJurisdiction): Promise<{
    officersFound: number;
    officersAdded: number;
    officersUpdated: number;
  }> {
    const searchQuery = `police officers ${target.city} ${target.state} department roster`;
    
    let officersFound = 0;
    let officersAdded = 0;
    let officersUpdated = 0;

    try {
      const searchResults = await unifiedSearch(searchQuery, { limit: 10, category: 'officer' });

      for (const result of searchResults) {
        const officers = this.extractOfficersFromResult(result, target);
        officersFound += officers.length;

        for (const officer of officers) {
          try {
            const saveResult = await this.saveOfficer(officer);
            if (saveResult === 'added') officersAdded++;
            else if (saveResult === 'updated') officersUpdated++;
          } catch (e: any) {
            console.warn(`[SubAgentHarvester] Failed to save officer:`, e.message);
          }
        }
      }

      await db
        .update(jurisdictionPopulations)
        .set({ lastSearchedAt: new Date() })
        .where(eq(jurisdictionPopulations.id, target.id));

    } catch (e: any) {
      console.warn(`[SubAgentHarvester] Search failed for ${target.city}, ${target.state}:`, e.message);
      throw e;
    }

    return { officersFound, officersAdded, officersUpdated };
  }

  private extractOfficersFromResult(result: any, target: PrioritizedJurisdiction): Array<{
    name: string;
    department: string;
    location: string;
    source: string;
    rank?: string;
  }> {
    const officers: Array<{
      name: string;
      department: string;
      location: string;
      source: string;
      rank?: string;
    }> = [];

    const content = result.snippet || result.aiSummary || '';
    
    const namePatterns = [
      /(?:Officer|Ofc\.|Deputy|Sgt\.|Det\.|Chief|Lt\.|Cpt\.)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/g,
      /([A-Z][a-z]+)\s+([A-Z][a-z]+),?\s+(?:Police Officer|Sheriff|Deputy)/g,
    ];

    for (const pattern of namePatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const firstName = match[1];
        const lastName = match[2];
        
        if (firstName && lastName && firstName.length > 1 && lastName.length > 1) {
          officers.push({
            name: `${firstName} ${lastName}`,
            department: `${target.city} Police Department`,
            location: `${target.city}, ${target.state}`,
            source: result.url || 'web search',
            rank: match[0].split(/\s+/)[0].replace('.', '')
          });
        }
      }
    }

    return officers;
  }

  private async saveOfficer(officer: {
    name: string;
    department: string;
    location: string;
    source: string;
    rank?: string;
  }): Promise<'added' | 'updated' | 'skipped'> {
    try {
      const existing = await db
        .select()
        .from(officerProfiles)
        .where(
          and(
            eq(officerProfiles.officerName, officer.name),
            eq(officerProfiles.department, officer.department)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        const existingProfile = existing[0];
        const existingSources = existingProfile.sources || [];
        const newSources = Array.from(new Set([...existingSources, officer.source]));

        await db
          .update(officerProfiles)
          .set({
            rank: officer.rank || existingProfile.rank,
            location: officer.location || existingProfile.location,
            sources: newSources,
            lastUpdated: new Date()
          })
          .where(eq(officerProfiles.id, existingProfile.id));

        return 'updated';
      }

      await db.insert(officerProfiles).values({
        officerName: officer.name,
        department: officer.department,
        rank: officer.rank,
        location: officer.location,
        sources: [officer.source],
        dataQualityScore: 50,
        lastUpdated: new Date()
      });

      return 'added';

    } catch (e: any) {
      console.warn('[SubAgentHarvester] Officer save error:', e.message);
      return 'skipped';
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getHarvesterStatus(): Promise<{
    initialized: boolean;
    isRunning: boolean;
    lastHarvestAt: Date | null;
    config: HarvesterConfig;
    recentlySearchedCount: number;
    sessionState: any;
    queueStats: any;
  }> {
    let sessionState = null;
    let queueStats = null;

    try {
      sessionState = await searchSessionManager.getSessionState();
    } catch {}

    try {
      queueStats = await populationPriorityQueue.getQueueStats();
    } catch {}

    return {
      initialized: this.initialized,
      isRunning: this.isRunning,
      lastHarvestAt: this.lastHarvestAt,
      config: this.config,
      recentlySearchedCount: this.recentlySearchedJurisdictions.size,
      sessionState,
      queueStats
    };
  }

  async getHarvestLogs(limit: number = 100): Promise<HarvestLogEntry[]> {
    try {
      const content = await fs.readFile(this.HARVEST_LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const entries: HarvestLogEntry[] = [];

      for (const line of lines.slice(-limit)) {
        try {
          entries.push(JSON.parse(line));
        } catch {}
      }

      return entries;
    } catch {
      return [];
    }
  }

  async triggerManualHarvest(): Promise<HarvestCycleResult> {
    console.log('[SubAgentHarvester] Manual harvest triggered');
    await this.logToHarvestLog({
      timestamp: new Date().toISOString(),
      type: 'info',
      error: 'Manual harvest triggered'
    });

    return this.executeHarvestCycle();
  }

  shutdown(): void {
    if (this.dailyScheduleTimer) {
      clearTimeout(this.dailyScheduleTimer);
      this.dailyScheduleTimer = null;
    }
    console.log('[SubAgentHarvester] Shutdown complete');
  }
}

export const subAgentHarvester = SubAgentHarvester.getInstance();

export async function initializeHarvester(config?: Partial<HarvesterConfig>): Promise<void> {
  await subAgentHarvester.initializeHarvester(config);
}

export {
  SubAgentHarvester,
  HarvesterConfig,
  HarvestLogEntry,
  HarvestCycleResult,
  PrioritizedJurisdiction
};
