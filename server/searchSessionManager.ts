import { db } from './db';
import { sql } from 'drizzle-orm';
import { 
  subagentSearchSessions, 
  officerCategoryPriority,
  jurisdictionPopulations,
  subagentSearchQueue
} from '@shared/schema';
import { eq, desc, and, gte, lte, isNull, or } from 'drizzle-orm';
import { 
  computeAdaptiveSearchDelay, 
  getProviderRateProfiles,
  UsageContext,
  AIProvider 
} from './aiTokenGovernor';

interface SessionState {
  isActive: boolean;
  currentSession: typeof subagentSearchSessions.$inferSelect | null;
  canSearchNow: boolean;
  waitSeconds: number;
  reason: string;
  minutesRemaining: number;
  dailyBudget: number;
  nextProvider: AIProvider | null;
}

interface AdaptiveIntervalPlan {
  sessionStartedAt: string;
  lastSearchAt: string | null;
  currentDelaySeconds: number;
  providerSequence: AIProvider[];
}

class SearchSessionManager {
  private static instance: SearchSessionManager;
  private sessionCheckInterval: NodeJS.Timeout | null = null;
  private currentSessionDate: string | null = null;
  private sessionStartedAt: Date | null = null;
  private lastSearchTime: Date | null = null;
  private currentDelaySeconds: number = 60;

  private readonly DAILY_BUDGET_MINUTES = 180;
  private readonly MIN_DELAY_SECONDS = 30;
  private readonly MAX_DELAY_SECONDS = 300;

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
      const intervalPlan = session.intervalPlan as AdaptiveIntervalPlan | null;
      
      if (intervalPlan?.sessionStartedAt) {
        this.sessionStartedAt = new Date(intervalPlan.sessionStartedAt);
      } else {
        this.sessionStartedAt = new Date();
      }
      
      if (intervalPlan?.lastSearchAt) {
        this.lastSearchTime = new Date(intervalPlan.lastSearchAt);
      }
      
      if (intervalPlan?.currentDelaySeconds) {
        this.currentDelaySeconds = intervalPlan.currentDelaySeconds;
      }

      const delay = await this.computeCurrentDelay();
      this.currentDelaySeconds = delay.delaySeconds;
      
      this.startIntervalMonitor();
      console.log(`[SearchSessionManager] ✓ Initialized with adaptive intervals (current: ${this.currentDelaySeconds}s)`);
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

    const now = new Date();
    this.sessionStartedAt = now;
    this.lastSearchTime = null;
    
    const delay = await this.computeCurrentDelay();
    this.currentDelaySeconds = delay.delaySeconds;
    
    const intervalPlan: AdaptiveIntervalPlan = {
      sessionStartedAt: now.toISOString(),
      lastSearchAt: null,
      currentDelaySeconds: this.currentDelaySeconds,
      providerSequence: []
    };
    
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
    console.log(`[SearchSessionManager] Created new session for ${today} with adaptive intervals`);
    
    return newSession;
  }

  private async computeCurrentDelay(): Promise<{ delaySeconds: number; reason: string; nextProvider: AIProvider | null }> {
    try {
      const result = await computeAdaptiveSearchDelay(UsageContext.AUTONOMOUS);
      
      const clampedDelay = Math.max(
        this.MIN_DELAY_SECONDS,
        Math.min(this.MAX_DELAY_SECONDS, result.delaySeconds)
      );
      
      return {
        delaySeconds: clampedDelay,
        reason: result.reason,
        nextProvider: result.nextProvider
      };
    } catch (error: any) {
      console.error('[SearchSessionManager] Error computing delay:', error.message);
      return {
        delaySeconds: 60,
        reason: 'Fallback delay due to error',
        nextProvider: null
      };
    }
  }

  private startIntervalMonitor(): void {
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
    }

    this.sessionCheckInterval = setInterval(async () => {
      await this.checkAndUpdateSession();
    }, 180000);
  }

  private async checkAndUpdateSession(): Promise<void> {
    const today = this.getTodayDateString();
    
    if (this.currentSessionDate !== today) {
      this.lastSearchTime = null;
      await this.ensureTodaySession();
    }
    
    const delay = await this.computeCurrentDelay();
    if (Math.abs(delay.delaySeconds - this.currentDelaySeconds) > 10) {
      this.currentDelaySeconds = delay.delaySeconds;
      console.log(`[SearchSessionManager] Adjusted interval to ${this.currentDelaySeconds}s: ${delay.reason}`);
    }
  }

  private getSecondsSinceLastSearch(): number {
    if (!this.lastSearchTime) {
      return Infinity;
    }
    const now = new Date();
    return Math.floor((now.getTime() - this.lastSearchTime.getTime()) / 1000);
  }

  async getSessionState(): Promise<SessionState> {
    const session = await this.ensureTodaySession();
    const delay = await this.computeCurrentDelay();
    
    const secondsSinceLastSearch = this.getSecondsSinceLastSearch();
    const canSearchNow = secondsSinceLastSearch >= this.currentDelaySeconds;
    const waitSeconds = canSearchNow ? 0 : (this.currentDelaySeconds - secondsSinceLastSearch);
    
    let reason = '';
    if (!canSearchNow) {
      reason = `Wait ${waitSeconds}s until next search allowed`;
    } else if (session.status !== 'active') {
      reason = 'Session not active';
    } else if ((session.minutesRemaining ?? 0) <= 0) {
      reason = 'Daily budget exhausted';
    } else {
      reason = 'Ready to search';
    }
    
    return {
      isActive: session.status === 'active',
      currentSession: session,
      canSearchNow: canSearchNow && session.status === 'active' && (session.minutesRemaining ?? 0) > 0,
      waitSeconds,
      reason,
      minutesRemaining: session.minutesRemaining ?? 0,
      dailyBudget: session.totalBudgetMinutes ?? this.DAILY_BUDGET_MINUTES,
      nextProvider: delay.nextProvider
    };
  }

  async canStartSearch(): Promise<{ allowed: boolean; reason: string; waitSeconds?: number; nextProvider?: AIProvider | null }> {
    const state = await this.getSessionState();
    
    if (!state.isActive) {
      return { allowed: false, reason: 'Session is not active' };
    }
    
    if (state.minutesRemaining <= 0) {
      return { allowed: false, reason: 'Daily budget exhausted' };
    }
    
    if (!state.canSearchNow) {
      return { 
        allowed: false, 
        reason: state.reason,
        waitSeconds: state.waitSeconds,
        nextProvider: state.nextProvider
      };
    }
    
    return { 
      allowed: true, 
      reason: 'Search allowed',
      nextProvider: state.nextProvider
    };
  }

  async getAdaptiveDelay(): Promise<{ delaySeconds: number; reason: string; nextProvider: AIProvider | null }> {
    return this.computeCurrentDelay();
  }

  async recordSearchStart(): Promise<void> {
    this.lastSearchTime = new Date();
    
    const today = this.getTodayDateString();
    const delay = await this.computeCurrentDelay();
    this.currentDelaySeconds = delay.delaySeconds;
    
    const intervalPlan: AdaptiveIntervalPlan = {
      sessionStartedAt: this.sessionStartedAt?.toISOString() || new Date().toISOString(),
      lastSearchAt: this.lastSearchTime.toISOString(),
      currentDelaySeconds: this.currentDelaySeconds,
      providerSequence: []
    };
    
    await db.execute(sql`
      UPDATE subagent_search_sessions 
      SET 
        interval_plan = ${JSON.stringify(intervalPlan)}::jsonb,
        updated_at = NOW()
      WHERE session_date = ${today}
    `);
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

  async recordSearchCompletion(officersFound: number, provider?: AIProvider): Promise<void> {
    const today = this.getTodayDateString();
    
    await db.execute(sql`
      UPDATE subagent_search_sessions 
      SET 
        searches_completed = searches_completed + 1,
        officers_found = officers_found + ${officersFound},
        updated_at = NOW()
      WHERE session_date = ${today}
    `);
    
    const delay = await this.computeCurrentDelay();
    this.currentDelaySeconds = delay.delaySeconds;
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
    currentDelay: { seconds: number; reason: string; nextProvider: AIProvider | null };
    providerProfiles: any[];
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
    const delay = await this.computeCurrentDelay();
    
    let providerProfiles: any[] = [];
    try {
      providerProfiles = await getProviderRateProfiles();
    } catch (e) {
      console.error('[SearchSessionManager] Failed to get provider profiles');
    }

    return {
      today: todaySession[0] ?? null,
      weekTotal: {
        searches: parseInt(stats.total_searches) || 0,
        officers: parseInt(stats.total_officers) || 0,
        minutes: parseInt(stats.total_minutes) || 0
      },
      currentDelay: {
        seconds: delay.delaySeconds,
        reason: delay.reason,
        nextProvider: delay.nextProvider
      },
      providerProfiles
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
      if (canSearch.waitSeconds && canSearch.waitSeconds < 60) {
        console.log(`[SearchSessionManager] Wait ${canSearch.waitSeconds}s before next search`);
      }
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
    await this.recordSearchStart();
    
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
    const delay = await this.computeCurrentDelay();
    const retryDelay = Math.max(delay.delaySeconds * 1000, 30 * 60 * 1000);
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
