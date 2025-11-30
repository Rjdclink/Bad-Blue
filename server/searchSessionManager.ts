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
  elapsedMinutes: number;
}

interface IntervalPlan {
  searchDuration: number;
  restDuration: number;
  sessionStartedAt: string;
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
  private sessionStartedAt: Date | null = null;

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
      const session = await this.ensureTodaySession();
      const intervalPlan = session.intervalPlan as IntervalPlan | null;
      if (intervalPlan?.sessionStartedAt) {
        this.sessionStartedAt = new Date(intervalPlan.sessionStartedAt);
      } else {
        this.sessionStartedAt = new Date();
      }
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
      const intervalPlan = existingSession[0].intervalPlan as IntervalPlan | null;
      if (intervalPlan?.sessionStartedAt) {
        this.sessionStartedAt = new Date(intervalPlan.sessionStartedAt);
      }
      return existingSession[0];
    }

    const now = new Date();
    this.sessionStartedAt = now;
    const intervalPlan = this.generateIntervalPlan(now);
    
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

  private generateIntervalPlan(startTime: Date): IntervalPlan {
    const intervals: IntervalPlan['intervals'] = [];
    const cycleLength = this.SEARCH_INTERVAL_MINUTES + this.REST_INTERVAL_MINUTES;
    const totalCycles = Math.ceil(this.DAILY_BUDGET_MINUTES / this.SEARCH_INTERVAL_MINUTES);
    
    let currentMinute = 0;
    for (let i = 0; i < totalCycles && currentMinute < this.DAILY_BUDGET_MINUTES * 2; i++) {
      intervals.push({
        type: 'search',
        startMinute: currentMinute,
        endMinute: currentMinute + this.SEARCH_INTERVAL_MINUTES
      });
      currentMinute += this.SEARCH_INTERVAL_MINUTES;
      
      intervals.push({
        type: 'rest',
        startMinute: currentMinute,
        endMinute: currentMinute + this.REST_INTERVAL_MINUTES
      });
      currentMinute += this.REST_INTERVAL_MINUTES;
    }

    return {
      searchDuration: this.SEARCH_INTERVAL_MINUTES,
      restDuration: this.REST_INTERVAL_MINUTES,
      sessionStartedAt: startTime.toISOString(),
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

  private getElapsedMinutes(): number {
    if (!this.sessionStartedAt) {
      return 0;
    }
    const now = new Date();
    const elapsedMs = now.getTime() - this.sessionStartedAt.getTime();
    return Math.floor(elapsedMs / 60000);
  }

  private calculateCurrentInterval(): { type: 'search' | 'rest'; minutesIntoInterval: number; minutesUntilEnd: number } {
    const elapsedMinutes = this.getElapsedMinutes();
    const cycleLength = this.SEARCH_INTERVAL_MINUTES + this.REST_INTERVAL_MINUTES;
    const positionInCycle = elapsedMinutes % cycleLength;
    
    if (positionInCycle < this.SEARCH_INTERVAL_MINUTES) {
      return {
        type: 'search',
        minutesIntoInterval: positionInCycle,
        minutesUntilEnd: this.SEARCH_INTERVAL_MINUTES - positionInCycle
      };
    } else {
      const restPosition = positionInCycle - this.SEARCH_INTERVAL_MINUTES;
      return {
        type: 'rest',
        minutesIntoInterval: restPosition,
        minutesUntilEnd: this.REST_INTERVAL_MINUTES - restPosition
      };
    }
  }

  async getSessionState(): Promise<SessionState> {
    const session = await this.ensureTodaySession();
    const interval = this.calculateCurrentInterval();
    const elapsedMinutes = this.getElapsedMinutes();
    
    return {
      isActive: session.status === 'active',
      currentSession: session,
      isInSearchInterval: interval.type === 'search',
      timeUntilNextInterval: interval.minutesUntilEnd,
      minutesRemaining: session.minutesRemaining ?? 0,
      dailyBudget: session.totalBudgetMinutes ?? this.DAILY_BUDGET_MINUTES,
      elapsedMinutes
    };
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
        minutes_remaining = GREATEST(0, minutes_remaining - ${durationMinutes}),
        updated_at = NOW()
      WHERE session_date = ${today}
    `);
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
    
    console.log('[SearchSessionManager] Daily session budget exhausted');
  }

  async getSessionStats(): Promise<{
    today: typeof subagentSearchSessions.$inferSelect | null;
    weekTotal: { searches: number; officers: number; minutes: number };
    currentInterval: { type: 'search' | 'rest'; minutesIntoInterval: number; minutesUntilEnd: number };
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
    const currentInterval = this.calculateCurrentInterval();

    return {
      today: todaySession[0] ?? null,
      weekTotal: {
        searches: parseInt(stats.total_searches) || 0,
        officers: parseInt(stats.total_officers) || 0,
        minutes: parseInt(stats.total_minutes) || 0
      },
      currentInterval
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
