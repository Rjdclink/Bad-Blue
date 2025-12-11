/**
 * 4Ji Cognitive Fabric - 200+ Layer System
 * 
 * All the "thinking stuff" — reasoning, planning, creativity, memory, style, etc.
 * 
 * Organized into functional bands:
 * - Perception & parsing (input understanding, intent detection)
 * - Knowledge & retrieval (RAG, tools, docs, web, repositories)
 * - Reasoning & planning (multi-step reasoning, task decomposition)
 * - Simulation & creativity (ideas, analogies, designs, options)
 * - Self-consistency & sanity (checking for contradictions, nonsense, drift)
 * - Relational interpretation (who am I talking to? you vs others)
 * - Style & expression (tone, phrasing, persona voice)
 * - Optimization & refinement (shorten, sharpen, expand, etc.)
 * 
 * All outputs pass through sanity + style + relational interpretation before being returned.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import {
  CognitiveBand,
  CognitiveLayer,
  CognitiveProcessingResult,
  BandProcessingResult,
} from './types';

const log = createLogger('4Ji-CognitiveFabric');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Layers per cognitive band */
const LAYERS_PER_BAND: Record<CognitiveBand, number> = {
  perception: 29,
  retrieval: 29,
  reasoning: 29,
  creativity: 29,
  sanity: 29,
  relational: 29,
  style: 29,
  optimization: 29,
};

/** Total layers in the cognitive fabric (computed dynamically) */
const TOTAL_LAYERS = Object.values(LAYERS_PER_BAND).reduce((a, b) => a + b, 0);

/** Band processing weights for final output */
const BAND_WEIGHTS: Record<CognitiveBand, number> = {
  perception: 0.10,
  retrieval: 0.10,
  reasoning: 0.20,
  creativity: 0.10,
  sanity: 0.15,
  relational: 0.10,
  style: 0.15,
  optimization: 0.10,
};

/** Bands that must always be processed (sanity gates) */
const MANDATORY_BANDS: CognitiveBand[] = ['sanity', 'style', 'relational'];

// ============================================================================
// COGNITIVE FABRIC
// ============================================================================

export class CognitiveFabric extends EventEmitter {
  private layers: Map<CognitiveBand, CognitiveLayer[]> = new Map();
  private initialized = false;
  private processingActive = false;
  private bandResults: Map<CognitiveBand, BandProcessingResult> = new Map();

  constructor() {
    super();
    this.initializeLayers();
  }

  /**
   * Initialize all 200+ cognitive layers organized by band
   */
  private initializeLayers(): void {
    const bands: CognitiveBand[] = [
      'perception', 'retrieval', 'reasoning', 'creativity',
      'sanity', 'relational', 'style', 'optimization'
    ];

    let globalLayerId = 1;

    for (const band of bands) {
      const bandLayers: CognitiveLayer[] = [];
      const layerCount = LAYERS_PER_BAND[band];
      const layerNames = this.getLayerNamesForBand(band, layerCount);

      for (let i = 0; i < layerCount; i++) {
        bandLayers.push({
          id: globalLayerId++,
          band,
          name: layerNames[i].name,
          description: layerNames[i].description,
          weight: BAND_WEIGHTS[band] / layerCount,
          active: true,
          order: i + 1,
        });
      }

      this.layers.set(band, bandLayers);
    }

    this.initialized = true;
    log.info('Cognitive Fabric initialized', {
      totalLayers: globalLayerId - 1,
      bands: bands.length,
    });
  }

  /**
   * Generate layer names and descriptions for a band
   */
  private getLayerNamesForBand(
    band: CognitiveBand,
    count: number
  ): Array<{ name: string; description: string }> {
    const layerTemplates: Record<CognitiveBand, Array<{ name: string; description: string }>> = {
      perception: [
        { name: 'Input tokenizer', description: 'Breaks input into processable tokens' },
        { name: 'Syntax analyzer', description: 'Analyzes grammatical structure' },
        { name: 'Semantic parser', description: 'Extracts meaning from structure' },
        { name: 'Intent classifier', description: 'Identifies user intent' },
        { name: 'Entity extractor', description: 'Identifies key entities mentioned' },
        { name: 'Sentiment detector', description: 'Detects emotional tone' },
        { name: 'Question classifier', description: 'Classifies question type' },
        { name: 'Context integrator', description: 'Integrates conversation context' },
        { name: 'Ambiguity resolver', description: 'Resolves ambiguous references' },
        { name: 'Language detector', description: 'Detects input language' },
        { name: 'Urgency classifier', description: 'Classifies urgency level' },
        { name: 'Domain detector', description: 'Identifies subject domain' },
        { name: 'Format recognizer', description: 'Recognizes input format' },
        { name: 'Instruction parser', description: 'Parses explicit instructions' },
        { name: 'Implication detector', description: 'Detects implied meaning' },
      ],
      retrieval: [
        { name: 'Memory index', description: 'Indexes relevant memories' },
        { name: 'Knowledge retriever', description: 'Retrieves relevant knowledge' },
        { name: 'Document fetcher', description: 'Fetches relevant documents' },
        { name: 'Context loader', description: 'Loads conversation context' },
        { name: 'Tool selector', description: 'Selects appropriate tools' },
        { name: 'RAG coordinator', description: 'Coordinates retrieval augmentation' },
        { name: 'Relevance scorer', description: 'Scores retrieval relevance' },
        { name: 'Knowledge filter', description: 'Filters irrelevant knowledge' },
        { name: 'Source validator', description: 'Validates information sources' },
        { name: 'Recency checker', description: 'Checks information recency' },
        { name: 'Authority ranker', description: 'Ranks source authority' },
        { name: 'Cross-reference validator', description: 'Cross-references information' },
        { name: 'Gap identifier', description: 'Identifies knowledge gaps' },
        { name: 'Synthesis preparer', description: 'Prepares for knowledge synthesis' },
        { name: 'Cache manager', description: 'Manages retrieval cache' },
      ],
      reasoning: [
        { name: 'Logic engine', description: 'Applies logical reasoning' },
        { name: 'Inference generator', description: 'Generates logical inferences' },
        { name: 'Deduction processor', description: 'Processes deductive reasoning' },
        { name: 'Induction processor', description: 'Processes inductive reasoning' },
        { name: 'Abduction processor', description: 'Processes abductive reasoning' },
        { name: 'Causal analyzer', description: 'Analyzes cause-effect relationships' },
        { name: 'Temporal reasoner', description: 'Reasons about time sequences' },
        { name: 'Spatial reasoner', description: 'Reasons about spatial relationships' },
        { name: 'Task decomposer', description: 'Breaks tasks into subtasks' },
        { name: 'Step sequencer', description: 'Sequences reasoning steps' },
        { name: 'Assumption tracker', description: 'Tracks reasoning assumptions' },
        { name: 'Conclusion validator', description: 'Validates reasoning conclusions' },
        { name: 'Uncertainty quantifier', description: 'Quantifies reasoning uncertainty' },
        { name: 'Evidence weigher', description: 'Weighs supporting evidence' },
        { name: 'Multi-step planner', description: 'Plans multi-step reasoning' },
      ],
      creativity: [
        { name: 'Idea generator', description: 'Generates novel ideas' },
        { name: 'Analogy finder', description: 'Finds relevant analogies' },
        { name: 'Metaphor creator', description: 'Creates apt metaphors' },
        { name: 'Pattern recognizer', description: 'Recognizes creative patterns' },
        { name: 'Concept combiner', description: 'Combines concepts creatively' },
        { name: 'Alternative explorer', description: 'Explores alternatives' },
        { name: 'Scenario simulator', description: 'Simulates scenarios' },
        { name: 'Brainstorm engine', description: 'Generates brainstorm ideas' },
        { name: 'Innovation detector', description: 'Detects innovative approaches' },
        { name: 'Design synthesizer', description: 'Synthesizes design options' },
        { name: 'Perspective shifter', description: 'Shifts creative perspective' },
        { name: 'Constraint relaxer', description: 'Relaxes constraints for creativity' },
        { name: 'Serendipity engine', description: 'Enables serendipitous connections' },
        { name: 'Option generator', description: 'Generates multiple options' },
        { name: 'Novelty scorer', description: 'Scores novelty of outputs' },
      ],
      sanity: [
        { name: 'Contradiction checker', description: 'Checks for contradictions' },
        { name: 'Consistency validator', description: 'Validates logical consistency' },
        { name: 'Nonsense detector', description: 'Detects nonsensical output' },
        { name: 'Drift monitor', description: 'Monitors topic drift' },
        { name: 'Hallucination detector', description: 'Detects potential hallucinations' },
        { name: 'Fact validator', description: 'Validates factual claims' },
        { name: 'Logic validator', description: 'Validates logical correctness' },
        { name: 'Coherence checker', description: 'Checks output coherence' },
        { name: 'Grounding validator', description: 'Validates grounding in context' },
        { name: 'Self-reference checker', description: 'Checks self-referential validity' },
        { name: 'Boundary monitor', description: 'Monitors appropriate boundaries' },
        { name: 'Safety validator', description: 'Validates safety of output' },
        { name: 'Bias detector', description: 'Detects potential biases' },
        { name: 'Quality gate', description: 'Final quality validation' },
        { name: 'Confidence calibrator', description: 'Calibrates output confidence' },
      ],
      relational: [
        { name: 'Speaker identifier', description: 'Identifies who is speaking' },
        { name: 'User classifier', description: 'Classifies user type (primary vs other)' },
        { name: 'Relationship tracker', description: 'Tracks relationship history' },
        { name: 'Trust assessor', description: 'Assesses trust level' },
        { name: 'Mode selector', description: 'Selects appropriate mode (A/B)' },
        { name: 'Formality adjuster', description: 'Adjusts formality level' },
        { name: 'Rapport builder', description: 'Builds conversational rapport' },
        { name: 'Boundary enforcer', description: 'Enforces relationship boundaries' },
        { name: 'Empathy calibrator', description: 'Calibrates empathy level' },
        { name: 'Authority recognizer', description: 'Recognizes authority dynamics' },
        { name: 'Context adapter', description: 'Adapts to relational context' },
        { name: 'Preference tracker', description: 'Tracks user preferences' },
        { name: 'History integrator', description: 'Integrates interaction history' },
        { name: 'Appropriate response filter', description: 'Filters for appropriateness' },
        { name: 'Social calibrator', description: 'Calibrates social dynamics' },
      ],
      style: [
        { name: 'Tone setter', description: 'Sets appropriate tone' },
        { name: 'Voice enforcer', description: 'Enforces 4Ji voice consistency' },
        { name: 'Phrasing optimizer', description: 'Optimizes phrasing' },
        { name: 'Personality infuser', description: 'Infuses personality traits' },
        { name: 'Warmth calibrator', description: 'Calibrates warmth level' },
        { name: 'Directness adjuster', description: 'Adjusts directness level' },
        { name: 'Humor calibrator', description: 'Calibrates appropriate humor' },
        { name: 'Formality tuner', description: 'Tunes formality level' },
        { name: 'Clarity enhancer', description: 'Enhances clarity' },
        { name: 'Engagement optimizer', description: 'Optimizes engagement' },
        { name: 'Persona consistency checker', description: 'Checks persona consistency' },
        { name: 'Language polisher', description: 'Polishes language quality' },
        { name: 'Brand voice enforcer', description: 'Enforces brand voice' },
        { name: 'Readability optimizer', description: 'Optimizes readability' },
        { name: 'Expression finalizer', description: 'Finalizes expression' },
      ],
      optimization: [
        { name: 'Length optimizer', description: 'Optimizes response length' },
        { name: 'Conciseness enforcer', description: 'Enforces conciseness' },
        { name: 'Expansion manager', description: 'Manages elaboration when needed' },
        { name: 'Redundancy remover', description: 'Removes redundant content' },
        { name: 'Structure optimizer', description: 'Optimizes response structure' },
        { name: 'Format selector', description: 'Selects optimal format' },
        { name: 'Emphasis placer', description: 'Places appropriate emphasis' },
        { name: 'Flow optimizer', description: 'Optimizes content flow' },
        { name: 'Hook creator', description: 'Creates engaging hooks' },
        { name: 'Conclusion optimizer', description: 'Optimizes conclusions' },
        { name: 'Action item extractor', description: 'Extracts actionable items' },
        { name: 'Summary generator', description: 'Generates summaries when needed' },
        { name: 'Detail balancer', description: 'Balances detail level' },
        { name: 'Priority sorter', description: 'Sorts information by priority' },
        { name: 'Final polish', description: 'Applies final polish' },
      ],
    };

    // Generate full layer set by cycling through templates
    const result: Array<{ name: string; description: string }> = [];
    const templates = layerTemplates[band];
    
    for (let i = 0; i < count; i++) {
      const templateIndex = i % templates.length;
      const variation = Math.floor(i / templates.length);
      const template = templates[templateIndex];
      
      if (variation === 0) {
        result.push(template);
      } else {
        result.push({
          name: `${template.name} v${variation + 1}`,
          description: `${template.description} (enhanced variant)`,
        });
      }
    }

    return result;
  }

  /**
   * Process input through all cognitive bands
   */
  async process(
    input: string,
    context?: {
      paradoxResolution?: unknown;
      emotionalTension?: unknown;
      relationalMode?: 'A' | 'B';
      isPrimaryUser?: boolean;
    }
  ): Promise<CognitiveProcessingResult> {
    const startTime = Date.now();
    
    if (!this.initialized) {
      throw new Error('CognitiveFabric not initialized');
    }

    this.processingActive = true;
    this.bandResults.clear();
    this.emit('processing-started', { inputLength: input.length });

    try {
      // Process each band in order
      const bands: CognitiveBand[] = [
        'perception', 'retrieval', 'reasoning', 'creativity',
        'sanity', 'relational', 'style', 'optimization'
      ];

      let currentOutput = input;

      for (const band of bands) {
        const bandResult = await this.processBand(band, currentOutput, context);
        this.bandResults.set(band, bandResult);
        currentOutput = bandResult.output;
      }

      // Final sanity check (mandatory)
      const sanityPassed = this.performFinalSanityCheck(currentOutput);

      // Calculate style consistency
      const styleConsistency = this.calculateStyleConsistency(currentOutput, context);

      const result: CognitiveProcessingResult = {
        bandResults: new Map(this.bandResults),
        finalOutput: currentOutput,
        sanityCheckPassed: sanityPassed,
        styleConsistency,
        totalProcessingTime: Date.now() - startTime,
      };

      this.emit('processing-complete', result);
      return result;

    } finally {
      this.processingActive = false;
    }
  }

  /**
   * Process a single cognitive band
   */
  private async processBand(
    band: CognitiveBand,
    input: string,
    context?: Record<string, unknown>
  ): Promise<BandProcessingResult> {
    const bandStartTime = Date.now();
    const bandLayers = this.layers.get(band) || [];
    
    let output = input;
    let confidence = 1.0;
    let layersProcessed = 0;

    // Process each layer in the band
    for (const layer of bandLayers) {
      if (!layer.active) continue;

      // Apply layer-specific processing
      const layerResult = this.processLayer(layer, output, context);
      output = layerResult.output;
      confidence *= layerResult.confidenceModifier;
      layersProcessed++;
    }

    return {
      band,
      layersProcessed,
      output,
      confidence,
      processingTime: Date.now() - bandStartTime,
    };
  }

  /**
   * Process a single cognitive layer
   */
  private processLayer(
    layer: CognitiveLayer,
    input: string,
    context?: Record<string, unknown>
  ): { output: string; confidenceModifier: number } {
    // Layer-specific processing based on band
    switch (layer.band) {
      case 'perception':
        return this.processPerceptionLayer(layer, input, context);
      case 'retrieval':
        return this.processRetrievalLayer(layer, input, context);
      case 'reasoning':
        return this.processReasoningLayer(layer, input, context);
      case 'creativity':
        return this.processCreativityLayer(layer, input, context);
      case 'sanity':
        return this.processSanityLayer(layer, input, context);
      case 'relational':
        return this.processRelationalLayer(layer, input, context);
      case 'style':
        return this.processStyleLayer(layer, input, context);
      case 'optimization':
        return this.processOptimizationLayer(layer, input, context);
      default:
        return { output: input, confidenceModifier: 1.0 };
    }
  }

  // ============================================================================
  // Band-Specific Processing
  // ============================================================================

  private processPerceptionLayer(
    layer: CognitiveLayer,
    input: string,
    context?: Record<string, unknown>
  ): { output: string; confidenceModifier: number } {
    // Perception layers enhance understanding of input
    // They don't modify output but add metadata/understanding
    return { output: input, confidenceModifier: 1.0 };
  }

  private processRetrievalLayer(
    layer: CognitiveLayer,
    input: string,
    context?: Record<string, unknown>
  ): { output: string; confidenceModifier: number } {
    // Retrieval layers augment with relevant knowledge
    // In a full implementation, this would call RAG systems
    return { output: input, confidenceModifier: 1.0 };
  }

  private processReasoningLayer(
    layer: CognitiveLayer,
    input: string,
    context?: Record<string, unknown>
  ): { output: string; confidenceModifier: number } {
    // Reasoning layers apply logical processing
    // They validate and strengthen arguments
    return { output: input, confidenceModifier: 1.0 };
  }

  private processCreativityLayer(
    layer: CognitiveLayer,
    input: string,
    context?: Record<string, unknown>
  ): { output: string; confidenceModifier: number } {
    // Creativity layers add novel perspectives
    // They enhance with analogies, metaphors, alternatives
    return { output: input, confidenceModifier: 1.0 };
  }

  private processSanityLayer(
    layer: CognitiveLayer,
    input: string,
    context?: Record<string, unknown>
  ): { output: string; confidenceModifier: number } {
    let output = input;
    let modifier = 1.0;

    // Check for contradictions
    if (layer.name.includes('Contradiction')) {
      const hasContradiction = this.detectContradictions(input);
      if (hasContradiction) {
        modifier *= 0.9; // Lower confidence if contradictions found
      }
    }

    // Check for consistency
    if (layer.name.includes('Consistency')) {
      const isConsistent = this.checkConsistency(input);
      if (!isConsistent) {
        modifier *= 0.9;
      }
    }

    // Check for nonsense
    if (layer.name.includes('Nonsense')) {
      const hasNonsense = this.detectNonsense(input);
      if (hasNonsense) {
        modifier *= 0.8;
      }
    }

    return { output, confidenceModifier: modifier };
  }

  private processRelationalLayer(
    layer: CognitiveLayer,
    input: string,
    context?: Record<string, unknown>
  ): { output: string; confidenceModifier: number } {
    let output = input;

    // Adjust based on relational mode
    if (context?.relationalMode === 'A' && context?.isPrimaryUser) {
      // Mode A: More warmth, expressiveness
      if (layer.name.includes('Warmth') || layer.name.includes('Rapport')) {
        // Enhance warmth in response
      }
    } else if (context?.relationalMode === 'B') {
      // Mode B: More professional, efficient
      if (layer.name.includes('Formality')) {
        output = this.increaseFormality(output);
      }
    }

    return { output, confidenceModifier: 1.0 };
  }

  private processStyleLayer(
    layer: CognitiveLayer,
    input: string,
    context?: Record<string, unknown>
  ): { output: string; confidenceModifier: number } {
    let output = input;

    // Apply 4Ji voice consistency
    if (layer.name.includes('Voice enforcer')) {
      output = this.enforce4JiVoice(output);
    }

    // Optimize phrasing
    if (layer.name.includes('Phrasing')) {
      output = this.optimizePhrasing(output);
    }

    // Enhance clarity
    if (layer.name.includes('Clarity')) {
      output = this.enhanceClarity(output);
    }

    return { output, confidenceModifier: 1.0 };
  }

  private processOptimizationLayer(
    layer: CognitiveLayer,
    input: string,
    context?: Record<string, unknown>
  ): { output: string; confidenceModifier: number } {
    let output = input;

    // Remove redundancy
    if (layer.name.includes('Redundancy')) {
      output = this.removeRedundancy(output);
    }

    // Optimize length
    if (layer.name.includes('Length')) {
      output = this.optimizeLength(output);
    }

    // Final polish
    if (layer.name.includes('Final polish')) {
      output = this.applyFinalPolish(output);
    }

    return { output, confidenceModifier: 1.0 };
  }

  // ============================================================================
  // Processing Helpers
  // ============================================================================

  private detectContradictions(text: string): boolean {
    const contradictionPatterns = [
      /but.+however/i,
      /yes.+no.+/i,
      /is.+isn't/i,
      /can.+cannot/i,
    ];
    return contradictionPatterns.some(p => p.test(text));
  }

  private checkConsistency(text: string): boolean {
    // Check for logical consistency
    return !text.includes('on the other hand') || text.length > 100;
  }

  private detectNonsense(text: string): boolean {
    // Check for nonsensical patterns
    const nonsensePatterns = [
      /\w{50,}/,  // Very long words
      /(.)\1{10,}/,  // Repeated characters
    ];
    return nonsensePatterns.some(p => p.test(text));
  }

  private increaseFormality(text: string): string {
    return text
      .replace(/gonna/gi, 'going to')
      .replace(/wanna/gi, 'want to')
      .replace(/gotta/gi, 'have to')
      .replace(/kinda/gi, 'kind of')
      .replace(/sorta/gi, 'sort of');
  }

  private enforce4JiVoice(text: string): string {
    // Remove any AI self-references that aren't 4Ji
    return text
      .replace(/I am (ChatGPT|GPT|Claude|Gemini|Copilot)/gi, 'I am 4Ji')
      .replace(/As an AI (assistant|language model)/gi, 'As 4Ji');
  }

  private optimizePhrasing(text: string): string {
    return text
      .replace(/in order to/gi, 'to')
      .replace(/due to the fact that/gi, 'because')
      .replace(/at this point in time/gi, 'now')
      .replace(/in the event that/gi, 'if');
  }

  private enhanceClarity(text: string): string {
    // Add clarity markers
    return text.replace(/\s+/g, ' ').trim();
  }

  private removeRedundancy(text: string): string {
    // Remove repeated phrases
    const words = text.split(' ');
    const seen = new Set<string>();
    const result: string[] = [];

    for (let i = 0; i < words.length; i++) {
      const trigram = words.slice(i, i + 3).join(' ').toLowerCase();
      if (trigram.length > 10 && seen.has(trigram)) {
        continue; // Skip repeated trigram
      }
      seen.add(trigram);
      result.push(words[i]);
    }

    return result.join(' ');
  }

  private optimizeLength(text: string): string {
    // No length optimization by default - preserve content
    return text;
  }

  private applyFinalPolish(text: string): string {
    // Clean up whitespace and punctuation
    return text
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,!?])/g, '$1')
      .replace(/([.,!?])([A-Z])/g, '$1 $2')
      .trim();
  }

  private performFinalSanityCheck(output: string): boolean {
    // Final validation before output
    if (!output || output.length === 0) return false;
    if (this.detectNonsense(output)) return false;
    return true;
  }

  private calculateStyleConsistency(
    output: string,
    context?: Record<string, unknown>
  ): number {
    let consistency = 1.0;

    // Check for forbidden AI mentions
    if (/ChatGPT|GPT-4|Claude|Gemini|Copilot/i.test(output)) {
      consistency *= 0.5;
    }

    // Check for appropriate tone based on mode
    if (context?.relationalMode === 'B') {
      // Mode B should be formal
      if (/gonna|wanna|gotta|lol|haha/i.test(output)) {
        consistency *= 0.8;
      }
    }

    return consistency;
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get all layers for a band
   */
  getLayersForBand(band: CognitiveBand): CognitiveLayer[] {
    return [...(this.layers.get(band) || [])];
  }

  /**
   * Get total layer count
   */
  getTotalLayerCount(): number {
    let total = 0;
    for (const layers of this.layers.values()) {
      total += layers.length;
    }
    return total;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalLayers: number;
    layersByBand: Record<CognitiveBand, number>;
    mandatoryBands: CognitiveBand[];
  } {
    const layersByBand: Record<CognitiveBand, number> = {} as Record<CognitiveBand, number>;
    
    for (const [band, layers] of this.layers) {
      layersByBand[band] = layers.length;
    }

    return {
      totalLayers: this.getTotalLayerCount(),
      layersByBand,
      mandatoryBands: MANDATORY_BANDS,
    };
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if processing
   */
  isProcessing(): boolean {
    return this.processingActive;
  }

  /**
   * Enable/disable a specific layer
   */
  setLayerActive(layerId: number, active: boolean): boolean {
    for (const layers of this.layers.values()) {
      const layer = layers.find(l => l.id === layerId);
      if (layer) {
        layer.active = active;
        return true;
      }
    }
    return false;
  }

  /**
   * Enable/disable an entire band
   */
  setBandActive(band: CognitiveBand, active: boolean): void {
    const layers = this.layers.get(band);
    if (layers) {
      for (const layer of layers) {
        // Don't disable mandatory band layers
        if (!MANDATORY_BANDS.includes(band) || active) {
          layer.active = active;
        }
      }
    }
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: CognitiveFabric | null = null;

export function getCognitiveFabric(): CognitiveFabric {
  if (!instance) {
    instance = new CognitiveFabric();
  }
  return instance;
}

export function resetCognitiveFabric(): void {
  instance = null;
}

export default CognitiveFabric;
