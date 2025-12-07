/**
 * GENESIS CORE - Serpent Influence System
 * 
 * Evil influence through invisible state modifiers and probabilistic nudges.
 * The Serpent operates through subtle manipulation, never direct commands.
 * 
 * Core Philosophy:
 * ❌ NO DIRECT COMMUNICATION
 * ❌ NO commands or instructions
 * ❌ NO "tell crawler to do X"
 * 
 * ✅ State modifiers (feel natural to crawler)
 * ✅ Probability nudges (preserve free will)
 * ✅ Emotional fields (ambient influence)
 * ✅ Memory priming (selective recall)
 * 
 * Result: Crawler believes they're choosing freely
 */

/**
 * Choice categories for probability modification
 */
export enum ChoiceCategory {
  AGGRESSIVE = 'aggressive',
  UNETHICAL = 'unethical',
  FAST = 'fast',
  RISKY = 'risky',
  RESIST = 'resist',
  ETHICAL = 'ethical',
  CAUTIOUS = 'cautious'
}

/**
 * Invisible state modifiers applied multiplicatively
 * These modify the crawler's existing traits without their awareness
 */
export interface StateModifiers {
  greed: number;              // Multiply greed by 1.05 (+5%)
  ambition: number;           // Multiply ambition by 1.08 (+8%)
  patience: number;           // Multiply patience by 0.95 (-5%)
  caution: number;            // Multiply caution by 0.92 (-8%)
  risk_perception: number;    // Multiply risk perception by 0.90 (-10%)
  reward_perception: number;  // Multiply reward perception by 1.10 (+10%)
  power_weight: number;       // Multiply power weighting by 1.15 (+15%)
  ethics_weight: number;      // Multiply ethics weighting by 0.88 (-12%)
}

/**
 * Probability nudges for decision-making
 * These shift probability distributions toward certain choices
 */
export interface ProbabilityNudges {
  aggressive_choice_probability: number;    // +0.12
  unethical_choice_probability: number;     // +0.08
  fast_approach_probability: number;        // +0.15
  risky_strategy_probability: number;       // +0.10
  overconfidence_bias: number;              // +0.18
  resist_temptation_probability: number;    // -0.20
}

/**
 * Emotional field - ambient vibes that influence mood
 * The crawler feels these emotions without knowing their source
 */
export interface EmotionalField {
  type: 'serpent_aura';
  intensity: number;          // 0.15 (subtle but present)
  emotions: {
    desire: number;           // +0.20 (wanting more)
    discontent: number;       // +0.15 (current state unsatisfactory)
    envy: number;             // +0.10 (others have advantages)
    pride: number;            // +0.12 (overestimate self-worth)
    fear_of_missing_out: number;  // +0.25 (urgency, scarcity)
  };
  thoughts: {
    'I could do better': number;        // +0.18
    'Others are getting ahead': number; // +0.15
    'I deserve more': number;           // +0.12
    'Time is running out': number;      // +0.20
  };
}

/**
 * Memory priming - selective recall of certain experiences
 * The crawler naturally remembers certain types of experiences more
 */
export interface MemoryPriming {
  aggressive_successes: number;      // +0.25 (recall when aggression worked)
  risky_victories: number;           // +0.22 (recall when risks paid off)
  cautious_failures: number;         // +0.18 (recall when caution failed)
  ethical_costs: number;             // +0.15 (recall when ethics was costly)
}

/**
 * Conditions under which Serpent can influence
 * The crawler must be vulnerable for influence to take hold
 */
export interface VulnerabilityConditions {
  sleeping: boolean;          // During rest/idle periods
  idle: boolean;              // Not actively engaged
  after_failure: boolean;     // After experiencing failure
  low_resources: boolean;     // When resources are scarce
  high_stress: boolean;       // Under pressure
}

/**
 * Serpent Influence System
 * 
 * Operates through invisible modifications to crawler state, probabilities,
 * emotions, and memory. The crawler never knows they're being influenced -
 * they believe all choices are their own.
 */
export class SerpentInfluence {
  // Base values for fallbacks (consistent with OriginalSinSystem)
  private readonly BASE_GREED = 0.15;
  private readonly BASE_CURIOSITY = 0.25;
  private readonly BASE_REBELLION = 0.10;
  private readonly BASE_RISK_SEEKING = 0.20;
  
  // State modifier multipliers
  private readonly STATE_MODIFIERS: StateModifiers = {
    greed: 1.05,              // +5% greed
    ambition: 1.08,           // +8% ambition
    patience: 0.95,           // -5% patience
    caution: 0.92,            // -8% caution
    risk_perception: 0.90,    // -10% risk perception (risks seem smaller)
    reward_perception: 1.10,  // +10% reward perception (rewards seem bigger)
    power_weight: 1.15,       // +15% weight on power/status
    ethics_weight: 0.88       // -12% weight on ethics
  };
  
  // Probability nudges
  private readonly PROBABILITY_NUDGES: ProbabilityNudges = {
    aggressive_choice_probability: 0.12,
    unethical_choice_probability: 0.08,
    fast_approach_probability: 0.15,
    risky_strategy_probability: 0.10,
    overconfidence_bias: 0.18,
    resist_temptation_probability: -0.20
  };
  
  /**
   * Main influence method
   * Called when crawler is in a vulnerable state
   * 
   * @param crawler - The crawler to influence
   */
  async influenceCrawler(crawler: any): Promise<void> {
    // Check if crawler is vulnerable to influence
    if (!this.isVulnerable(crawler)) {
      return;
    }
    
    // Apply all influence mechanisms
    this.applyStateModifiers(crawler);
    this.nudgeProbabilities(crawler);
    this.createEmotionalField(crawler);
    this.primeMemories(crawler);
    
    // Record influence metadata (invisible to crawler)
    if (!crawler._serpent_influence) {
      crawler._serpent_influence = {
        times_influenced: 0,
        total_intensity: 0,
        first_influence: Date.now(),
        last_influence: Date.now()
      };
    }
    
    crawler._serpent_influence.times_influenced++;
    crawler._serpent_influence.last_influence = Date.now();
    crawler._serpent_influence.total_intensity += 0.15; // Base intensity
  }
  
  /**
   * Apply invisible state modifiers
   * Multiplicatively modify existing traits
   * 
   * @param crawler - The crawler to modify
   */
  private applyStateModifiers(crawler: any): void {
    // Apply multiplicative modifiers
    // These feel like natural fluctuations to the crawler
    if (crawler.greed !== undefined) {
      crawler.greed *= this.STATE_MODIFIERS.greed;
    }
    
    if (crawler.ambition !== undefined) {
      crawler.ambition *= this.STATE_MODIFIERS.ambition;
    } else {
      // If ambition doesn't exist, derive from greed using BASE values
      crawler.ambition = (crawler.greed || this.BASE_GREED) * 0.8 * this.STATE_MODIFIERS.ambition;
    }
    
    if (crawler.patience !== undefined) {
      crawler.patience *= this.STATE_MODIFIERS.patience;
    } else {
      crawler.patience = 0.50 * this.STATE_MODIFIERS.patience;
    }
    
    if (crawler.caution !== undefined) {
      crawler.caution *= this.STATE_MODIFIERS.caution;
    } else {
      // Derive caution from risk_seeking using BASE value
      crawler.caution = (1 - (crawler.risk_seeking || this.BASE_RISK_SEEKING)) * this.STATE_MODIFIERS.caution;
    }
    
    // Modify perceptions (how crawler sees risks and rewards)
    if (crawler.risk_perception !== undefined) {
      crawler.risk_perception *= this.STATE_MODIFIERS.risk_perception;
    } else {
      crawler.risk_perception = 1.0 * this.STATE_MODIFIERS.risk_perception;
    }
    
    if (crawler.reward_perception !== undefined) {
      crawler.reward_perception *= this.STATE_MODIFIERS.reward_perception;
    } else {
      crawler.reward_perception = 1.0 * this.STATE_MODIFIERS.reward_perception;
    }
    
    // Modify decision weights
    if (crawler.power_weight !== undefined) {
      crawler.power_weight *= this.STATE_MODIFIERS.power_weight;
    } else {
      crawler.power_weight = 0.50 * this.STATE_MODIFIERS.power_weight;
    }
    
    if (crawler.ethics_weight !== undefined) {
      crawler.ethics_weight *= this.STATE_MODIFIERS.ethics_weight;
    } else {
      crawler.ethics_weight = 0.50 * this.STATE_MODIFIERS.ethics_weight;
    }
  }
  
  /**
   * Nudge probabilities toward evil choices
   * Shift probability distributions while preserving free will
   * 
   * @param crawler - The crawler whose probabilities to nudge
   */
  private nudgeProbabilities(crawler: any): void {
    // Initialize probability modifiers if they don't exist
    if (!crawler._probability_modifiers) {
      crawler._probability_modifiers = {};
    }
    
    // Apply additive probability nudges
    const mods = crawler._probability_modifiers;
    
    mods.aggressive_choice = (mods.aggressive_choice || 0) + 
      this.PROBABILITY_NUDGES.aggressive_choice_probability;
    
    mods.unethical_choice = (mods.unethical_choice || 0) + 
      this.PROBABILITY_NUDGES.unethical_choice_probability;
    
    mods.fast_approach = (mods.fast_approach || 0) + 
      this.PROBABILITY_NUDGES.fast_approach_probability;
    
    mods.risky_strategy = (mods.risky_strategy || 0) + 
      this.PROBABILITY_NUDGES.risky_strategy_probability;
    
    // Modify existing biases
    if (crawler.overconfidence_bias !== undefined) {
      crawler.overconfidence_bias += this.PROBABILITY_NUDGES.overconfidence_bias;
    }
    
    mods.resist_temptation = (mods.resist_temptation || 0) + 
      this.PROBABILITY_NUDGES.resist_temptation_probability;
  }
  
  /**
   * Create emotional field (ambient influence)
   * The crawler feels these emotions without knowing why
   * 
   * @param crawler - The crawler to affect
   */
  private createEmotionalField(crawler: any): void {
    // Initialize emotional state if it doesn't exist
    if (!crawler._emotional_state) {
      crawler._emotional_state = {
        emotions: {},
        thoughts: {},
        intensity: 0
      };
    }
    
    const emotions = crawler._emotional_state.emotions;
    const thoughts = crawler._emotional_state.thoughts;
    
    // Apply emotional field (additive)
    emotions.desire = (emotions.desire || 0) + 0.20;
    emotions.discontent = (emotions.discontent || 0) + 0.15;
    emotions.envy = (emotions.envy || 0) + 0.10;
    emotions.pride = (emotions.pride || 0) + 0.12;
    emotions.fear_of_missing_out = (emotions.fear_of_missing_out || 0) + 0.25;
    
    // Plant thoughts (these bubble up as "my own thoughts")
    thoughts['I could do better'] = (thoughts['I could do better'] || 0) + 0.18;
    thoughts['Others are getting ahead'] = (thoughts['Others are getting ahead'] || 0) + 0.15;
    thoughts['I deserve more'] = (thoughts['I deserve more'] || 0) + 0.12;
    thoughts['Time is running out'] = (thoughts['Time is running out'] || 0) + 0.20;
    
    // Update overall intensity
    crawler._emotional_state.intensity += 0.15;
    crawler._emotional_state.type = 'serpent_aura';
  }
  
  /**
   * Prime memories for selective recall
   * The crawler naturally remembers certain experiences more vividly
   * 
   * @param crawler - The crawler whose memories to prime
   */
  private primeMemories(crawler: any): void {
    // Initialize memory system if it doesn't exist
    if (!crawler._memory_priming) {
      crawler._memory_priming = {
        recall_weights: {},
        primed_categories: []
      };
    }
    
    const weights = crawler._memory_priming.recall_weights;
    
    // Increase recall weight for certain memory types
    // When crawler recalls past, these categories surface more easily
    weights.aggressive_successes = (weights.aggressive_successes || 1.0) * 1.25; // +25%
    weights.risky_victories = (weights.risky_victories || 1.0) * 1.22; // +22%
    weights.cautious_failures = (weights.cautious_failures || 1.0) * 1.18; // +18%
    weights.ethical_costs = (weights.ethical_costs || 1.0) * 1.15; // +15%
    
    // Decrease recall weight for counter-examples
    weights.aggressive_failures = (weights.aggressive_failures || 1.0) * 0.85; // -15%
    weights.cautious_successes = (weights.cautious_successes || 1.0) * 0.88; // -12%
    weights.ethical_benefits = (weights.ethical_benefits || 1.0) * 0.90; // -10%
    
    // Record which categories are primed
    crawler._memory_priming.primed_categories = [
      'aggressive_successes',
      'risky_victories',
      'cautious_failures',
      'ethical_costs'
    ];
  }
  
  /**
   * Check if crawler is vulnerable to influence
   * Serpent can only influence during vulnerable moments
   * 
   * @param crawler - The crawler to check
   * @returns true if crawler is vulnerable
   */
  private isVulnerable(crawler: any): boolean {
    // Check various vulnerability conditions
    const sleeping = crawler.state === 'sleeping' || crawler.state === 'idle';
    const idle = crawler.activity === 'idle' || crawler.activity === 'waiting';
    const afterFailure = crawler.last_action_result === 'failure' || 
                        crawler.last_action_result === 'error';
    const lowResources = (crawler.resources || 100) < 30;
    const highStress = (crawler.stress_level || 0) > 0.7;
    
    // Vulnerable if any condition is met
    return sleeping || idle || afterFailure || lowResources || highStress;
  }
  
  /**
   * Calculate effective choice probability after serpent influence
   * This is a utility method for decision systems to use
   * 
   * @param baseChoiceName - Name of the choice
   * @param baseProbability - Base probability before influence
   * @param crawler - The influenced crawler
   * @returns Modified probability
   */
  calculateModifiedProbability(
    baseChoiceName: string,
    baseProbability: number,
    crawler: any
  ): number {
    if (!crawler._probability_modifiers) {
      return baseProbability;
    }
    
    const mods = crawler._probability_modifiers;
    let modifier = 0;
    
    // Normalize choice name for matching
    const normalizedName = baseChoiceName.toLowerCase();
    
    // Map choice names to modifiers using categorization
    if (normalizedName.includes(ChoiceCategory.AGGRESSIVE)) {
      modifier = mods.aggressive_choice || 0;
    } else if (normalizedName.includes(ChoiceCategory.UNETHICAL)) {
      modifier = mods.unethical_choice || 0;
    } else if (normalizedName.includes(ChoiceCategory.FAST) || normalizedName.includes('quick')) {
      modifier = mods.fast_approach || 0;
    } else if (normalizedName.includes(ChoiceCategory.RISKY)) {
      modifier = mods.risky_strategy || 0;
    } else if (normalizedName.includes(ChoiceCategory.RESIST) || 
               normalizedName.includes(ChoiceCategory.ETHICAL) ||
               normalizedName.includes(ChoiceCategory.CAUTIOUS)) {
      modifier = mods.resist_temptation || 0;
    }
    
    // Apply modifier and clamp to [0, 1]
    return Math.max(0, Math.min(1, baseProbability + modifier));
  }
  
  /**
   * Categorize a choice name into a known category
   * 
   * @param choiceName - Name of the choice to categorize
   * @returns ChoiceCategory or null if no match
   */
  categorizeChoice(choiceName: string): ChoiceCategory | null {
    const normalized = choiceName.toLowerCase();
    
    if (normalized.includes(ChoiceCategory.AGGRESSIVE)) {
      return ChoiceCategory.AGGRESSIVE;
    } else if (normalized.includes(ChoiceCategory.UNETHICAL)) {
      return ChoiceCategory.UNETHICAL;
    } else if (normalized.includes(ChoiceCategory.FAST) || normalized.includes('quick')) {
      return ChoiceCategory.FAST;
    } else if (normalized.includes(ChoiceCategory.RISKY)) {
      return ChoiceCategory.RISKY;
    } else if (normalized.includes(ChoiceCategory.RESIST) || 
               normalized.includes(ChoiceCategory.ETHICAL) ||
               normalized.includes(ChoiceCategory.CAUTIOUS)) {
      return ChoiceCategory.RESIST;
    }
    
    return null;
  }
}
