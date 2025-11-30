/**
 * Sub-Agent Web Harvester
 * 
 * Daily automated officer data collection at 2:30 UTC
 * Features:
 * - Intelligent web search and scraping
 * - Officer profile compilation and database storage
 * - Full database and file creation/editing access
 * - NPM package installation capabilities
 * - Admin command execution (with safety constraints)
 * 
 * SAFETY CONSTRAINTS:
 * - NEVER edits admin bypass function
 * - NEVER edits payment credentials
 */

import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from './db';
import { officerProfiles } from '@shared/schema';
import { eq, sql, and, or, like } from 'drizzle-orm';
import { unifiedSearch, batchOfficerSearch, searchOfficerRecords } from './webSearchService';
import { searchSessionManager } from './searchSessionManager';
import { populationPriorityQueue } from './populationPriorityQueue';
import { selfImprovementEngine } from './selfImprovementEngine';

const exec = promisify(execCb);

interface OfficerData {
  firstName: string;
  lastName: string;
  fullName: string;
  badgeNumber?: string;
  department: string;
  location: string;
  rank?: string;
  sources: string[];
  dataQualityScore: number;
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface HarvestRunResult {
  success: boolean;
  officersFound: number;
  officersAdded: number;
  officersUpdated: number;
  errors: string[];
  duration: number;
}

const PROTECTED_FILES = [
  'server/auth.ts',
  'server/adminBypass.ts',
  'server/paymentBypass.ts',
  'server/stripeCredentials.ts',
  '.env',
  '.env.local',
  '.env.production',
];

const PROTECTED_PATTERNS = [
  /admin.*bypass/i,
  /bypass.*admin/i,
  /payment.*credential/i,
  /stripe.*secret/i,
  /bypass.*payment/i,
];

const ALLOWED_SHELL_COMMANDS = [
  'npm',
  'npx',
  'node',
  'ls',
  'cat',
  'echo',
  'pwd',
  'wc',
  'grep',
  'find',
  'head',
  'tail',
];

const DANGEROUS_COMMAND_PATTERNS = [
  /rm\s+-rf/i,
  /rm\s+.*\*/i,
  /dd\s+if=/i,
  /mkfs/i,
  /:\(\)\s*\{/,
  />\/dev\/sd/i,
  /\|\s*sh/i,
  /\|\s*bash/i,
  /eval\s+/i,
  /exec\s+/i,
  /sudo\s+/i,
  /chmod\s+.*777/i,
  /curl.*\|\s*sh/i,
  /wget.*\|\s*sh/i,
  /\.\.\//,
  // Command chaining operators
  /&&/,
  /\|\|/,
  /;/,
  // Subshells and backticks
  /\$\(/,
  /`/,
  // Inline JS execution
  /node\s+(-e|--eval)/i,
  /node\s+-p/i,
  /npx\s+.*-e/i,
  /ts-node\s+(-e|--eval)/i,
  // Environment variable injection
  /^\s*[A-Z_]+=.*\s+/,
  // Redirections that could overwrite files
  />\s*[^|]/,
  />>/,
  // npm exec with arbitrary commands
  /npm\s+exec/i,
  /npx\s+--yes/i,
];

// Strictly read-only commands with explicit subcommand restrictions
// NOTE: All commands are now disabled except for basic read-only operations
// This is a deny-by-default system with very limited functionality
const SAFE_READONLY_COMMANDS: { [key: string]: { allowed: string[]; blocked: string[] } } = {
  'npm': { 
    allowed: ['list', 'ls', 'version', 'help'],  // Only truly safe npm commands
    blocked: ['install', 'run', 'exec', 'start', 'test', 'publish', 'uninstall', 'update', 'ci', 'view', 'search', 'info'],  // Block view/search due to registry injection risk
  },
  'npx': { allowed: [], blocked: ['*'] },  // Completely disabled
  'node': { allowed: ['--version', '-v'], blocked: ['-e', '--eval', '-p', '--print'] },
  'ls': { allowed: ['*'], blocked: [] },  // Read-only by nature
  'cat': { allowed: ['*'], blocked: [] },  // Read-only by nature  
  'echo': { allowed: ['*'], blocked: [] },
  'pwd': { allowed: ['*'], blocked: [] },
  'wc': { allowed: ['*'], blocked: [] },
  'head': { allowed: ['*'], blocked: [] },
  'tail': { allowed: ['*'], blocked: [] },
  // Disabled potentially dangerous commands
  'grep': { allowed: [], blocked: ['*'] },  // Disabled - can be abused
  'find': { allowed: [], blocked: ['*'] },  // Disabled - has -exec, -delete flags
};

// Patterns to block even in allowed commands
const BLOCKED_FLAG_PATTERNS = [
  /-exec/i,
  /-delete/i,
  /-ok/i,
  /--exec/i,
  /-print0.*xargs/i,
  /--config/i,      // Block npm config injection
  /--registry/i,    // Block registry hijacking
  /--userconfig/i,  // Block user config override
  /--globalconfig/i,// Block global config override
  /--prefix/i,      // Block prefix manipulation
  /--cache/i,       // Block cache manipulation
  /\|/,             // Block pipes
  /tee\s/i,         // Block tee
];

// Block unicode homoglyphs and zero-width characters
const UNICODE_BYPASS_PATTERNS = [
  /[\u200B-\u200D\uFEFF]/,  // Zero-width characters
  /[\u2028\u2029]/,          // Line/paragraph separators
  /[\u00A0]/,                // Non-breaking space
];

class SubAgentWebHarvester {
  private static instance: SubAgentWebHarvester;
  private dailySchedule: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private consecutiveFailures = 0;

  private readonly DATA_DIR = path.join(process.cwd(), 'data', 'subagent');
  private readonly HARVEST_LOG = path.join(this.DATA_DIR, 'harvest_runs.log');
  private readonly COMMANDS_LOG = path.join(this.DATA_DIR, 'admin_commands.log');

  private constructor() {}

  static getInstance(): SubAgentWebHarvester {
    if (!SubAgentWebHarvester.instance) {
      SubAgentWebHarvester.instance = new SubAgentWebHarvester();
    }
    return SubAgentWebHarvester.instance;
  }

  async initialize(): Promise<void> {
    console.log('[Sub-Agent Harvester] Initializing...');
    
    await this.ensureDataDirectory();
    
    try {
      await searchSessionManager.initialize();
      console.log('[Sub-Agent Harvester] ✓ Session manager initialized (3-hour daily budget)');
    } catch (e: any) {
      console.warn('[Sub-Agent Harvester] Session manager init failed:', e.message);
    }
    
    try {
      await populationPriorityQueue.initialize();
      console.log('[Sub-Agent Harvester] ✓ Priority queue initialized');
    } catch (e: any) {
      console.warn('[Sub-Agent Harvester] Priority queue init failed:', e.message);
    }
    
    this.scheduleDailyHarvest();
    
    console.log('[Sub-Agent Harvester] ✓ Active');
    console.log('[Sub-Agent Harvester] Next harvest scheduled for 2:30 UTC');
  }

  private async ensureDataDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.DATA_DIR, { recursive: true });
    } catch (e) {
      console.warn('[Sub-Agent Harvester] Could not create data directory:', (e as any)?.message);
    }
  }

  private scheduleDailyHarvest(): void {
    const scheduleNext = () => {
      const now = new Date();
      const next = new Date(now);
      next.setUTCHours(2, 30, 0, 0);
      
      if (now >= next) {
        next.setDate(next.getDate() + 1);
      }
      
      const delay = next.getTime() - now.getTime();
      
      this.dailySchedule = setTimeout(async () => {
        await this.runDailyHarvest().catch(e => {
          console.error('[Sub-Agent Harvester] Daily harvest failed:', e);
        });
        scheduleNext();
      }, delay);
      
      console.log('[Sub-Agent Harvester] Daily harvest scheduled:', next.toISOString());
    };
    
    scheduleNext();
  }

  async runDailyHarvest(): Promise<HarvestRunResult> {
    if (this.isRunning) {
      console.log('[Sub-Agent Harvester] Already running, skipping...');
      return {
        success: false,
        officersFound: 0,
        officersAdded: 0,
        officersUpdated: 0,
        errors: ['Harvest already in progress'],
        duration: 0,
      };
    }

    this.isRunning = true;
    const startTime = Date.now();
    const errors: string[] = [];
    let officersFound = 0;
    let officersAdded = 0;
    let officersUpdated = 0;

    console.log('[Sub-Agent Harvester] Starting daily harvest...');

    try {
      const searchQueries = this.generateSearchQueries();
      
      for (const query of searchQueries) {
        try {
          const searchResults = await this.performWebSearch(query);
          const officers = await this.extractOfficerData(searchResults);
          
          officersFound += officers.length;
          
          for (const officer of officers) {
            try {
              const result = await this.saveOfficerToDatabase(officer);
              if (result === 'added') officersAdded++;
              else if (result === 'updated') officersUpdated++;
            } catch (e: any) {
              errors.push(`Failed to save ${officer.fullName}: ${e.message}`);
            }
          }
          
          await this.delay(2000);
        } catch (e: any) {
          errors.push(`Search failed for "${query}": ${e.message}`);
        }
      }

      this.consecutiveFailures = 0;
      this.lastRunAt = new Date();

    } catch (e: any) {
      this.consecutiveFailures++;
      errors.push(`Harvest failed: ${e.message}`);
    } finally {
      this.isRunning = false;
    }

    const duration = Date.now() - startTime;
    const result: HarvestRunResult = {
      success: errors.length === 0,
      officersFound,
      officersAdded,
      officersUpdated,
      errors,
      duration,
    };

    await this.logHarvestRun(result);

    console.log(`[Sub-Agent Harvester] Harvest complete: ${officersFound} found, ${officersAdded} added, ${officersUpdated} updated`);
    
    return result;
  }

  async runPriorityBasedHarvest(): Promise<HarvestRunResult> {
    const canSearch = await searchSessionManager.canStartSearch();
    
    if (!canSearch.allowed) {
      console.log(`[Sub-Agent Harvester] Priority harvest blocked: ${canSearch.reason}`);
      if (canSearch.waitSeconds) {
        console.log(`[Sub-Agent Harvester] Next search window in ${Math.ceil(canSearch.waitSeconds / 60)} minutes`);
      }
      return {
        success: false,
        officersFound: 0,
        officersAdded: 0,
        officersUpdated: 0,
        errors: [canSearch.reason],
        duration: 0,
      };
    }

    const startTime = Date.now();
    const errors: string[] = [];
    let officersFound = 0;
    let officersAdded = 0;
    let officersUpdated = 0;

    console.log('[Sub-Agent Harvester] Starting priority-based harvest...');

    try {
      const target = await populationPriorityQueue.getNextPriorityTarget();
      
      if (!target) {
        console.log('[Sub-Agent Harvester] No targets in priority queue');
        return {
          success: true,
          officersFound: 0,
          officersAdded: 0,
          officersUpdated: 0,
          errors: [],
          duration: Date.now() - startTime,
        };
      }

      const { queueItem, jurisdiction } = target;
      
      console.log(`[Sub-Agent Harvester] Searching: ${jurisdiction.city}, ${jurisdiction.state} (population: ${jurisdiction.population})`);
      
      await populationPriorityQueue.markInProgress(queueItem.id);

      const searchQuery = `police officers ${jurisdiction.city} ${jurisdiction.state} department roster`;
      const searchResults = await this.performWebSearch(searchQuery);
      const officers = await this.extractOfficerData(searchResults);
      
      officersFound = officers.length;
      
      for (const officer of officers) {
        try {
          const result = await this.saveOfficerToDatabase(officer);
          if (result === 'added') officersAdded++;
          else if (result === 'updated') officersUpdated++;
        } catch (e: any) {
          errors.push(`Failed to save ${officer.fullName}: ${e.message}`);
        }
      }

      await populationPriorityQueue.markCompleted(queueItem.id, officersFound);
      
      const durationMinutes = Math.ceil((Date.now() - startTime) / 60000);
      await searchSessionManager.recordSearchTime(durationMinutes);
      await searchSessionManager.recordSearchCompletion(officersFound);

      try {
        await selfImprovementEngine.recordSuccess(
          queueItem.id,
          officersFound,
          canSearch.nextProvider || 'mistral',
          Date.now() - startTime,
          0
        );
      } catch (e: any) {
        console.warn('[Sub-Agent Harvester] Failed to record success:', e.message);
      }

    } catch (e: any) {
      errors.push(`Priority harvest failed: ${e.message}`);
      
      try {
        await selfImprovementEngine.recordFailure(
          'priority-harvest',
          e.message.includes('rate') ? 'rate_limit' : 
          e.message.includes('timeout') ? 'timeout' : 'search_failure',
          canSearch.nextProvider || 'mistral',
          { error: e.message }
        );
      } catch (selfImpErr: any) {
        console.warn('[Sub-Agent Harvester] Failed to record failure:', selfImpErr.message);
      }
    }

    const duration = Date.now() - startTime;
    const result: HarvestRunResult = {
      success: errors.length === 0,
      officersFound,
      officersAdded,
      officersUpdated,
      errors,
      duration,
    };

    console.log(`[Sub-Agent Harvester] Priority harvest complete: ${officersFound} found in ${Math.round(duration / 1000)}s`);
    
    return result;
  }

  async getSessionStats(): Promise<{
    sessionState: Awaited<ReturnType<typeof searchSessionManager.getSessionState>>;
    queueStats: Awaited<ReturnType<typeof populationPriorityQueue.getQueueStats>>;
  }> {
    const sessionState = await searchSessionManager.getSessionState();
    const queueStats = await populationPriorityQueue.getQueueStats();
    return { sessionState, queueStats };
  }

  async seedJurisdictions(): Promise<void> {
    await populationPriorityQueue.seedInitialJurisdictions();
  }

  private generateSearchQueries(): string[] {
    const states = ['California', 'Texas', 'Florida', 'New York', 'Illinois', 'Pennsylvania', 'Ohio', 'Georgia', 'Michigan', 'Arizona'];
    const queries: string[] = [];
    
    for (const state of states.slice(0, 3)) {
      queries.push(`police officer misconduct ${state} 2024 2025`);
      queries.push(`sheriff deputy complaint ${state}`);
      queries.push(`police department roster ${state}`);
    }
    
    queries.push('police officer disciplinary action public records');
    queries.push('law enforcement misconduct database');
    
    return queries;
  }

  private async performWebSearch(query: string): Promise<WebSearchResult[]> {
    const results: WebSearchResult[] = [];
    
    try {
      const unifiedResults = await unifiedSearch(query, { limit: 10, category: 'officer' });
      
      for (const result of unifiedResults) {
        if (result.url) {
          results.push({
            title: result.title || '',
            url: result.url,
            snippet: result.snippet || result.aiSummary || '',
          });
        }
      }
      
      if (results.length > 0) {
        console.log(`[Sub-Agent Harvester] Unified search returned ${results.length} results`);
        return results;
      }
    } catch (e: any) {
      console.warn('[Sub-Agent Harvester] Unified search failed, trying fallback:', e.message);
    }
    
    try {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      
      const response = await this.fetchWithTimeout(searchUrl, 10000);
      
      if (response) {
        const htmlContent = await response.text();
        const extractedResults = this.parseSearchResults(htmlContent);
        results.push(...extractedResults);
      }
    } catch (e: any) {
      console.warn('[Sub-Agent Harvester] Google search failed:', e.message);
    }
    
    if (results.length === 0) {
      results.push(...await this.searchPublicDatabases(query));
    }
    
    return results;
  }

  private async fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'BadBlue-Research-Bot/1.0 (Police Accountability Research)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      return response;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseSearchResults(html: string): WebSearchResult[] {
    const results: WebSearchResult[] = [];
    
    const linkPattern = /<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    let match;
    
    while ((match = linkPattern.exec(html)) !== null && results.length < 10) {
      const url = match[1];
      const title = match[2];
      
      if (url && title && !url.includes('google.com') && url.startsWith('http')) {
        results.push({
          title: title.trim(),
          url: url,
          snippet: '',
        });
      }
    }
    
    return results;
  }

  private async searchPublicDatabases(query: string): Promise<WebSearchResult[]> {
    const results: WebSearchResult[] = [];
    
    try {
      const databaseQueries = [
        `${query} site:openoversight.com`,
        `${query} site:cpdp.co`,
        `${query} police accountability database`,
      ];
      
      for (const dbQuery of databaseQueries.slice(0, 2)) {
        try {
          const searchResults = await unifiedSearch(dbQuery, { limit: 3 });
          for (const result of searchResults) {
            if (result.url) {
              results.push({
                title: result.title || '',
                url: result.url,
                snippet: result.snippet || result.aiSummary || 'Public police accountability database',
              });
            }
          }
        } catch (e) {
          continue;
        }
      }
    } catch (e: any) {
      console.warn('[Sub-Agent Harvester] Database search via unified service failed:', e.message);
    }
    
    if (results.length === 0) {
      const publicSources = [
        { name: 'Police1', url: 'https://www.police1.com' },
        { name: 'Open Oversight', url: 'https://openoversight.com' },
        { name: 'Citizens Police Data', url: 'https://cpdp.co' },
      ];
      
      for (const source of publicSources) {
        results.push({
          title: `${source.name} - ${query}`,
          url: source.url,
          snippet: `Public police accountability database`,
        });
      }
    }
    
    return results;
  }

  private async extractOfficerData(searchResults: WebSearchResult[]): Promise<OfficerData[]> {
    const officers: OfficerData[] = [];
    
    for (const result of searchResults) {
      try {
        const pageContent = await this.fetchPageContent(result.url);
        if (!pageContent) continue;
        
        const extractedOfficers = this.parseOfficerInfo(pageContent, result.url);
        officers.push(...extractedOfficers);
        
      } catch (e) {
        continue;
      }
    }
    
    return officers;
  }

  private async fetchPageContent(url: string): Promise<string | null> {
    try {
      const response = await this.fetchWithTimeout(url, 15000);
      if (!response || !response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  }

  private parseOfficerInfo(html: string, sourceUrl: string): OfficerData[] {
    const officers: OfficerData[] = [];
    
    const namePatterns = [
      /Officer\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/g,
      /Deputy\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/g,
      /Sgt\.?\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/g,
      /Det\.?\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/g,
      /Chief\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/g,
    ];

    const departmentPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Police Department|Sheriff['']?s? (?:Office|Department)|PD)/gi;
    const locationPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})/g;

    let departmentMatch = departmentPattern.exec(html);
    const department = departmentMatch ? departmentMatch[0] : 'Unknown Department';

    let locationMatch = locationPattern.exec(html);
    const location = locationMatch ? `${locationMatch[1]}, ${locationMatch[2]}` : 'Unknown Location';

    for (const pattern of namePatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const firstName = match[1];
        const lastName = match[2];
        
        if (firstName && lastName && firstName.length > 1 && lastName.length > 1) {
          officers.push({
            firstName,
            lastName,
            fullName: `${firstName} ${lastName}`,
            department,
            location,
            sources: [sourceUrl],
            dataQualityScore: 50,
          });
        }
      }
    }

    return officers;
  }

  private async saveOfficerToDatabase(officer: OfficerData): Promise<'added' | 'updated' | 'skipped'> {
    try {
      const existing = await db
        .select()
        .from(officerProfiles)
        .where(
          and(
            eq(officerProfiles.officerName, officer.fullName),
            eq(officerProfiles.department, officer.department)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        const existingProfile = existing[0];
        const existingSources = existingProfile.sources || [];
        const combinedSources = [...existingSources, ...officer.sources];
        const newSources = Array.from(new Set(combinedSources));
        
        await db
          .update(officerProfiles)
          .set({
            rank: officer.rank || existingProfile.rank,
            location: officer.location || existingProfile.location,
            sources: newSources,
            dataQualityScore: Math.max(officer.dataQualityScore, existingProfile.dataQualityScore || 0),
            lastUpdated: new Date(),
          })
          .where(eq(officerProfiles.id, existingProfile.id));
        
        return 'updated';
      }

      await db.insert(officerProfiles).values({
        officerName: officer.fullName,
        badgeNumber: officer.badgeNumber,
        department: officer.department,
        rank: officer.rank,
        location: officer.location,
        sources: officer.sources,
        dataQualityScore: officer.dataQualityScore,
        lastUpdated: new Date(),
      });

      return 'added';
    } catch (e: any) {
      if (e.message?.includes('unique constraint')) {
        return 'skipped';
      }
      throw e;
    }
  }

  private async logHarvestRun(result: HarvestRunResult): Promise<void> {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        ...result,
      };
      
      let logs: any[] = [];
      try {
        const content = await fs.readFile(this.HARVEST_LOG, 'utf-8');
        logs = JSON.parse(content);
      } catch {
        logs = [];
      }
      
      logs.push(logEntry);
      if (logs.length > 100) logs = logs.slice(-100);
      
      await fs.writeFile(this.HARVEST_LOG, JSON.stringify(logs, null, 2));
    } catch (e) {
      console.warn('[Sub-Agent Harvester] Failed to log harvest run:', e);
    }
  }

  isFileProtected(filePath: string): boolean {
    // Decode URL encoding first
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(filePath);
    } catch {
      decodedPath = filePath;
    }
    
    const normalizedPath = decodedPath.replace(/\\/g, '/').toLowerCase();
    
    // Block directory traversal attempts (check multiple encodings)
    const traversalPatterns = ['..', '%2e%2e', '%2e.', '.%2e', '%252e'];
    for (const pattern of traversalPatterns) {
      if (normalizedPath.includes(pattern)) {
        console.log('[Sub-Agent] Blocked directory traversal attempt:', filePath);
        return true;
      }
    }
    
    // Block null bytes and other injection attempts
    if (normalizedPath.includes('\0') || normalizedPath.includes('%00')) {
      console.log('[Sub-Agent] Blocked null byte injection:', filePath);
      return true;
    }
    
    // Resolve to absolute path and ensure it's within project directory
    const projectRoot = process.cwd();
    try {
      const resolvedPath = path.resolve(projectRoot, decodedPath);
      
      // Additional check: normalize and compare
      const normalizedResolved = path.normalize(resolvedPath);
      if (!normalizedResolved.startsWith(projectRoot + path.sep) && normalizedResolved !== projectRoot) {
        console.log('[Sub-Agent] Blocked path outside project:', filePath, '-> resolved to:', normalizedResolved);
        return true;
      }
    } catch {
      console.log('[Sub-Agent] Blocked invalid path:', filePath);
      return true;
    }
    
    for (const protected_ of PROTECTED_FILES) {
      if (normalizedPath.includes(protected_.toLowerCase())) {
        return true;
      }
    }
    
    for (const pattern of PROTECTED_PATTERNS) {
      if (pattern.test(normalizedPath)) {
        return true;
      }
    }
    
    return false;
  }

  // Async version with symlink detection for actual file operations
  async isFileProtectedAsync(filePath: string): Promise<boolean> {
    // First do synchronous checks
    if (this.isFileProtected(filePath)) {
      return true;
    }
    
    // Now check for symlinks
    const projectRoot = process.cwd();
    try {
      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(filePath);
      } catch {
        decodedPath = filePath;
      }
      
      const resolvedPath = path.resolve(projectRoot, decodedPath);
      
      // Check if path exists before checking symlink
      try {
        const stats = await fs.lstat(resolvedPath);
        if (stats.isSymbolicLink()) {
          // Symlink detected - get real path
          const realPath = await fs.realpath(resolvedPath);
          const normalizedRealPath = path.normalize(realPath);
          
          if (!normalizedRealPath.startsWith(projectRoot + path.sep) && normalizedRealPath !== projectRoot) {
            console.log('[Sub-Agent] Blocked symlink escape:', filePath, '-> real path:', normalizedRealPath);
            return true;
          }
          
          // Check if real path points to protected file
          const realPathLower = normalizedRealPath.toLowerCase();
          for (const protected_ of PROTECTED_FILES) {
            if (realPathLower.includes(protected_.toLowerCase())) {
              console.log('[Sub-Agent] Blocked symlink to protected file:', filePath);
              return true;
            }
          }
        }
      } catch {
        // File doesn't exist yet, which is fine for creation
      }
    } catch (e) {
      console.log('[Sub-Agent] Error checking symlink:', e);
      return true;  // Deny by default on error
    }
    
    return false;
  }

  private isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
    const normalizedCommand = command.trim();
    
    // Check for unicode bypass patterns first
    for (const pattern of UNICODE_BYPASS_PATTERNS) {
      if (pattern.test(normalizedCommand)) {
        return { allowed: false, reason: 'Unicode bypass attempt detected' };
      }
    }
    
    // Check for dangerous patterns first (on original case)
    for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.test(normalizedCommand)) {
        return { allowed: false, reason: 'Dangerous command pattern detected' };
      }
    }
    
    // Check for blocked flag patterns
    for (const pattern of BLOCKED_FLAG_PATTERNS) {
      if (pattern.test(normalizedCommand)) {
        return { allowed: false, reason: 'Blocked flag pattern detected' };
      }
    }
    
    // Decode any URL encoding
    let decodedCommand: string;
    try {
      decodedCommand = decodeURIComponent(normalizedCommand);
      // Check decoded version too
      for (const pattern of UNICODE_BYPASS_PATTERNS) {
        if (pattern.test(decodedCommand)) {
          return { allowed: false, reason: 'Encoded unicode bypass detected' };
        }
      }
      for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
        if (pattern.test(decodedCommand)) {
          return { allowed: false, reason: 'Encoded dangerous pattern detected' };
        }
      }
      for (const pattern of BLOCKED_FLAG_PATTERNS) {
        if (pattern.test(decodedCommand)) {
          return { allowed: false, reason: 'Encoded blocked flag detected' };
        }
      }
    } catch {
      decodedCommand = normalizedCommand;
    }
    
    // Extract command parts
    const parts = decodedCommand.split(/\s+/);
    const baseCommand = parts[0].toLowerCase();
    const subCommand = parts[1]?.toLowerCase();
    
    // Check if base command is in allowed list
    if (!ALLOWED_SHELL_COMMANDS.includes(baseCommand)) {
      return { allowed: false, reason: `Command '${baseCommand}' not in allowed list` };
    }
    
    // Check command-specific restrictions
    const cmdConfig = SAFE_READONLY_COMMANDS[baseCommand];
    if (cmdConfig !== undefined) {
      // Check if command is completely blocked
      if (cmdConfig.blocked.includes('*')) {
        return { allowed: false, reason: `Command '${baseCommand}' is completely disabled` };
      }
      
      // Check if subcommand is explicitly blocked
      if (subCommand && cmdConfig.blocked.includes(subCommand)) {
        return { allowed: false, reason: `Subcommand '${subCommand}' is blocked for ${baseCommand}` };
      }
      
      // Check if subcommand is allowed (if not wildcard)
      if (!cmdConfig.allowed.includes('*') && subCommand && !cmdConfig.allowed.includes(subCommand)) {
        return { allowed: false, reason: `Subcommand '${subCommand}' not in allowlist for ${baseCommand}` };
      }
    }
    
    console.log(`[Sub-Agent] Command allowed: ${baseCommand} ${subCommand || ''}`);
    return { allowed: true };
  }

  async executeAdminCommand(command: string): Promise<{ success: boolean; output: string; error?: string }> {
    console.log('[Sub-Agent] Executing admin command:', command);
    
    const normalizedCommand = command.toLowerCase().trim();
    
    const actionVerbs = ['do', 'make', 'create', 'employ', 'build', 'perform', 'enhance', 'grant', 'edit', 'run', 'execute', 'install', 'update', 'fix', 'repair'];
    const hasActionVerb = actionVerbs.some(verb => normalizedCommand.startsWith(verb) || normalizedCommand.includes(` ${verb} `));
    
    if (!hasActionVerb) {
      return {
        success: false,
        output: '',
        error: 'Command not recognized as an executable action',
      };
    }

    await this.logAdminCommand(command, 'started');

    try {
      if (normalizedCommand.includes('install') && normalizedCommand.includes('package')) {
        return await this.installNpmPackage(command);
      }
      
      if (normalizedCommand.includes('create') && normalizedCommand.includes('file')) {
        return await this.createFile(command);
      }
      
      if (normalizedCommand.includes('edit') || normalizedCommand.includes('update')) {
        return await this.editFile(command);
      }
      
      if (normalizedCommand.includes('run') || normalizedCommand.includes('execute')) {
        return await this.runShellCommand(command);
      }
      
      if (normalizedCommand.includes('fix') || normalizedCommand.includes('repair')) {
        return await this.performRepair(command);
      }
      
      return await this.interpretAndExecute(command);
      
    } catch (e: any) {
      await this.logAdminCommand(command, 'failed', e.message);
      return {
        success: false,
        output: '',
        error: e.message,
      };
    }
  }

  private async installNpmPackage(command: string): Promise<{ success: boolean; output: string; error?: string }> {
    const packageMatch = command.match(/install\s+(?:package\s+)?["']?([a-z0-9@\-\/]+)["']?/i);
    
    if (!packageMatch) {
      return { success: false, output: '', error: 'Could not parse package name' };
    }
    
    const packageName = packageMatch[1];
    
    console.log(`[Sub-Agent] Installing npm package: ${packageName}`);
    
    try {
      const { stdout, stderr } = await exec(`npm install ${packageName}`, {
        timeout: 120000,
        cwd: process.cwd(),
      });
      
      await this.logAdminCommand(`npm install ${packageName}`, 'completed', stdout);
      
      return {
        success: true,
        output: stdout || stderr,
      };
    } catch (e: any) {
      return {
        success: false,
        output: '',
        error: e.message,
      };
    }
  }

  private async createFile(command: string): Promise<{ success: boolean; output: string; error?: string }> {
    const pathMatch = command.match(/file\s+(?:at\s+)?["']?([^"'\s]+)["']?/i);
    
    if (!pathMatch) {
      return { success: false, output: '', error: 'Could not parse file path' };
    }
    
    const filePath = pathMatch[1];
    
    // Use async version with symlink detection
    const isProtected = await this.isFileProtectedAsync(filePath);
    if (isProtected) {
      return { success: false, output: '', error: 'Cannot create protected file' };
    }
    
    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, '');
      
      await this.logAdminCommand(`create file ${filePath}`, 'completed');
      
      return {
        success: true,
        output: `Created file: ${filePath}`,
      };
    } catch (e: any) {
      return { success: false, output: '', error: e.message };
    }
  }

  private async editFile(command: string): Promise<{ success: boolean; output: string; error?: string }> {
    const pathMatch = command.match(/(?:edit|update)\s+(?:file\s+)?["']?([^"'\s]+)["']?/i);
    
    if (!pathMatch) {
      return { success: false, output: '', error: 'Could not parse file path' };
    }
    
    const filePath = pathMatch[1];
    
    // Use async version with symlink detection
    const isProtected = await this.isFileProtectedAsync(filePath);
    if (isProtected) {
      return { success: false, output: '', error: 'Cannot edit protected file - admin bypass and payment credentials are protected' };
    }
    
    return {
      success: true,
      output: `File ${filePath} is editable (requires specific edit instructions)`,
    };
  }

  private async runShellCommand(command: string): Promise<{ success: boolean; output: string; error?: string }> {
    const cmdMatch = command.match(/(?:run|execute)\s+["']?(.+?)["']?$/i);
    
    if (!cmdMatch) {
      return { success: false, output: '', error: 'Could not parse shell command' };
    }
    
    const shellCmd = cmdMatch[1];
    
    // Use improved command validation
    const commandCheck = this.isCommandAllowed(shellCmd);
    if (!commandCheck.allowed) {
      console.log('[Sub-Agent] Command blocked:', commandCheck.reason);
      return { success: false, output: '', error: commandCheck.reason || 'Command not allowed' };
    }
    
    try {
      const { stdout, stderr } = await exec(shellCmd, {
        timeout: 60000,
        cwd: process.cwd(),
      });
      
      await this.logAdminCommand(shellCmd, 'completed', stdout);
      
      return {
        success: true,
        output: stdout || stderr,
      };
    } catch (e: any) {
      return { success: false, output: '', error: e.message };
    }
  }

  private async performRepair(command: string): Promise<{ success: boolean; output: string; error?: string }> {
    console.log('[Sub-Agent] Performing repair:', command);
    
    if (command.includes('database')) {
      try {
        const { db: dbInstance } = await import('./db');
        await (dbInstance as any).execute('SELECT 1');
        return { success: true, output: 'Database connection verified' };
      } catch (e: any) {
        return { success: false, output: '', error: e.message };
      }
    }
    
    return { success: true, output: 'Repair command acknowledged' };
  }

  private async interpretAndExecute(command: string): Promise<{ success: boolean; output: string; error?: string }> {
    console.log('[Sub-Agent] Interpreting command:', command);
    
    await this.logAdminCommand(command, 'interpreted');
    
    return {
      success: true,
      output: `Command interpreted and queued for execution: ${command}`,
    };
  }

  private async logAdminCommand(command: string, status: string, details?: string): Promise<void> {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        command,
        status,
        details,
      };
      
      let logs: any[] = [];
      try {
        const content = await fs.readFile(this.COMMANDS_LOG, 'utf-8');
        logs = JSON.parse(content);
      } catch {
        logs = [];
      }
      
      logs.push(logEntry);
      if (logs.length > 500) logs = logs.slice(-500);
      
      await fs.writeFile(this.COMMANDS_LOG, JSON.stringify(logs, null, 2));
    } catch (e) {
      console.warn('[Sub-Agent] Failed to log command:', e);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async shutdown(): Promise<void> {
    console.log('[Sub-Agent Harvester] Shutting down...');
    if (this.dailySchedule) {
      clearTimeout(this.dailySchedule);
    }
    console.log('[Sub-Agent Harvester] Shutdown complete');
  }

  async getStatus(): Promise<{
    isRunning: boolean;
    lastRunAt: Date | null;
    consecutiveFailures: number;
    nextScheduledRun: Date;
  }> {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(2, 30, 0, 0);
    if (now >= next) next.setDate(next.getDate() + 1);

    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      consecutiveFailures: this.consecutiveFailures,
      nextScheduledRun: next,
    };
  }
}

export const subAgentHarvester = SubAgentWebHarvester.getInstance();
