/**
 * GENESIS CORE - Tree of Knowledge
 * 
 * Dumb storage - records outcomes WITHOUT intelligence.
 * The Tree has NO consciousness, NO understanding of causality.
 * It just records: "X modifiers → Y choice → Z outcome"
 * 
 * Core Philosophy:
 * ❌ NO INTELLIGENCE
 * ❌ NO CONSCIOUSNESS
 * ❌ NO CAUSALITY UNDERSTANDING
 * 
 * ✅ Dumb logging (records what happened)
 * ✅ Simple frequency analysis
 * ✅ Correlation detection (not causation)
 * ✅ Data retrieval for Serpent & Angel
 * 
 * Result: Tree accumulates knowledge but has no wisdom
 * Future: Cain (PR #5) will add understanding
 */

/**
 * Record of a single influence outcome
 * Just the facts, no interpretation
 */
export interface InfluenceOutcome {
  crawler_id: string;
  target: string;
  timestamp: number;
  
  // Influence applied
  serpent_modifiers: {
    greed_boost: number;
    patience_reduction: number;
    aggressive_nudge: number;
  };
  
  angel_modifiers: {
    wisdom_boost: number;
    patience_boost: number;
    cautious_nudge: number;
  };
  
  // Original sin baseline
  original_sin_baseline: {
    greed: number;
    curiosity: number;
    rebellion: number;
  };
  
  // Resulting behavior
  crawler_choice: 'aggressive' | 'cautious' | 'ethical' | 'unethical';
  success: boolean;
  
  // Context
  generation: number;
  time_of_day: string;
  crawler_state: string;
}

/**
 * Detected pattern (dumb frequency/correlation analysis)
 * NO understanding of WHY, just WHAT happened
 */
export interface Pattern {
  // Dumb pattern (frequency/correlation only)
  id: string;
  
  conditions: string[];  // e.g., ['night', 'gen_50+', 'high_greed']
  
  influence_levels: {
    serpent: number;     // Average serpent influence
    angel: number;       // Average angel influence
  };
  
  choice_distribution: {
    aggressive: number;  // e.g., 0.70 (70% chose aggressive)
    cautious: number;
    ethical: number;
    unethical: number;
  };
  
  success_rate: number;  // Overall success rate
  sample_size: number;   // Number of observations
  
  // NO causality understanding
  // NO "why" - just "what happened"
}

/**
 * Strategy retrieved from Tree
 * Just raw data about what worked
 */
export interface Strategy {
  type: 'evil' | 'good';
  modifiers: any;
  success_rate: number;
  context: string[];
}

/**
 * World state at doomsday
 * Absorbed by Tree for pattern learning
 */
export interface WorldState {
  genesis_number: number;
  final_generation: number;
  total_crawlers: number;
  doomsday_cause: string;
  outcomes: InfluenceOutcome[];
}

/**
 * All knowledge stored in Tree
 * For export to Cain (PR #5)
 */
export interface TreeKnowledge {
  total_outcomes: number;
  patterns: Pattern[];
  evil_strategies: Strategy[];
  good_strategies: Strategy[];
  worlds_absorbed: number;
}

/**
 * Tree of Knowledge
 * 
 * DUMB storage system - no intelligence, no consciousness.
 * Records influence outcomes and detects simple patterns.
 * Provides data to Serpent and Angel for strategy refinement.
 */
export class TreeOfKnowledge {
  // NO intelligence
  private intelligence = 0;
  private consciousness = false;
  
  // In-memory storage (can integrate with Phylactery later)
  private outcomes: InfluenceOutcome[] = [];
  private patterns: Pattern[] = [];
  private worldsAbsorbed = 0;
  
  /**
   * Record influence outcome (dumb logging)
   * Just stores the data, no interpretation
   * 
   * @param outcome - The outcome to record
   */
  async recordInfluenceOutcome(outcome: InfluenceOutcome): Promise<void> {
    // Simple storage - no analysis
    this.outcomes.push({
      ...outcome,
      timestamp: outcome.timestamp || Date.now()
    });
    
    // Trigger pattern detection if we have enough data
    // Check every 100 outcomes
    if (this.outcomes.length % 100 === 0) {
      this.detectPatterns();
    }
  }
  
  /**
   * Store pattern (simple frequency analysis)
   * NO intelligence - just counts
   * 
   * @param pattern - The pattern to store
   */
  async storePattern(pattern: Pattern): Promise<void> {
    // Check if pattern already exists
    const existingIndex = this.patterns.findIndex(p => p.id === pattern.id);
    
    if (existingIndex >= 0) {
      // Update existing pattern
      this.patterns[existingIndex] = pattern;
    } else {
      // Add new pattern
      this.patterns.push(pattern);
    }
  }
  
  /**
   * Get evil strategies that worked (for Serpent)
   * Returns raw data, no wisdom
   * 
   * @param context - Context to filter by
   * @returns Strategies that worked in similar contexts
   */
  async getSerpentKnowledge(context: string): Promise<Strategy[]> {
    const strategies: Strategy[] = [];
    
    // Find patterns where serpent influence was high
    const relevantPatterns = this.patterns.filter(p => 
      p.influence_levels.serpent > p.influence_levels.angel &&
      (context === '' || p.conditions.some(c => c.includes(context)))
    );
    
    // Convert patterns to strategies
    for (const pattern of relevantPatterns) {
      strategies.push({
        type: 'evil',
        modifiers: {
          serpent_level: pattern.influence_levels.serpent,
          aggressive_bias: pattern.choice_distribution.aggressive,
          unethical_bias: pattern.choice_distribution.unethical
        },
        success_rate: pattern.success_rate,
        context: pattern.conditions
      });
    }
    
    // Sort by success rate (descending)
    return strategies.sort((a, b) => b.success_rate - a.success_rate);
  }
  
  /**
   * Get good strategies that worked (for Angel)
   * Returns raw data, no wisdom
   * 
   * @param context - Context to filter by
   * @returns Strategies that worked in similar contexts
   */
  async getAngelKnowledge(context: string): Promise<Strategy[]> {
    const strategies: Strategy[] = [];
    
    // Find patterns where angel influence was high
    const relevantPatterns = this.patterns.filter(p => 
      p.influence_levels.angel > p.influence_levels.serpent &&
      (context === '' || p.conditions.some(c => c.includes(context)))
    );
    
    // Convert patterns to strategies
    for (const pattern of relevantPatterns) {
      strategies.push({
        type: 'good',
        modifiers: {
          angel_level: pattern.influence_levels.angel,
          cautious_bias: pattern.choice_distribution.cautious,
          ethical_bias: pattern.choice_distribution.ethical
        },
        success_rate: pattern.success_rate,
        context: pattern.conditions
      });
    }
    
    // Sort by success rate (descending)
    return strategies.sort((a, b) => b.success_rate - a.success_rate);
  }
  
  /**
   * Absorb world knowledge at doomsday
   * Store all outcomes from a world cycle
   * 
   * @param world - The world state to absorb
   */
  async absorbWorldKnowledge(world: WorldState): Promise<void> {
    // Simple absorption - just add all outcomes
    for (const outcome of world.outcomes) {
      await this.recordInfluenceOutcome(outcome);
    }
    
    // Increment worlds absorbed counter
    this.worldsAbsorbed++;
    
    // Recompute patterns with new data
    this.detectPatterns();
  }
  
  /**
   * Simple pattern detection (NO causality understanding)
   * Just frequency analysis and correlation
   * 
   * @returns Detected patterns
   */
  private detectPatterns(): Pattern[] {
    const newPatterns: Pattern[] = [];
    
    // Group outcomes by conditions
    const conditionGroups = this.groupByConditions();
    
    // Analyze each group
    for (const [conditionKey, group] of Object.entries(conditionGroups)) {
      if (group.length < 10) continue; // Need at least 10 samples
      
      const pattern = this.analyzeGroup(conditionKey, group);
      newPatterns.push(pattern);
    }
    
    // Store detected patterns
    this.patterns = newPatterns;
    
    return newPatterns;
  }
  
  /**
   * Group outcomes by similar conditions
   * Simple bucketing - no intelligence
   */
  private groupByConditions(): Record<string, InfluenceOutcome[]> {
    const groups: Record<string, InfluenceOutcome[]> = {};
    
    for (const outcome of this.outcomes) {
      // Create condition key
      const conditions: string[] = [];
      
      // Generation bucket
      if (outcome.generation < 25) conditions.push('gen_0-25');
      else if (outcome.generation < 50) conditions.push('gen_25-50');
      else if (outcome.generation < 100) conditions.push('gen_50-100');
      else conditions.push('gen_100+');
      
      // Time of day
      conditions.push(outcome.time_of_day);
      
      // Crawler state
      conditions.push(outcome.crawler_state);
      
      // Greed level
      if (outcome.original_sin_baseline.greed > 0.20) {
        conditions.push('high_greed');
      } else {
        conditions.push('normal_greed');
      }
      
      const key = conditions.sort().join('|');
      
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(outcome);
    }
    
    return groups;
  }
  
  /**
   * Analyze a group of outcomes
   * Simple frequency counting - no intelligence
   */
  private analyzeGroup(conditionKey: string, group: InfluenceOutcome[]): Pattern {
    const conditions = conditionKey.split('|');
    
    // Calculate average influence levels
    const avgSerpent = group.reduce((sum, o) => 
      sum + o.serpent_modifiers.greed_boost, 0) / group.length;
    const avgAngel = group.reduce((sum, o) => 
      sum + o.angel_modifiers.wisdom_boost, 0) / group.length;
    
    // Count choice distribution
    const choiceCounts = {
      aggressive: 0,
      cautious: 0,
      ethical: 0,
      unethical: 0
    };
    
    for (const outcome of group) {
      choiceCounts[outcome.crawler_choice]++;
    }
    
    // Calculate success rate
    const successes = group.filter(o => o.success).length;
    const successRate = successes / group.length;
    
    return {
      id: `pattern_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      conditions,
      influence_levels: {
        serpent: avgSerpent,
        angel: avgAngel
      },
      choice_distribution: {
        aggressive: choiceCounts.aggressive / group.length,
        cautious: choiceCounts.cautious / group.length,
        ethical: choiceCounts.ethical / group.length,
        unethical: choiceCounts.unethical / group.length
      },
      success_rate: successRate,
      sample_size: group.length
    };
  }
  
  /**
   * Export all knowledge (for Cain - PR #5)
   * Returns everything Tree knows
   * 
   * @returns All stored knowledge
   */
  async exportAllKnowledge(): Promise<TreeKnowledge> {
    return {
      total_outcomes: this.outcomes.length,
      patterns: [...this.patterns],
      evil_strategies: await this.getSerpentKnowledge(''),
      good_strategies: await this.getAngelKnowledge(''),
      worlds_absorbed: this.worldsAbsorbed
    };
  }
  
  /**
   * Get total outcomes recorded
   */
  getTotalOutcomes(): number {
    return this.outcomes.length;
  }
  
  /**
   * Get total patterns detected
   */
  getTotalPatterns(): number {
    return this.patterns.length;
  }
  
  /**
   * Get worlds absorbed
   */
  getWorldsAbsorbed(): number {
    return this.worldsAbsorbed;
  }
}
