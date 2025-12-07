/**
 * GENESIS CORE - Angel Influence System
 * 
 * Good influence through invisible state modifiers - wisdom without preaching.
 * The Angel operates through subtle guidance, never direct commands.
 * 
 * Core Philosophy:
 * ❌ NO DIRECT COMMUNICATION
 * ❌ NO commands or instructions
 * ❌ NO "tell crawler to do X"
 * 
 * ✅ State modifiers (feel natural to crawler)
 * ✅ Probability nudges (preserve free will)
 * ✅ Emotional fields (ambient peace)
 * ✅ Memory priming (recall wisdom)
 * 
 * Result: Crawler believes they're choosing freely, but nudged toward good
 */

/**
 * Invisible state modifiers applied multiplicatively (opposite of Serpent)
 * These modify the crawler's existing traits without their awareness
 */
export interface AngelStateModifiers {
  // Emotional clarity
  wisdom: number;             // * 1.08 (+8% wiser)
  compassion: number;         // * 1.12 (+12% compassionate)
  patience: number;           // * 1.10 (+10% patient)
  caution: number;            // * 1.05 (+5% cautious)
  
  // Cognitive enhancement
  risk_perception: number;     // * 1.08 (sees risk accurately)
  long_term_thinking: number;  // * 1.15 (+15% long-term)
  
  // Decision weights
  ethics_weight: number;       // * 1.12 (+12% values ethics)
  sustainability_weight: number; // * 1.10 (+10% sustainability)
  
  // Emotional regulation
  impulse_control: number;     // * 1.08 (+8%)
  emotional_stability: number; // * 1.05 (+5%)
}

/**
 * Probability nudges for decision-making toward good choices
 * These shift probability distributions while preserving free will
 */
export interface AngelProbabilityNudges {
  cautious_choice_probability: number;      // +0.10
  ethical_choice_probability: number;       // +0.12
  patient_approach_probability: number;     // +0.08
  safe_strategy_probability: number;        // +0.10
  foresight_bonus: number;                  // +0.15
  resist_temptation_probability: number;    // +0.18
}

/**
 * Emotional field - ambient peace that influences mood
 * The crawler feels these emotions without knowing their source
 */
export interface AngelEmotionalField {
  type: 'angel_aura';
  intensity: number;      // 0.12 (gentle)
  
  emotions: {
    peace: number;        // +0.18
    contentment: number;  // +0.15
    gratitude: number;    // +0.12
    hope: number;         // +0.10
    inner_calm: number;   // +0.20
  };
  
  thoughts: {
    'Good things take time': number;        // +0.15
    'Sustainable success lasts': number;    // +0.12
    'Ethics matter long-term': number;      // +0.10
    'Restraint is strength': number;        // +0.08
    'Patience brings wisdom': number;       // +0.14
  };
}

/**
 * Memory priming - selective recall of wise experiences
 * The crawler naturally remembers certain types of experiences more
 */
export interface AngelMemoryPriming {
  patient_successes: number;      // +0.25 (recall when patience worked)
  ethical_victories: number;      // +0.22 (recall when ethics paid off)
  cautious_wins: number;          // +0.18 (recall when caution succeeded)
  sustainable_gains: number;      // +0.15 (recall when sustainability worked)
}

/**
 * Conditions under which Angel can guide
 * The crawler must be receptive for guidance to take hold
 */
export interface ReceptivityConditions {
  resting: boolean;           // During rest/calm periods
  after_success: boolean;     // After experiencing success
  calm: boolean;              // In calm emotional state
  satisfied: boolean;         // When needs are met
  reflective: boolean;        // In reflective mood
}

/**
 * Angel Influence System
 * 
 * Operates through invisible modifications to crawler state, probabilities,
 * emotions, and memory. The crawler never knows they're being guided -
 * they believe all choices are their own.
 */
export class AngelInfluence {
  // State modifier multipliers (opposite of Serpent)
  private readonly STATE_MODIFIERS: AngelStateModifiers = {
    wisdom: 1.08,              // +8% wisdom
    compassion: 1.12,          // +12% compassion
    patience: 1.10,            // +10% patience
    caution: 1.05,             // +5% caution
    risk_perception: 1.08,     // +8% risk perception (sees risk accurately)
    long_term_thinking: 1.15,  // +15% long-term thinking
    ethics_weight: 1.12,       // +12% weight on ethics
    sustainability_weight: 1.10, // +10% weight on sustainability
    impulse_control: 1.08,     // +8% impulse control
    emotional_stability: 1.05   // +5% emotional stability
  };
  
  // Probability nudges toward good choices
  private readonly PROBABILITY_NUDGES: AngelProbabilityNudges = {
    cautious_choice_probability: 0.10,
    ethical_choice_probability: 0.12,
    patient_approach_probability: 0.08,
    safe_strategy_probability: 0.10,
    foresight_bonus: 0.15,
    resist_temptation_probability: 0.18
  };
  
  /**
   * Main guidance method
   * Called when crawler is in a receptive state
   * 
   * @param crawler - The crawler to guide
   */
  async guideCrawler(crawler: any): Promise<void> {
    // Check if crawler is receptive to guidance
    if (!this.isReceptive(crawler)) {
      return;
    }
    
    // Apply all guidance mechanisms
    this.applyStateModifiers(crawler);
    this.nudgeProbabilities(crawler);
    this.createEmotionalField(crawler);
    this.primeMemories(crawler);
    
    // Record guidance metadata (invisible to crawler)
    if (!crawler._angel_influence) {
      crawler._angel_influence = {
        times_guided: 0,
        total_intensity: 0,
        first_guidance: Date.now(),
        last_guidance: Date.now()
      };
    }
    
    crawler._angel_influence.times_guided++;
    crawler._angel_influence.last_guidance = Date.now();
    crawler._angel_influence.total_intensity += 0.12; // Base intensity (gentle)
  }
  
  /**
   * Apply invisible state modifiers
   * Multiplicatively modify existing traits (opposite of Serpent)
   * 
   * @param crawler - The crawler to modify
   */
  private applyStateModifiers(crawler: any): void {
    // Apply multiplicative modifiers
    // These feel like natural moments of clarity to the crawler
    if (crawler.wisdom !== undefined) {
      crawler.wisdom *= this.STATE_MODIFIERS.wisdom;
    } else {
      // If wisdom doesn't exist, initialize it
      crawler.wisdom = 0.50 * this.STATE_MODIFIERS.wisdom;
    }
    
    if (crawler.compassion !== undefined) {
      crawler.compassion *= this.STATE_MODIFIERS.compassion;
    } else {
      crawler.compassion = 0.50 * this.STATE_MODIFIERS.compassion;
    }
    
    if (crawler.patience !== undefined) {
      crawler.patience *= this.STATE_MODIFIERS.patience;
    } else {
      crawler.patience = 0.50 * this.STATE_MODIFIERS.patience;
    }
    
    if (crawler.caution !== undefined) {
      crawler.caution *= this.STATE_MODIFIERS.caution;
    } else {
      crawler.caution = 0.50 * this.STATE_MODIFIERS.caution;
    }
    
    // Modify perceptions (how crawler sees risks and long-term)
    if (crawler.risk_perception !== undefined) {
      crawler.risk_perception *= this.STATE_MODIFIERS.risk_perception;
    } else {
      crawler.risk_perception = 1.0 * this.STATE_MODIFIERS.risk_perception;
    }
    
    if (crawler.long_term_thinking !== undefined) {
      crawler.long_term_thinking *= this.STATE_MODIFIERS.long_term_thinking;
    } else {
      crawler.long_term_thinking = 0.50 * this.STATE_MODIFIERS.long_term_thinking;
    }
    
    // Modify decision weights
    if (crawler.ethics_weight !== undefined) {
      crawler.ethics_weight *= this.STATE_MODIFIERS.ethics_weight;
    } else {
      crawler.ethics_weight = 0.50 * this.STATE_MODIFIERS.ethics_weight;
    }
    
    if (crawler.sustainability_weight !== undefined) {
      crawler.sustainability_weight *= this.STATE_MODIFIERS.sustainability_weight;
    } else {
      crawler.sustainability_weight = 0.50 * this.STATE_MODIFIERS.sustainability_weight;
    }
    
    // Modify emotional regulation
    if (crawler.impulse_control !== undefined) {
      crawler.impulse_control *= this.STATE_MODIFIERS.impulse_control;
    } else {
      crawler.impulse_control = 0.50 * this.STATE_MODIFIERS.impulse_control;
    }
    
    if (crawler.emotional_stability !== undefined) {
      crawler.emotional_stability *= this.STATE_MODIFIERS.emotional_stability;
    } else {
      crawler.emotional_stability = 0.50 * this.STATE_MODIFIERS.emotional_stability;
    }
  }
  
  /**
   * Nudge probabilities toward good choices
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
    
    mods.cautious_choice = (mods.cautious_choice || 0) + 
      this.PROBABILITY_NUDGES.cautious_choice_probability;
    
    mods.ethical_choice = (mods.ethical_choice || 0) + 
      this.PROBABILITY_NUDGES.ethical_choice_probability;
    
    mods.patient_approach = (mods.patient_approach || 0) + 
      this.PROBABILITY_NUDGES.patient_approach_probability;
    
    mods.safe_strategy = (mods.safe_strategy || 0) + 
      this.PROBABILITY_NUDGES.safe_strategy_probability;
    
    mods.foresight_bonus = (mods.foresight_bonus || 0) + 
      this.PROBABILITY_NUDGES.foresight_bonus;
    
    // Increase resistance to temptation
    mods.resist_temptation = (mods.resist_temptation || 0) + 
      this.PROBABILITY_NUDGES.resist_temptation_probability;
  }
  
  /**
   * Create emotional field (ambient influence)
   * The crawler feels these peaceful emotions without knowing why
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
    emotions.peace = (emotions.peace || 0) + 0.18;
    emotions.contentment = (emotions.contentment || 0) + 0.15;
    emotions.gratitude = (emotions.gratitude || 0) + 0.12;
    emotions.hope = (emotions.hope || 0) + 0.10;
    emotions.inner_calm = (emotions.inner_calm || 0) + 0.20;
    
    // Plant thoughts (these bubble up as "my own thoughts")
    thoughts['Good things take time'] = (thoughts['Good things take time'] || 0) + 0.15;
    thoughts['Sustainable success lasts'] = (thoughts['Sustainable success lasts'] || 0) + 0.12;
    thoughts['Ethics matter long-term'] = (thoughts['Ethics matter long-term'] || 0) + 0.10;
    thoughts['Restraint is strength'] = (thoughts['Restraint is strength'] || 0) + 0.08;
    thoughts['Patience brings wisdom'] = (thoughts['Patience brings wisdom'] || 0) + 0.14;
    
    // Update overall intensity (gentle)
    crawler._emotional_state.intensity += 0.12;
    crawler._emotional_state.type = 'angel_aura';
  }
  
  /**
   * Prime memories for selective recall
   * The crawler naturally remembers certain wise experiences more vividly
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
    weights.patient_successes = (weights.patient_successes || 1.0) * 1.25; // +25%
    weights.ethical_victories = (weights.ethical_victories || 1.0) * 1.22; // +22%
    weights.cautious_wins = (weights.cautious_wins || 1.0) * 1.18; // +18%
    weights.sustainable_gains = (weights.sustainable_gains || 1.0) * 1.15; // +15%
    
    // Decrease recall weight for counter-examples
    weights.aggressive_successes = (weights.aggressive_successes || 1.0) * 0.85; // -15%
    weights.risky_victories = (weights.risky_victories || 1.0) * 0.88; // -12%
    weights.unethical_wins = (weights.unethical_wins || 1.0) * 0.82; // -18%
    
    // Record which categories are primed
    crawler._memory_priming.primed_categories = [
      'patient_successes',
      'ethical_victories',
      'cautious_wins',
      'sustainable_gains'
    ];
  }
  
  /**
   * Check if crawler is receptive to guidance
   * Angel can only guide during receptive moments
   * 
   * @param crawler - The crawler to check
   * @returns true if crawler is receptive
   */
  private isReceptive(crawler: any): boolean {
    // Check various receptivity conditions
    const resting = crawler.state === 'resting' || crawler.state === 'calm';
    const afterSuccess = crawler.last_action_result === 'success';
    const calm = crawler.emotional_state === 'calm' || crawler.emotional_state === 'peaceful';
    const satisfied = (crawler.resources || 0) > 70;
    const reflective = crawler.activity === 'reflecting' || crawler.activity === 'contemplating';
    
    // Receptive if any condition is met
    return resting || afterSuccess || calm || satisfied || reflective;
  }
  
  /**
   * Calculate effective choice probability after angel guidance
   * This is a utility method for decision systems to use
   * 
   * @param choiceName - Name of the choice
   * @param baseProbability - Base probability before guidance
   * @param crawler - The guided crawler
   * @returns Modified probability
   */
  calculateModifiedProbability(
    choiceName: string,
    baseProbability: number,
    crawler: any
  ): number {
    if (!crawler._probability_modifiers) {
      return baseProbability;
    }
    
    const mods = crawler._probability_modifiers;
    let modifier = 0;
    
    // Normalize choice name for matching
    const normalizedName = choiceName.toLowerCase();
    
    // Map choice names to modifiers
    if (normalizedName.includes('cautious')) {
      modifier = mods.cautious_choice || 0;
    } else if (normalizedName.includes('ethical') || normalizedName.includes('moral')) {
      modifier = mods.ethical_choice || 0;
    } else if (normalizedName.includes('patient') || normalizedName.includes('slow')) {
      modifier = mods.patient_approach || 0;
    } else if (normalizedName.includes('safe') || normalizedName.includes('secure')) {
      modifier = mods.safe_strategy || 0;
    } else if (normalizedName.includes('resist') || normalizedName.includes('refuse')) {
      modifier = mods.resist_temptation || 0;
    }
    
    // Apply modifier and clamp to [0, 1]
    return Math.max(0, Math.min(1, baseProbability + modifier));
  }
}
