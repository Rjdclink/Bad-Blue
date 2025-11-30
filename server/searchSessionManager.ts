import { db } from './db';
import { sql } from 'drizzle-orm';
import { 
  subagentSearchSessions, 
  officerCategoryPriority,
  jurisdictionPopulations,
  subagentSearchQueue
} from '@shared/schema';
import { eq, desc, and, gte, lte, isNull, or } from 'drizzle-orm';

interface SessionState {
  isActive: boolean;
  currentSession: typeof subagentSearchSessions.$inferSelect | null;
  isInSearchInterval: boolean;
  timeUntilNextInterval: number;
  minutesRemaining: number;
  dailyBudget: number;
}

interface IntervalPlan {
  searchDuration: number;
  restDuration: number;
  intervals: Array<{
    type: 'search' | 'rest';
    startMinute: number;
    endMinute: number;
  }>;
}

class SearchSessionManager {
  private static instance: SearchSessionManager;
  private sessionCheckInterval: NodeJS.Timeout | null = null;
  private currentSessionDate: string | null = null;
  private sessionStartTime: Date | null = null;
  private totalSearchMinutes = 0;
  private isSearchingActive = false;

  private readonly DAILY_BUDGET_MINUTES = 180;
  private readonly SEARCH_INTERVAL_MINUTES = 10;
  private readonly REST_INTERVAL_MINUTES = 10;

  private constructor() {}

  static getInstance(): SearchSessionManager {
    if (!SearchSessionManager.instance) {
      SearchSessionManager.instance = new SearchSessionManager();
    }
    return SearchSessionManager.instance;
  }

  async initialize(): Promise<void> {
    console.log('[SearchSessionManager] Initializing...');
    
    try {
      await this.ensureTodaySession();
      this.startIntervalMonitor();
      console.log('[SearchSessionManager] ✓ Initialized with 3-hour daily budget');
    } catch (error: any) {
      console.error('[SearchSessionManager] Initialization failed:', error.message);
    }
  }

  private getTodayDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  private async ensureTodaySession(): Promise<typeof subagentSearchSessions.$inferSelect> {
    const today = this.getTodayDateString();
    
    const existingSession = await db
      .select()
      .from(subagentSearchSessions)
      .where(eq(subagentSearchSessions.sessionDate, today))
      .limit(1);

    if (existingSession.length > 0) {
      this.currentSessionDate = today;
      return existingSession[0];
    }

    const intervalPlan = this.generateIntervalPlan();
    
    const [newSession] = await db.insert(subagentSearchSessions).values({
      sessionDate: today,
      totalBudgetMinutes: this.DAILY_BUDGET_MINUTES,
      minutesUsed: 0,
      minutesRemaining: this.DAILY_BUDGET_MINUTES,
      intervalPlan: intervalPlan,
      searchesCompleted: 0,
      officersFound: 0,
      status: 'active',
    }).returning();

    this.currentSessionDate = today;
    console.log(`[SearchSessionManager] Created new session for ${today} with ${this.DAILY_BUDGET_MINUTES}min budget`);
    
    return newSession;
  }

  private generateIntervalPlan(): IntervalPlan {
    const intervals: IntervalPlan['intervals'] = [];
    let currentMinute = 0;
    
    while (currentMinute < this.DAILY_BUDGET_MINUTES) {
      const searchEnd = Math.min(currentMinute + this.SEARCH_INTERVAL_MINUTES, this.DAILY_BUDGET_MINUTES);
      intervals.push({
        type: 'search',
        startMinute: currentMinute,
        endMinute: searchEnd
      });
      currentMinute = searchEnd;
      
      if (currentMinute < this.DAILY_BUDGET_MINUTES) {
        const restEnd = currentMinute + this.REST_INTERVAL_MINUTES;
        intervals.push({
          type: 'rest',
          startMinute: currentMinute,
          endMinute: restEnd
        });
        currentMinute = restEnd;
      }
    }

    return {
      searchDuration: this.SEARCH_INTERVAL_MINUTES,
      restDuration: this.REST_INTERVAL_MINUTES,
      intervals
    };
  }

  private startIntervalMonitor(): void {
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
    }

    this.sessionCheckInterval = setInterval(async () => {
      await this.checkAndUpdateSession();
    }, 60000);
  }

  private async checkAndUpdateSession(): Promise<void> {
    const today = this.getTodayDateString();
    
    if (this.currentSessionDate !== today) {
      await this.ensureTodaySession();
    }
  }

  async getSessionState(): Promise<SessionState> {
    const session = await this.ensureTodaySession();
    
    const isInSearchInterval = this.calculateIsSearchInterval(session);
    const timeUntilNextInterval = this.calculateTimeUntilNextInterval(session);
    
    return {
      isActive: session.status === 'active',
      currentSession: session,
      isInSearchInterval,
      timeUntilNextInterval,
      minutesRemaining: session.minutesRemaining ?? 0,
      dailyBudget: session.totalBudgetMinutes ?? this.DAILY_BUDGET_MINUTES
    };
  }

  private calculateIsSearchInterval(session: typeof subagentSearchSessions.$inferSelect): boolean {
    const minutesUsed = session.minutesUsed ?? 0;
    const cycleLength = this.SEARCH_INTERVAL_MINUTES + this.REST_INTERVAL_MINUTES;
    const positionInCycle = minutesUsed % cycleLength;
    
    return positionInCycle < this.SEARCH_INTERVAL_MINUTES;
  }

  private calculateTimeUntilNextInterval(session: typeof subagentSearchSessions.$inferSelect): number {
    const minutesUsed = session.minutesUsed ?? 0;
    const cycleLength = this.SEARCH_INTERVAL_MINUTES + this.REST_INTERVAL_MINUTES;
    const positionInCycle = minutesUsed % cycleLength;
    
    if (positionInCycle < this.SEARCH_INTERVAL_MINUTES) {
      return this.SEARCH_INTERVAL_MINUTES - positionInCycle;
    } else {
      return cycleLength - positionInCycle;
    }
  }

  async canStartSearch(): Promise<{ allowed: boolean; reason: string; waitMinutes?: number }> {
    const state = await this.getSessionState();
    
    if (!state.isActive) {
      return { allowed: false, reason: 'Session is not active' };
    }
    
    if (state.minutesRemaining <= 0) {
      return { allowed: false, reason: 'Daily budget exhausted' };
    }
    
    if (!state.isInSearchInterval) {
      return { 
        allowed: false, 
        reason: 'Currently in rest interval',
        waitMinutes: state.timeUntilNextInterval
      };
    }
    
    return { allowed: true, reason: 'Search allowed' };
  }

  async recordSearchTime(durationMinutes: number): Promise<void> {
    const today = this.getTodayDateString();
    
    await db.execute(sql`
      UPDATE subagent_search_sessions 
      SET 
        minutes_used = minutes_used + ${durationMinutes},
        minutes_remaining = minutes_remaining - ${durationMinutes},
        updated_at = NOW()
      WHERE session_date = ${today}
    `);
    
    this.totalSearchMinutes += durationMinutes;
  }

  async recordSearchCompletion(officersFound: number): Promise<void> {
    const today = this.getTodayDateString();
    
    await db.execute(sql`
      UPDATE subagent_search_sessions 
      SET 
        searches_completed = searches_completed + 1,
        officers_found = officers_found + ${officersFound},
        updated_at = NOW()
      WHERE session_date = ${today}
    `);
  }

  async pauseSession(reason?: string): Promise<void> {
    const today = this.getTodayDateString();
    
    await db.execute(sql`
      UPDATE subagent_search_sessions 
      SET 
        status = 'paused',
        paused_at = NOW(),
        updated_at = NOW()
      WHERE session_date = ${today}
    `);
    
    this.isSearchingActive = false;
    console.log(`[SearchSessionManager] Session paused${reason ? `: ${reason}` : ''}`);
  }

  async resumeSession(): Promise<void> {
    const today = this.getTodayDateString();
    
    await db.execute(sql`
      UPDATE subagent_search_sessions 
      SET 
        status = 'active',
        resumed_at = NOW(),
        updated_at = NOW()
      WHERE session_date = ${today}
    `);
    
    console.log('[SearchSessionManager] Session resumed');
  }

  async exhaustSession(): Promise<void> {
    const today = this.getTodayDateString();
    
    await db.execute(sql`
      UPDATE subagent_search_sessions 
      SET 
        status = 'exhausted',
        updated_at = NOW()
      WHERE session_date = ${today}
    `);
    
    this.isSearchingActive = false;
    console.log('[SearchSessionManager] Daily session budget exhausted');
  }

  async getSessionStats(): Promise<{
    today: typeof subagentSearchSessions.$inferSelect | null;
    weekTotal: { searches: number; officers: number; minutes: number };
  }> {
    const today = this.getTodayDateString();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    
    const todaySession = await db
      .select()
      .from(subagentSearchSessions)
      .where(eq(subagentSearchSessions.sessionDate, today))
      .limit(1);

    const weekStats = await db.execute(sql`
      SELECT 
        COALESCE(SUM(searches_completed), 0) as total_searches,
        COALESCE(SUM(officers_found), 0) as total_officers,
        COALESCE(SUM(minutes_used), 0) as total_minutes
      FROM subagent_search_sessions
      WHERE session_date >= ${weekAgoStr}
    `);

    const stats = weekStats.rows[0] as any;

    return {
      today: todaySession[0] ?? null,
      weekTotal: {
        searches: parseInt(stats.total_searches) || 0,
        officers: parseInt(stats.total_officers) || 0,
        minutes: parseInt(stats.total_minutes) || 0
      }
    };
  }

  async getCategoryPriorities(): Promise<Array<typeof officerCategoryPriority.$inferSelect>> {
    return db
      .select()
      .from(officerCategoryPriority)
      .where(eq(officerCategoryPriority.isActive, true))
      .orderBy(officerCategoryPriority.priorityOrder);
  }

  async getNextSearchTarget(): Promise<typeof subagentSearchQueue.$inferSelect | null> {
    const now = new Date();
    
    const canSearch = await this.canStartSearch();
    if (!canSearch.allowed) {
      console.log(`[SearchSessionManager] Cannot search: ${canSearch.reason}`);
      return null;
    }

    const nextTarget = await db
      .select()
      .from(subagentSearchQueue)
      .where(
        and(
          eq(subagentSearchQueue.status, 'queued'),
          or(
            isNull(subagentSearchQueue.nextAttemptAt),
            lte(subagentSearchQueue.nextAttemptAt, now)
          )
        )
      )
      .orderBy(desc(subagentSearchQueue.priorityScore))
      .limit(1);

    return nextTarget[0] ?? null;
  }

  async markSearchInProgress(queueId: string): Promise<void> {
    await db
      .update(subagentSearchQueue)
      .set({
        status: 'in_progress',
        lastAttemptAt: new Date(),
        attemptCount: sql`attempt_count + 1`
      })
      .where(eq(subagentSearchQueue.id, queueId));
  }

  async markSearchCompleted(queueId: string, officersFound: number): Promise<void> {
    await db
      .update(subagentSearchQueue)
      .set({
        status: 'completed',
        officersFound: officersFound
      })
      .where(eq(subagentSearchQueue.id, queueId));
  }

  async markSearchFailed(queueId: string, errorMessage: string): Promise<void> {
    const retryDelay = 30 * 60 * 1000;
    const nextAttempt = new Date(Date.now() + retryDelay);
    
    await db
      .update(subagentSearchQueue)
      .set({
        status: 'failed',
        errorMessage: errorMessage,
        nextAttemptAt: nextAttempt
      })
      .where(eq(subagentSearchQueue.id, queueId));
  }

  async shutdown(): Promise<void> {
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
      this.sessionCheckInterval = null;
    }
    console.log('[SearchSessionManager] Shutdown complete');
  }
}

export const searchSessionManager = SearchSessionManager.getInstance();
