/**
 * LEXARA VOICE SYNTHESIS - PLANNER + SYNTHESIZER SEPARATION
 * 
 * The voice synthesis system is split into:
 * 1. Lexara Planner: Consumes ActionIntent, creates synth jobs, requests sims for gaps
 * 2. Lexara Synth: Executes synthesis calls to providers, returns ActionResult
 * 
 * Monte Carlo improvements:
 * - Prosody/parameter exploration: sample candidate settings and pick best under constraints
 * - Reliability under incomplete data: robust chunking and smoothing when inputs jitter
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  type ActionIntent,
  type ActionResult,
  type SimRequest,
  type SimResult,
  type Trip,
  type VoiceActionParams,
  type VoiceActionResult,
  type Telemetry,
  createBaseEvent,
  PUBSUB_TOPICS,
} from '../../packages/contracts/src/index';
import { getTransport, ReactorTransport } from '../../packages/contracts/src/transport';

// ============================================================================
// TYPES
// ============================================================================

export interface SynthJob {
  id: string;
  intentId: string;
  traceId: string;
  text: string;
  voiceId: string;
  provider: string;
  settings: VoiceSettings;
  chunks: TextChunk[];
  status: SynthJobStatus;
  results: ChunkResult[];
  createdAt: number;
  completedAt?: number;
  totalLatencyMs?: number;
  qualityScore?: number;
}

export interface VoiceSettings {
  stability: number;
  similarityBoost: number;
  style: number;
  speakingRate: number;
  chunkSize: number;
  outputFormat: string;
}

export interface TextChunk {
  index: number;
  text: string;
  ssml?: string;
  estimatedDurationMs: number;
}

export interface ChunkResult {
  index: number;
  audioUrl?: string;
  audioData?: Buffer;
  durationMs: number;
  latencyMs: number;
  quality: number;
  error?: string;
}

export enum SynthJobStatus {
  PENDING = 'pending',
  PLANNING = 'planning',
  SIMULATING = 'simulating',
  SYNTHESIZING = 'synthesizing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// ============================================================================
// PROVIDER INTERFACE
// ============================================================================

export interface VoiceProvider {
  name: string;
  synthesize(text: string, voiceId: string, settings: VoiceSettings): Promise<{
    audioUrl?: string;
    audioData?: Buffer;
    durationMs: number;
    latencyMs: number;
    quality: number;
    charactersBilled: number;
    error?: string;
  }>;
  getVoices(): Promise<{ id: string; name: string; language: string }[]>;
  healthCheck(): Promise<boolean>;
}

// ============================================================================
// MOCK PROVIDER
// ============================================================================

class MockVoiceProvider implements VoiceProvider {
  name = 'mock';

  async synthesize(text: string, voiceId: string, settings: VoiceSettings): Promise<{
    audioUrl?: string;
    audioData?: Buffer;
    durationMs: number;
    latencyMs: number;
    quality: number;
    charactersBilled: number;
    error?: string;
  }> {
    // Simulate provider latency
    const baseLatency = 200;
    const textLatency = text.length * 5;
    const totalLatency = baseLatency + textLatency + Math.random() * 200;
    
    await new Promise(resolve => setTimeout(resolve, totalLatency));

    // Simulate occasional failures
    if (Math.random() < 0.02) {
      return {
        durationMs: 0,
        latencyMs: totalLatency,
        quality: 0,
        charactersBilled: 0,
        error: 'Mock provider temporary failure',
      };
    }

    // Estimate audio duration (~150 words per minute)
    const wordCount = text.split(/\s+/).length;
    const durationMs = (wordCount / 150) * 60 * 1000 * (1 / settings.speakingRate);

    // Quality based on settings
    const quality = Math.min(1, 0.7 + settings.stability * 0.15 + (1 - Math.abs(1 - settings.speakingRate)) * 0.15);

    return {
      audioUrl: `mock://audio/${randomUUID()}.mp3`,
      durationMs,
      latencyMs: totalLatency,
      quality,
      charactersBilled: text.length,
    };
  }

  async getVoices(): Promise<{ id: string; name: string; language: string }[]> {
    return [
      { id: 'lexara-default', name: 'Lexara Default', language: 'en-US' },
      { id: 'lexara-warm', name: 'Lexara Warm', language: 'en-US' },
      { id: 'lexara-clear', name: 'Lexara Clear', language: 'en-US' },
    ];
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

// ============================================================================
// LEXARA PLANNER
// ============================================================================

export interface PlannerConfig {
  /** Maximum chunk size in characters */
  maxChunkSize: number;
  /** Minimum chunk size in characters */
  minChunkSize: number;
  /** Default voice settings */
  defaultSettings: VoiceSettings;
  /** Whether to request sim for prosody optimization */
  enableProsodyOptimization: boolean;
  /** Whether to request sim for latency prediction */
  enableLatencyPrediction: boolean;
  /** Timeout for waiting for simulation results (ms) */
  simTimeoutMs: number;
}

export class LexaraPlanner extends EventEmitter {
  private config: PlannerConfig;
  private transport: ReactorTransport;
  private pendingSims: Map<string, { job: SynthJob; callback: (result: SimResult) => void }> = new Map();
  private isRunning: boolean = false;

  constructor(config: Partial<PlannerConfig> = {}) {
    super();
    this.config = {
      maxChunkSize: 500,
      minChunkSize: 50,
      defaultSettings: {
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0.0,
        speakingRate: 1.0,
        chunkSize: 500,
        outputFormat: 'mp3_44100_128',
      },
      enableProsodyOptimization: true,
      enableLatencyPrediction: true,
      simTimeoutMs: 3000,
      ...config,
    };

    this.transport = getTransport();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Subscribe to voice intents
    this.transport.subscribeDurable(PUBSUB_TOPICS.INTENT, async (event) => {
      const intent = event as ActionIntent;
      if (intent.domain === 'voice') {
        await this.handleIntent(intent);
      }
    });

    // Subscribe to simulation results
    this.transport.subscribeDurable(PUBSUB_TOPICS.SIMRES, async (event) => {
      const result = event as SimResult;
      if (result.domain === 'voice') {
        this.handleSimResult(result);
      }
    });

    console.log('[LexaraPlanner] Started');
    this.emit('started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    console.log('[LexaraPlanner] Stopped');
    this.emit('stopped');
  }

  private async handleIntent(intent: ActionIntent): Promise<void> {
    const params = intent.parameters as VoiceActionParams;
    
    // Create synth job
    const job: SynthJob = {
      id: randomUUID(),
      intentId: intent.event_id,
      traceId: intent.trace_id,
      text: params.text,
      voiceId: params.voice_id || 'lexara-default',
      provider: params.provider || 'mock',
      settings: this.mergeSettings(params.settings),
      chunks: [],
      status: SynthJobStatus.PLANNING,
      results: [],
      createdAt: Date.now(),
    };

    // Step 1: Chunk the text
    job.chunks = this.chunkText(params.text, job.settings.chunkSize);
    console.log(`[LexaraPlanner] Created job ${job.id} with ${job.chunks.length} chunks`);

    // Step 2: Optionally request prosody optimization sim
    if (this.config.enableProsodyOptimization) {
      job.status = SynthJobStatus.SIMULATING;
      const optimizedSettings = await this.requestProsodyOptimization(job);
      if (optimizedSettings) {
        job.settings = optimizedSettings;
      }
    }

    // Step 3: Emit planned job for synthesizer
    job.status = SynthJobStatus.SYNTHESIZING;
    this.emit('job:planned', job);
  }

  private mergeSettings(overrides?: Partial<VoiceSettings>): VoiceSettings {
    return {
      ...this.config.defaultSettings,
      ...overrides,
    };
  }

  private chunkText(text: string, maxSize: number): TextChunk[] {
    const chunks: TextChunk[] = [];
    
    // Split on sentence boundaries
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let currentChunk = '';
    let index = 0;

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > maxSize && currentChunk.length >= this.config.minChunkSize) {
        chunks.push({
          index: index++,
          text: currentChunk.trim(),
          estimatedDurationMs: this.estimateDuration(currentChunk),
        });
        currentChunk = sentence;
      } else {
        currentChunk += sentence;
      }
    }

    // Add remaining text
    if (currentChunk.trim()) {
      chunks.push({
        index: index,
        text: currentChunk.trim(),
        estimatedDurationMs: this.estimateDuration(currentChunk),
      });
    }

    return chunks;
  }

  private estimateDuration(text: string): number {
    const wordCount = text.split(/\s+/).length;
    return (wordCount / 150) * 60 * 1000; // 150 WPM
  }

  private async requestProsodyOptimization(job: SynthJob): Promise<VoiceSettings | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingSims.delete(job.traceId);
        resolve(null); // Use default settings on timeout
      }, this.config.simTimeoutMs);

      this.pendingSims.set(job.traceId, {
        job,
        callback: (result) => {
          clearTimeout(timeout);
          
          // Extract optimized settings from simulation result
          const successProb = result.summary.success_probability ?? 0;
          if (result.confidence > 0.7 && successProb > 0.7) {
            // Use the best settings from simulation
            const optimized: VoiceSettings = {
              ...job.settings,
              stability: Math.max(0.3, Math.min(0.8, result.summary.expected_value)),
              similarityBoost: Math.max(0.5, Math.min(0.9, 0.75 + result.summary.variance * 0.1)),
            };
            resolve(optimized);
          } else {
            resolve(null);
          }
        },
      });

      // Emit simulation request
      const simRequest: SimRequest = {
        ...createBaseEvent(job.traceId),
        kind: 'simreq',
        domain: 'voice',
        sim_type: 'prosody_candidates',
        n_paths: 100,
        horizon_ms: 5000,
        input_features: {
          voice: {
            text_length: job.text.length,
            chunk_count: job.chunks.length,
            voice_id: job.voiceId,
          },
        },
        constraints: {
          quality_bounds: { min: 0.7, max: 1.0 },
        },
        seed: Math.floor(Math.random() * 1000000),
        deadline_ts: Date.now() + this.config.simTimeoutMs,
        priority: 5,
      };

      this.transport.publishDurable(PUBSUB_TOPICS.SIMREQ, simRequest);
    });
  }

  private handleSimResult(result: SimResult): void {
    const pending = this.pendingSims.get(result.trace_id);
    if (pending) {
      pending.callback(result);
      this.pendingSims.delete(result.trace_id);
    }
  }
}

// ============================================================================
// LEXARA SYNTHESIZER
// ============================================================================

export interface SynthesizerConfig {
  /** Maximum concurrent synthesis requests */
  maxConcurrent: number;
  /** Retry count on failure */
  maxRetries: number;
  /** Base retry delay (ms) */
  retryDelayMs: number;
}

export class LexaraSynth extends EventEmitter {
  private config: SynthesizerConfig;
  private transport: ReactorTransport;
  private providers: Map<string, VoiceProvider> = new Map();
  private planner: LexaraPlanner;
  private activeJobs: number = 0;
  private isRunning: boolean = false;
  private startTime: number = 0;
  
  // Metrics
  private processedCount: number = 0;
  private errorCount: number = 0;
  private totalLatencyMs: number = 0;

  constructor(planner: LexaraPlanner, config: Partial<SynthesizerConfig> = {}) {
    super();
    this.config = {
      maxConcurrent: 5,
      maxRetries: 2,
      retryDelayMs: 500,
      ...config,
    };

    this.transport = getTransport();
    this.planner = planner;
    
    // Register mock provider
    this.registerProvider(new MockVoiceProvider());
  }

  registerProvider(provider: VoiceProvider): void {
    this.providers.set(provider.name, provider);
    console.log(`[LexaraSynth] Registered provider: ${provider.name}`);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startTime = Date.now();

    // Listen for planned jobs from planner
    this.planner.on('job:planned', async (job: SynthJob) => {
      await this.synthesizeJob(job);
    });

    console.log('[LexaraSynth] Started');
    this.emit('started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    console.log('[LexaraSynth] Stopped');
    this.emit('stopped');
  }

  private async synthesizeJob(job: SynthJob): Promise<void> {
    const startTime = Date.now();
    this.processedCount++;

    const provider = this.providers.get(job.provider);
    if (!provider) {
      await this.emitFailedResult(job, `Provider not found: ${job.provider}`);
      return;
    }

    try {
      // Synthesize each chunk
      for (const chunk of job.chunks) {
        const result = await this.synthesizeChunk(chunk, job, provider);
        job.results.push(result);

        if (result.error) {
          this.errorCount++;
        }
      }

      // Calculate aggregate metrics
      const successfulResults = job.results.filter(r => !r.error);
      job.completedAt = Date.now();
      job.totalLatencyMs = Date.now() - startTime;
      job.qualityScore = successfulResults.length > 0
        ? successfulResults.reduce((sum, r) => sum + r.quality, 0) / successfulResults.length
        : 0;
      job.status = successfulResults.length === job.chunks.length
        ? SynthJobStatus.COMPLETED
        : SynthJobStatus.FAILED;

      this.totalLatencyMs += job.totalLatencyMs;

      // Emit result
      await this.emitResult(job);

      console.log(`[LexaraSynth] Completed job ${job.id}: ${successfulResults.length}/${job.chunks.length} chunks, quality: ${job.qualityScore?.toFixed(2)}`);

    } catch (err) {
      this.errorCount++;
      job.status = SynthJobStatus.FAILED;
      await this.emitFailedResult(job, (err as Error).message);
    }
  }

  private async synthesizeChunk(chunk: TextChunk, job: SynthJob, provider: VoiceProvider): Promise<ChunkResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const result = await provider.synthesize(chunk.text, job.voiceId, job.settings);
        
        if (result.error) {
          lastError = result.error;
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs * (attempt + 1)));
          continue;
        }

        return {
          index: chunk.index,
          audioUrl: result.audioUrl,
          audioData: result.audioData,
          durationMs: result.durationMs,
          latencyMs: result.latencyMs,
          quality: result.quality,
        };
      } catch (err) {
        lastError = (err as Error).message;
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs * (attempt + 1)));
      }
    }

    return {
      index: chunk.index,
      durationMs: 0,
      latencyMs: 0,
      quality: 0,
      error: lastError || 'Unknown error',
    };
  }

  private async emitResult(job: SynthJob): Promise<void> {
    const successfulResults = job.results.filter(r => !r.error);
    
    const result: ActionResult = {
      ...createBaseEvent(job.traceId),
      kind: 'result',
      domain: 'voice',
      status: job.status === SynthJobStatus.COMPLETED ? 'success' : 'partial',
      details: {
        audio_url: successfulResults.length === 1 ? successfulResults[0].audioUrl : undefined,
        audio_duration_ms: successfulResults.reduce((sum, r) => sum + r.durationMs, 0),
        characters_billed: job.text.length,
        quality_score: job.qualityScore,
        provider_latency_ms: job.totalLatencyMs,
      } as VoiceActionResult,
      latency_ms: job.totalLatencyMs || 0,
      idempotency_key: `voice_${job.intentId}`,
    };

    await this.transport.publishDurable(PUBSUB_TOPICS.RESULT, result);
    this.emit('result:emitted', { job, result });
  }

  private async emitFailedResult(job: SynthJob, error: string): Promise<void> {
    const result: ActionResult = {
      ...createBaseEvent(job.traceId),
      kind: 'result',
      domain: 'voice',
      status: 'failed',
      details: {
        error,
      } as VoiceActionResult,
      latency_ms: Date.now() - job.createdAt,
      idempotency_key: `voice_${job.intentId}`,
    };

    await this.transport.publishDurable(PUBSUB_TOPICS.RESULT, result);
  }

  // ==================== TELEMETRY ====================

  async emitTelemetry(): Promise<void> {
    const uptime = (Date.now() - this.startTime) / 1000;
    const errorRate = this.processedCount > 0 ? this.errorCount / this.processedCount : 0;
    const avgLatency = this.processedCount > 0 ? this.totalLatencyMs / this.processedCount : 0;

    const telemetry: Telemetry = {
      ...createBaseEvent(),
      kind: 'telemetry',
      service: 'lexara-synth',
      health: errorRate < 0.1 ? 'healthy' : errorRate < 0.3 ? 'degraded' : 'unhealthy',
      metrics: {
        throughput_eps: this.processedCount / Math.max(1, uptime),
        queue_depth: this.activeJobs,
        error_rate: errorRate,
        avg_latency_ms: avgLatency,
        p99_latency_ms: avgLatency * 2, // Approximation
        memory_mb: process.memoryUsage().heapUsed / 1024 / 1024,
        cpu_usage: 0.1,
        custom: {
          jobs_processed: this.processedCount,
          providers: this.providers.size,
        },
      },
      uptime_s: uptime,
    };

    await this.transport.publishDurable(PUBSUB_TOPICS.TELEMETRY, telemetry);
  }

  getStats(): { processed: number; errors: number; avgLatencyMs: number } {
    return {
      processed: this.processedCount,
      errors: this.errorCount,
      avgLatencyMs: this.processedCount > 0 ? this.totalLatencyMs / this.processedCount : 0,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

let plannerInstance: LexaraPlanner | null = null;
let synthInstance: LexaraSynth | null = null;

export function getLexaraPlanner(config?: Partial<PlannerConfig>): LexaraPlanner {
  if (!plannerInstance) {
    plannerInstance = new LexaraPlanner(config);
  }
  return plannerInstance;
}

export function getLexaraSynth(config?: Partial<SynthesizerConfig>): LexaraSynth {
  if (!synthInstance) {
    const planner = getLexaraPlanner();
    synthInstance = new LexaraSynth(planner, config);
  }
  return synthInstance;
}

export default { LexaraPlanner, LexaraSynth, getLexaraPlanner, getLexaraSynth };
