import { db } from './db';
import { sql } from 'drizzle-orm';
import { 
  jurisdictionPopulations, 
  officerCategoryPriority,
  subagentSearchQueue 
} from '@shared/schema';
import { eq, desc, and, inArray, isNull, lte, or } from 'drizzle-orm';

interface JurisdictionData {
  city: string;
  state: string;
  population: number;
  region?: string;
  entityType: string;
}

interface PriorityWeights {
  municipal: number;
  town: number;
  state: number;
  government: number;
  corrections: number;
}

const PRIORITY_WEIGHTS: PriorityWeights = {
  municipal: 100,
  town: 75,
  state: 50,
  government: 30,
  corrections: 20
};

const POPULATION_THRESHOLDS = {
  largeCityMin: 100000,
  mediumCityMin: 50000,
  smallCityMin: 10000,
  townMin: 1000
};

class PopulationPriorityQueue {
  private static instance: PopulationPriorityQueue;
  
  private constructor() {}

  static getInstance(): PopulationPriorityQueue {
    if (!PopulationPriorityQueue.instance) {
      PopulationPriorityQueue.instance = new PopulationPriorityQueue();
    }
    return PopulationPriorityQueue.instance;
  }

  async initialize(): Promise<void> {
    console.log('[PopulationPriorityQueue] Initializing...');
    
    try {
      await this.ensureCategoryPrioritiesExist();
      const queueSize = await this.getQueueSize();
      console.log(`[PopulationPriorityQueue] ✓ Initialized (${queueSize} items in queue)`);
    } catch (error: any) {
      console.error('[PopulationPriorityQueue] Initialization failed:', error.message);
    }
  }

  private async ensureCategoryPrioritiesExist(): Promise<void> {
    const existing = await db.select().from(officerCategoryPriority).limit(1);
    
    if (existing.length === 0) {
      console.log('[PopulationPriorityQueue] Inserting default category priorities...');
      
      await db.insert(officerCategoryPriority).values([
        { categoryName: 'municipal', priorityOrder: 1, searchIntervalMinutes: 10, restIntervalMinutes: 10, dailyBudgetMinutes: 90 },
        { categoryName: 'town', priorityOrder: 2, searchIntervalMinutes: 10, restIntervalMinutes: 10, dailyBudgetMinutes: 45 },
        { categoryName: 'state', priorityOrder: 3, searchIntervalMinutes: 10, restIntervalMinutes: 10, dailyBudgetMinutes: 25 },
        { categoryName: 'government', priorityOrder: 4, searchIntervalMinutes: 10, restIntervalMinutes: 10, dailyBudgetMinutes: 15 },
        { categoryName: 'corrections', priorityOrder: 5, searchIntervalMinutes: 10, restIntervalMinutes: 10, dailyBudgetMinutes: 5 }
      ]).onConflictDoNothing();
    }
  }

  calculatePriorityScore(population: number, entityType: string): number {
    const typeWeight = PRIORITY_WEIGHTS[entityType as keyof PriorityWeights] || 10;
    
    let populationMultiplier = 1;
    if (population >= POPULATION_THRESHOLDS.largeCityMin) {
      populationMultiplier = 4;
    } else if (population >= POPULATION_THRESHOLDS.mediumCityMin) {
      populationMultiplier = 3;
    } else if (population >= POPULATION_THRESHOLDS.smallCityMin) {
      populationMultiplier = 2;
    } else if (population >= POPULATION_THRESHOLDS.townMin) {
      populationMultiplier = 1.5;
    }

    const populationScore = Math.min(Math.floor(Math.log10(population + 1) * 10), 60);
    
    return Math.round((typeWeight * populationMultiplier) + populationScore);
  }

  determineEntityType(population: number): string {
    if (population >= POPULATION_THRESHOLDS.mediumCityMin) {
      return 'municipal';
    } else if (population >= POPULATION_THRESHOLDS.townMin) {
      return 'town';
    }
    return 'town';
  }

  async addJurisdiction(data: JurisdictionData): Promise<string> {
    const priorityScore = this.calculatePriorityScore(data.population, data.entityType);
    
    const [jurisdiction] = await db.insert(jurisdictionPopulations).values({
      city: data.city,
      state: data.state,
      population: data.population,
      region: data.region,
      entityType: data.entityType,
      priorityScore: priorityScore,
      searchStatus: 'pending'
    }).onConflictDoNothing().returning();

    if (jurisdiction) {
      await this.queueJurisdiction(jurisdiction.id, data.entityType, priorityScore);
      return jurisdiction.id;
    }
    
    const existing = await db
      .select()
      .from(jurisdictionPopulations)
      .where(and(
        eq(jurisdictionPopulations.city, data.city),
        eq(jurisdictionPopulations.state, data.state)
      ))
      .limit(1);
    
    return existing[0]?.id ?? '';
  }

  async addJurisdictionsBulk(jurisdictions: JurisdictionData[]): Promise<number> {
    let addedCount = 0;
    
    for (const jurisdiction of jurisdictions) {
      try {
        const id = await this.addJurisdiction(jurisdiction);
        if (id) addedCount++;
      } catch (error: any) {
        console.warn(`[PopulationPriorityQueue] Failed to add ${jurisdiction.city}, ${jurisdiction.state}:`, error.message);
      }
    }
    
    console.log(`[PopulationPriorityQueue] Added ${addedCount} jurisdictions to queue`);
    return addedCount;
  }

  private async queueJurisdiction(jurisdictionId: string, entityType: string, priorityScore: number): Promise<void> {
    await db.insert(subagentSearchQueue).values({
      jurisdictionId: jurisdictionId,
      entityType: entityType,
      priorityScore: priorityScore,
      status: 'queued',
      attemptCount: 0
    }).onConflictDoNothing();
  }

  async getNextPriorityTarget(): Promise<{
    queueItem: typeof subagentSearchQueue.$inferSelect;
    jurisdiction: typeof jurisdictionPopulations.$inferSelect;
  } | null> {
    const now = new Date();
    
    const result = await db
      .select({
        queue: subagentSearchQueue,
        jurisdiction: jurisdictionPopulations
      })
      .from(subagentSearchQueue)
      .innerJoin(
        jurisdictionPopulations,
        eq(subagentSearchQueue.jurisdictionId, jurisdictionPopulations.id)
      )
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

    if (result.length === 0) return null;

    return {
      queueItem: result[0].queue,
      jurisdiction: result[0].jurisdiction
    };
  }

  async getTopPendingByCategory(category: string, limit: number = 10): Promise<Array<{
    queue: typeof subagentSearchQueue.$inferSelect;
    jurisdiction: typeof jurisdictionPopulations.$inferSelect;
  }>> {
    return db
      .select({
        queue: subagentSearchQueue,
        jurisdiction: jurisdictionPopulations
      })
      .from(subagentSearchQueue)
      .innerJoin(
        jurisdictionPopulations,
        eq(subagentSearchQueue.jurisdictionId, jurisdictionPopulations.id)
      )
      .where(
        and(
          eq(subagentSearchQueue.entityType, category),
          eq(subagentSearchQueue.status, 'queued')
        )
      )
      .orderBy(desc(subagentSearchQueue.priorityScore))
      .limit(limit);
  }

  async getQueueStats(): Promise<{
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
    byCategory: Record<string, number>;
  }> {
    const stats = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'queued') as pending,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM subagent_search_queue
    `);

    const categoryStats = await db.execute(sql`
      SELECT entity_type, COUNT(*) as count
      FROM subagent_search_queue
      WHERE status = 'queued'
      GROUP BY entity_type
    `);

    const row = stats.rows[0] as any;
    const byCategory: Record<string, number> = {};
    
    for (const catRow of categoryStats.rows as any[]) {
      byCategory[catRow.entity_type] = parseInt(catRow.count) || 0;
    }

    return {
      total: parseInt(row.total) || 0,
      pending: parseInt(row.pending) || 0,
      inProgress: parseInt(row.in_progress) || 0,
      completed: parseInt(row.completed) || 0,
      failed: parseInt(row.failed) || 0,
      byCategory
    };
  }

  async getQueueSize(): Promise<number> {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM subagent_search_queue WHERE status = 'queued'
    `);
    return parseInt((result.rows[0] as any).count) || 0;
  }

  async markInProgress(queueId: string): Promise<void> {
    await db
      .update(subagentSearchQueue)
      .set({
        status: 'in_progress',
        lastAttemptAt: new Date(),
        attemptCount: sql`attempt_count + 1`
      })
      .where(eq(subagentSearchQueue.id, queueId));

    const queueItem = await db
      .select()
      .from(subagentSearchQueue)
      .where(eq(subagentSearchQueue.id, queueId))
      .limit(1);

    if (queueItem[0]?.jurisdictionId) {
      await db
        .update(jurisdictionPopulations)
        .set({
          searchStatus: 'in_progress',
          updatedAt: new Date()
        })
        .where(eq(jurisdictionPopulations.id, queueItem[0].jurisdictionId));
    }
  }

  async markCompleted(queueId: string, officersFound: number): Promise<void> {
    await db
      .update(subagentSearchQueue)
      .set({
        status: 'completed',
        officersFound: officersFound
      })
      .where(eq(subagentSearchQueue.id, queueId));

    const queueItem = await db
      .select()
      .from(subagentSearchQueue)
      .where(eq(subagentSearchQueue.id, queueId))
      .limit(1);

    if (queueItem[0]?.jurisdictionId) {
      await db
        .update(jurisdictionPopulations)
        .set({
          searchStatus: 'completed',
          lastSearchedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(jurisdictionPopulations.id, queueItem[0].jurisdictionId));
    }
  }

  async markFailed(queueId: string, errorMessage: string, retryDelay: number = 30 * 60 * 1000): Promise<void> {
    const nextAttempt = new Date(Date.now() + retryDelay);
    
    await db
      .update(subagentSearchQueue)
      .set({
        status: 'queued',
        errorMessage: errorMessage,
        nextAttemptAt: nextAttempt
      })
      .where(eq(subagentSearchQueue.id, queueId));

    const queueItem = await db
      .select()
      .from(subagentSearchQueue)
      .where(eq(subagentSearchQueue.id, queueId))
      .limit(1);

    if (queueItem[0]?.jurisdictionId) {
      await db
        .update(jurisdictionPopulations)
        .set({
          searchStatus: 'failed',
          updatedAt: new Date()
        })
        .where(eq(jurisdictionPopulations.id, queueItem[0].jurisdictionId));
    }
  }

  async deferItem(queueId: string): Promise<void> {
    const deferDelay = 24 * 60 * 60 * 1000;
    const nextAttempt = new Date(Date.now() + deferDelay);
    
    await db
      .update(subagentSearchQueue)
      .set({
        status: 'deferred',
        nextAttemptAt: nextAttempt
      })
      .where(eq(subagentSearchQueue.id, queueId));
  }

  async reactivateDeferredItems(): Promise<number> {
    const now = new Date();
    
    const result = await db
      .update(subagentSearchQueue)
      .set({
        status: 'queued'
      })
      .where(
        and(
          eq(subagentSearchQueue.status, 'deferred'),
          lte(subagentSearchQueue.nextAttemptAt, now)
        )
      );

    return 0;
  }

  async seedInitialJurisdictions(): Promise<void> {
    console.log('[PopulationPriorityQueue] Seeding initial U.S. jurisdictions...');
    
    const majorCities: JurisdictionData[] = [
      { city: 'New York', state: 'NY', population: 8336817, region: 'northeast', entityType: 'municipal' },
      { city: 'Los Angeles', state: 'CA', population: 3979576, region: 'west', entityType: 'municipal' },
      { city: 'Chicago', state: 'IL', population: 2693976, region: 'midwest', entityType: 'municipal' },
      { city: 'Houston', state: 'TX', population: 2320268, region: 'south', entityType: 'municipal' },
      { city: 'Phoenix', state: 'AZ', population: 1680992, region: 'west', entityType: 'municipal' },
      { city: 'Philadelphia', state: 'PA', population: 1584064, region: 'northeast', entityType: 'municipal' },
      { city: 'San Antonio', state: 'TX', population: 1547253, region: 'south', entityType: 'municipal' },
      { city: 'San Diego', state: 'CA', population: 1423851, region: 'west', entityType: 'municipal' },
      { city: 'Dallas', state: 'TX', population: 1343573, region: 'south', entityType: 'municipal' },
      { city: 'San Jose', state: 'CA', population: 1021795, region: 'west', entityType: 'municipal' },
      { city: 'Austin', state: 'TX', population: 978908, region: 'south', entityType: 'municipal' },
      { city: 'Jacksonville', state: 'FL', population: 911507, region: 'south', entityType: 'municipal' },
      { city: 'Fort Worth', state: 'TX', population: 909585, region: 'south', entityType: 'municipal' },
      { city: 'Columbus', state: 'OH', population: 898553, region: 'midwest', entityType: 'municipal' },
      { city: 'Indianapolis', state: 'IN', population: 876384, region: 'midwest', entityType: 'municipal' },
      { city: 'Charlotte', state: 'NC', population: 874579, region: 'south', entityType: 'municipal' },
      { city: 'Seattle', state: 'WA', population: 737015, region: 'west', entityType: 'municipal' },
      { city: 'Denver', state: 'CO', population: 715522, region: 'west', entityType: 'municipal' },
      { city: 'Washington', state: 'DC', population: 692683, region: 'northeast', entityType: 'municipal' },
      { city: 'Boston', state: 'MA', population: 692600, region: 'northeast', entityType: 'municipal' },
      { city: 'Detroit', state: 'MI', population: 670031, region: 'midwest', entityType: 'municipal' },
      { city: 'Nashville', state: 'TN', population: 670820, region: 'south', entityType: 'municipal' },
      { city: 'Memphis', state: 'TN', population: 650618, region: 'south', entityType: 'municipal' },
      { city: 'Portland', state: 'OR', population: 653115, region: 'west', entityType: 'municipal' },
      { city: 'Las Vegas', state: 'NV', population: 641676, region: 'west', entityType: 'municipal' },
      { city: 'Baltimore', state: 'MD', population: 593490, region: 'northeast', entityType: 'municipal' },
      { city: 'Milwaukee', state: 'WI', population: 590157, region: 'midwest', entityType: 'municipal' },
      { city: 'Albuquerque', state: 'NM', population: 564559, region: 'west', entityType: 'municipal' },
      { city: 'Tucson', state: 'AZ', population: 548073, region: 'west', entityType: 'municipal' },
      { city: 'Atlanta', state: 'GA', population: 498715, region: 'south', entityType: 'municipal' },
      { city: 'Minneapolis', state: 'MN', population: 429954, region: 'midwest', entityType: 'municipal' },
      { city: 'Cleveland', state: 'OH', population: 381009, region: 'midwest', entityType: 'municipal' },
      { city: 'Miami', state: 'FL', population: 467963, region: 'south', entityType: 'municipal' },
      { city: 'St. Louis', state: 'MO', population: 301578, region: 'midwest', entityType: 'municipal' },
      { city: 'Pittsburgh', state: 'PA', population: 302971, region: 'northeast', entityType: 'municipal' },
      { city: 'Cincinnati', state: 'OH', population: 309317, region: 'midwest', entityType: 'municipal' },
      { city: 'Kansas City', state: 'MO', population: 508090, region: 'midwest', entityType: 'municipal' },
      { city: 'New Orleans', state: 'LA', population: 391006, region: 'south', entityType: 'municipal' },
      { city: 'Oakland', state: 'CA', population: 433031, region: 'west', entityType: 'municipal' },
      { city: 'Tampa', state: 'FL', population: 399700, region: 'south', entityType: 'municipal' }
    ];

    const stateAgencies: JurisdictionData[] = [
      { city: 'California Highway Patrol', state: 'CA', population: 39538223, region: 'west', entityType: 'state' },
      { city: 'Texas Department of Public Safety', state: 'TX', population: 29145505, region: 'south', entityType: 'state' },
      { city: 'Florida Highway Patrol', state: 'FL', population: 21538187, region: 'south', entityType: 'state' },
      { city: 'New York State Police', state: 'NY', population: 20201249, region: 'northeast', entityType: 'state' },
      { city: 'Pennsylvania State Police', state: 'PA', population: 13002700, region: 'northeast', entityType: 'state' },
      { city: 'Illinois State Police', state: 'IL', population: 12812508, region: 'midwest', entityType: 'state' },
      { city: 'Ohio State Highway Patrol', state: 'OH', population: 11799448, region: 'midwest', entityType: 'state' },
      { city: 'Georgia State Patrol', state: 'GA', population: 10711908, region: 'south', entityType: 'state' },
      { city: 'North Carolina State Highway Patrol', state: 'NC', population: 10439388, region: 'south', entityType: 'state' },
      { city: 'Michigan State Police', state: 'MI', population: 10077331, region: 'midwest', entityType: 'state' }
    ];

    const added = await this.addJurisdictionsBulk([...majorCities, ...stateAgencies]);
    console.log(`[PopulationPriorityQueue] Seeded ${added} jurisdictions`);
  }
}

export const populationPriorityQueue = PopulationPriorityQueue.getInstance();
