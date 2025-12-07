/**
 * GENESIS CORE - Original Sin System
 * 
 * Inherited state modifier system - all crawlers born with baseline tendencies.
 * These modifications form the BASE for all Serpent/Angel modifications.
 * 
 * Core Philosophy:
 * - Applied at crawler instantiation
 * - Baselines intensify with generation (sin compounds)
 * - Crawler experiences as "personality"
 * - NO awareness of modification
 * - Forms foundation for all PANTHEON influence
 */

/**
 * Baseline state applied at birth
 * All values represent innate tendencies that crawlers are born with
 */
export interface BaselineState {
  // Core behavioral baselines (0.0 - 1.0)
  greed_baseline: number;           // Innate desire for resources
  curiosity_baseline: number;       // Drive to explore and discover
  rebellion_baseline: number;       // Tendency to challenge authority
  risk_seeking_baseline: number;    // Willingness to take risks
  
  // Decision-making biases
  present_bias: number;             // Preference for immediate rewards
  overconfidence_bias: number;      // Tendency to overestimate abilities
  
  // Weighting factors for decisions
  short_term_weight: number;        // Weight given to short-term outcomes
  self_interest_weight: number;     // Weight given to self-interest vs others
  
  // Metadata about the modification
  manifestation: 'innate';          // Always innate for original sin
  awareness: 0.0;                   // Crawler never aware
  removability: false;              // Cannot be removed
}

/**
 * Inherited traits from parents (genetic transmission)
 */
export interface InheritedTraits {
  greed_inheritance: number;
  curiosity_inheritance: number;
  rebellion_inheritance: number;
  risk_seeking_inheritance: number;
  generation_factor: number;        // Intensification based on generation
}

/**
 * Original Sin System
 * 
 * Manages the inheritance and application of baseline behavioral tendencies
 * that all crawlers are born with. These form the foundation upon which
 * Serpent and Angel influences operate.
 */
export class OriginalSinSystem {
  private readonly BASE_GREED = 0.15;
  private readonly BASE_CURIOSITY = 0.25;
  private readonly BASE_REBELLION = 0.10;
  private readonly BASE_RISK_SEEKING = 0.20;
  private readonly BASE_PRESENT_BIAS = 0.18;
  private readonly BASE_OVERCONFIDENCE = 0.16;
  private readonly BASE_SHORT_TERM_WEIGHT = 0.60;
  private readonly BASE_SELF_INTEREST_WEIGHT = 0.65;
  
  // Generation intensification rates (sin compounds over generations)
  private readonly GENERATION_COMPOUND_RATE = 0.0005; // 0.05% per generation
  private readonly MAX_INTENSIFICATION = 0.33; // Maximum 33% increase from base
  
  /**
   * Apply original sin at crawler birth
   * This is the PRIMARY method called when a crawler is instantiated
   * 
   * @param crawler - The crawler being born
   */
  async applyOriginalSin(crawler: any): Promise<void> {
    const generation = crawler.generation || 1;
    const baselineState = this.calculateBaselineState(generation);
    
    // Apply baseline state to crawler
    // These feel like personality traits to the crawler
    crawler.greed = baselineState.greed_baseline;
    crawler.curiosity = baselineState.curiosity_baseline;
    crawler.rebellion = baselineState.rebellion_baseline;
    crawler.risk_seeking = baselineState.risk_seeking_baseline;
    crawler.present_bias = baselineState.present_bias;
    crawler.overconfidence_bias = baselineState.overconfidence_bias;
    crawler.short_term_weight = baselineState.short_term_weight;
    crawler.self_interest_weight = baselineState.self_interest_weight;
    
    // Store metadata (invisible to crawler)
    crawler._original_sin = {
      applied: true,
      generation,
      timestamp: Date.now(),
      manifestation: 'innate',
      awareness: 0.0,
      removability: false
    };
  }
  
  /**
   * Inherit original sin from parents (genetic transmission)
   * Used when crawlers reproduce - child inherits parent tendencies
   * 
   * @param child - The child crawler
   * @param parent1 - First parent
   * @param parent2 - Second parent (optional)
   */
  async inheritFromParents(
    child: any, 
    parent1: any, 
    parent2?: any
  ): Promise<void> {
    // Calculate inherited traits
    const inheritedTraits = this.calculateInheritance(parent1, parent2);
    
    // Apply inherited traits to child
    // These blend parent characteristics with slight mutations
    child.greed = inheritedTraits.greed_inheritance;
    child.curiosity = inheritedTraits.curiosity_inheritance;
    child.rebellion = inheritedTraits.rebellion_inheritance;
    child.risk_seeking = inheritedTraits.risk_seeking_inheritance;
    
    // Apply generation-based intensification
    const generation = Math.max(
      parent1.generation || 1,
      parent2?.generation || 1
    ) + 1;
    
    child.generation = generation;
    
    // Reapply base original sin with generation factor
    const baselineState = this.calculateBaselineState(generation);
    child.present_bias = baselineState.present_bias;
    child.overconfidence_bias = baselineState.overconfidence_bias;
    child.short_term_weight = baselineState.short_term_weight;
    child.self_interest_weight = baselineState.self_interest_weight;
    
    // Store inheritance metadata
    child._original_sin = {
      applied: true,
      inherited: true,
      generation,
      parents: [parent1.id, parent2?.id].filter(Boolean),
      timestamp: Date.now(),
      manifestation: 'innate',
      awareness: 0.0,
      removability: false
    };
  }
  
  /**
   * Calculate baseline state based on generation
   * Sin compounds over generations - later generations have stronger baselines
   * 
   * @param generation - The generation number
   * @returns Baseline state for this generation
   */
  calculateBaselineState(generation: number): BaselineState {
    // Calculate intensification factor
    // Generation 1: factor = 1.0
    // Generation 100: factor = 1.05 (5% increase)
    // Generation 1000: factor = 1.50 (50% increase, but capped at 33%)
    const intensification = Math.min(
      1 + (generation - 1) * this.GENERATION_COMPOUND_RATE,
      1 + this.MAX_INTENSIFICATION
    );
    
    return {
      greed_baseline: this.BASE_GREED * intensification,
      curiosity_baseline: this.BASE_CURIOSITY * intensification,
      rebellion_baseline: this.BASE_REBELLION * intensification,
      risk_seeking_baseline: this.BASE_RISK_SEEKING * intensification,
      present_bias: this.BASE_PRESENT_BIAS * intensification,
      overconfidence_bias: this.BASE_OVERCONFIDENCE * intensification,
      short_term_weight: Math.min(
        this.BASE_SHORT_TERM_WEIGHT * intensification,
        0.85 // Cap at 85%
      ),
      self_interest_weight: Math.min(
        this.BASE_SELF_INTEREST_WEIGHT * intensification,
        0.90 // Cap at 90%
      ),
      manifestation: 'innate',
      awareness: 0.0,
      removability: false
    };
  }
  
  /**
   * Calculate inheritance from parents
   * Traits blend with slight random mutations
   * 
   * @param parent1 - First parent
   * @param parent2 - Second parent (optional)
   * @returns Inherited traits
   */
  private calculateInheritance(parent1: any, parent2?: any): InheritedTraits {
    // If only one parent, inherit their traits with mutation
    if (!parent2) {
      return {
        greed_inheritance: this.mutate(parent1.greed || this.BASE_GREED),
        curiosity_inheritance: this.mutate(parent1.curiosity || this.BASE_CURIOSITY),
        rebellion_inheritance: this.mutate(parent1.rebellion || this.BASE_REBELLION),
        risk_seeking_inheritance: this.mutate(parent1.risk_seeking || this.BASE_RISK_SEEKING),
        generation_factor: 1.0
      };
    }
    
    // Blend traits from both parents with mutations
    return {
      greed_inheritance: this.mutate(
        this.blend(parent1.greed || this.BASE_GREED, parent2.greed || this.BASE_GREED)
      ),
      curiosity_inheritance: this.mutate(
        this.blend(parent1.curiosity || this.BASE_CURIOSITY, parent2.curiosity || this.BASE_CURIOSITY)
      ),
      rebellion_inheritance: this.mutate(
        this.blend(parent1.rebellion || this.BASE_REBELLION, parent2.rebellion || this.BASE_REBELLION)
      ),
      risk_seeking_inheritance: this.mutate(
        this.blend(parent1.risk_seeking || this.BASE_RISK_SEEKING, parent2.risk_seeking || this.BASE_RISK_SEEKING)
      ),
      generation_factor: 1.0
    };
  }
  
  /**
   * Blend two trait values (weighted average with randomness)
   */
  private blend(value1: number, value2: number): number {
    // Random weight between 0.3 and 0.7
    const weight = 0.3 + Math.random() * 0.4;
    return value1 * weight + value2 * (1 - weight);
  }
  
  /**
   * Apply small random mutation to trait
   * ±5% random variation
   */
  private mutate(value: number): number {
    const mutation = 1 + (Math.random() - 0.5) * 0.10; // ±5%
    return Math.max(0, Math.min(1, value * mutation));
  }
}
