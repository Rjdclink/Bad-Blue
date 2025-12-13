/**
 * 3D Geiger Counter Rate Limiter with Provider Rotation
 * 
 * A reactive, exponential rate limiting system that:
 * 1. ROTATES through ALL available free AI providers
 * 2. Reacts like a Geiger counter - spikes on heavy usage, decays over time
 * 3. Operates in 3D: Time decay × Usage intensity × Provider health
 * 
 * FREE AI PROVIDERS (December 2025):
 * - Groq (llama-3.3-70b, mixtral-8x7b, gemma2-9b) - 30 RPM, 14.4K RPD
 * - Google Gemini (gemini-1.5-flash, gemini-2.0-flash) - 15 RPM, 1500 RPD  
 * - Mistral (mistral-small-latest via La Plateforme free tier)
 * - Anthropic Claude (limited free tier via API)
 * - Cohere (command-r-plus free tier) - 20 RPM
 * - Together.ai (free tier models)
 * - Hugging Face Inference API (free tier)
 * - Cloudflare Workers AI (100K free requests/day)
 * - Cerebras (free tier - ultra fast)
 * - SambaNova (free tier)
 * 
 * ROTATION STRATEGY:
 * - Round-robin across healthy providers
 * - Skip providers with high "radiation" (usage intensity)
 * - Exponential backoff on failures
 * - Automatic recovery as radiation decays
 */

export interface ProviderConfig {
  name: string;
  endpoint: string;
  models: string[];
  rpmLimit: number;      // Requests per minute
  rpdLimit: number;      // Requests per day
  tpdLimit?: number;     // Tokens per day (if applicable)
  apiKeyEnv: string;     // Environment variable name for API key
  priority: number;      // Lower = higher priority (1-10)
  isAvailable: () => boolean;
}

export interface GeigerReading {
  radiation: number;      // 0-100, current "heat" level
  decayRate: number;      // How fast radiation decreases (per second)
  lastSpike: number;      // Timestamp of last usage spike
  consecutiveHits: number; // Consecutive requests in short window
  healthScore: number;    // 0-100, provider health
  cooldownUntil: number;  // Timestamp when provider can be used again
  dailyUsage: number;     // Requests made today
  minuteUsage: number;    // Requests made this minute
  lastMinuteReset: number; // Timestamp of last minute reset
  lastDailyReset: number;  // Timestamp of last daily reset
  failures: number;        // Consecutive failures
  lastFailure: number;     // Timestamp of last failure
}

export interface RotationResult {
  provider: string;
  model: string;
  endpoint: string;
  apiKey: string;
  reason: string;
  geigerReading: GeigerReading;
  allReadings: Map<string, GeigerReading>;
}

// Free AI Provider Configurations
const FREE_PROVIDERS: ProviderConfig[] = [
  // TIER 1: Most generous free tiers
  {
    name: 'groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
      'qwen/qwen3-32b',
      'playai-tts',
      'playai-tts-arabic',
      'whisper-large-v3',
      'whisper-large-v3-turbo'
    ],
    rpmLimit: 30,
    rpdLimit: 14400,
    tpdLimit: 500000,
    apiKeyEnv: 'GROQ_API_KEY',
    priority: 1,
    isAvailable: () => !!process.env.GROQ_API_KEY,
  },
  {
    name: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
    rpmLimit: 15,
    rpdLimit: 1500,
    apiKeyEnv: 'GEMINI_API_KEY',
    priority: 2,
    isAvailable: () => !!process.env.GEMINI_API_KEY,
  },
  {
    name: 'mistral',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    models: ['mistral-small-latest', 'open-mistral-7b'],
    rpmLimit: 5,
    rpdLimit: 500,
    apiKeyEnv: 'MISTRAL_API_KEY',
    priority: 3,
    isAvailable: () => !!process.env.MISTRAL_API_KEY,
  },
  {
    name: 'claude',
    endpoint: 'https://api.anthropic.com/v1/messages',
    models: ['claude-3-haiku-20240307'],
    rpmLimit: 5,
    rpdLimit: 100,
    tpdLimit: 25000,
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    priority: 4,
    isAvailable: () => !!process.env.ANTHROPIC_API_KEY || !!process.env.CLAUDE_API_KEY,
  },
  // TIER 2: Additional free providers
  {
    name: 'cohere',
    endpoint: 'https://api.cohere.ai/v1/chat',
    models: ['command-r-plus', 'command-r', 'command'],
    rpmLimit: 20,
    rpdLimit: 1000,
    apiKeyEnv: 'COHERE_API_KEY',
    priority: 5,
    isAvailable: () => !!process.env.COHERE_API_KEY,
  },
  {
    name: 'together',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    models: ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
    rpmLimit: 10,
    rpdLimit: 1000,
    apiKeyEnv: 'TOGETHER_API_KEY',
    priority: 6,
    isAvailable: () => !!process.env.TOGETHER_API_KEY,
  },
  {
    name: 'huggingface',
    endpoint: 'https://api-inference.huggingface.co/models',
    models: ['meta-llama/Meta-Llama-3-8B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.2'],
    rpmLimit: 30,
    rpdLimit: 1000,
    apiKeyEnv: 'HUGGINGFACE_API_KEY',
    priority: 7,
    isAvailable: () => !!process.env.HUGGINGFACE_API_KEY,
  },
  {
    name: 'cerebras',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
    models: ['llama3.1-8b', 'llama3.1-70b'],
    rpmLimit: 30,
    rpdLimit: 1000,
    apiKeyEnv: 'CEREBRAS_API_KEY',
    priority: 8,
    isAvailable: () => !!process.env.CEREBRAS_API_KEY,
  },
  {
    name: 'sambanova',
    endpoint: 'https://api.sambanova.ai/v1/chat/completions',
    models: [
      'Meta-Llama-3.1-8B-Instruct',
      'Meta-Llama-3.1-70B-Instruct',
      'DeepSeek-V3-32K',
      'DeepSeek-chat',
      'DeepSeek-coder',
      'Mistral-large'
    ],
    rpmLimit: 20,
    rpdLimit: 500,
    apiKeyEnv: 'SAMBANOVA_API_KEY',
    priority: 9,
    isAvailable: () => !!process.env.SAMBANOVA_API_KEY,
  },
];

class GeigerRateLimiter {
  private readings: Map<string, GeigerReading> = new Map();
  private rotationIndex: number = 0;
  private lastRotation: number = Date.now();
  
  // Geiger counter constants
  private readonly DECAY_RATE = 0.95;           // Radiation decays by 5% per second
  private readonly SPIKE_MULTIPLIER = 15;       // Each request adds this much radiation
  private readonly CONSECUTIVE_MULTIPLIER = 2;   // Multiplier for consecutive hits
  private readonly HEALTH_RECOVERY_RATE = 5;    // Health recovers 5 points per minute
  private readonly COOLDOWN_BASE_MS = 60000;    // Base cooldown: 1 minute
  private readonly COOLDOWN_MAX_MS = 300000;    // Max cooldown: 5 minutes
  private readonly RADIATION_THRESHOLD = 70;    // Skip provider if radiation > 70
  private readonly CRITICAL_RADIATION = 90;     // Force cooldown if radiation > 90

  constructor() {
    // Initialize readings for all providers
    for (const provider of FREE_PROVIDERS) {
      this.initializeReading(provider.name);
    }
    
    // Start decay timer
    this.startDecayLoop();
    
    console.log('[Geiger3D] Rate limiter initialized with', FREE_PROVIDERS.length, 'providers');
    console.log('[Geiger3D] Available providers:', this.getAvailableProviders().map(p => p.name).join(', '));
  }

  private initializeReading(providerName: string): void {
    this.readings.set(providerName, {
      radiation: 0,
      decayRate: this.DECAY_RATE,
      lastSpike: 0,
      consecutiveHits: 0,
      healthScore: 100,
      cooldownUntil: 0,
      dailyUsage: 0,
      minuteUsage: 0,
      lastMinuteReset: Date.now(),
      lastDailyReset: Date.now(),
      failures: 0,
      lastFailure: 0,
    });
  }

  private startDecayLoop(): void {
    // Decay radiation every second
    setInterval(() => {
      const now = Date.now();
      
      this.readings.forEach((reading, name) => {
        // Exponential decay of radiation
        if (reading.radiation > 0) {
          reading.radiation *= reading.decayRate;
          if (reading.radiation < 0.1) reading.radiation = 0;
        }
        
        // Reset consecutive hits if no activity for 5 seconds
        if (now - reading.lastSpike > 5000) {
          reading.consecutiveHits = 0;
        }
        
        // Recover health over time (if not in cooldown)
        if (reading.healthScore < 100 && now > reading.cooldownUntil) {
          reading.healthScore = Math.min(100, reading.healthScore + (this.HEALTH_RECOVERY_RATE / 60));
        }
        
        // Reset minute counter
        if (now - reading.lastMinuteReset >= 60000) {
          reading.minuteUsage = 0;
          reading.lastMinuteReset = now;
        }
        
        // Reset daily counter at UTC midnight
        const lastResetDate = new Date(reading.lastDailyReset).toISOString().split('T')[0];
        const todayDate = new Date().toISOString().split('T')[0];
        if (lastResetDate !== todayDate) {
          reading.dailyUsage = 0;
          reading.lastDailyReset = now;
          reading.radiation = 0; // Fresh start each day
          reading.healthScore = 100;
          console.log(`[Geiger3D] Daily reset for ${name}`);
        }
      });
    }, 1000);
  }

  /**
   * Get all available providers (have API keys configured)
   */
  private getAvailableProviders(): ProviderConfig[] {
    return FREE_PROVIDERS.filter(p => p.isAvailable());
  }

  /**
   * Get healthy providers (available + not in cooldown + low radiation)
   */
  private getHealthyProviders(): ProviderConfig[] {
    const now = Date.now();
    return this.getAvailableProviders().filter(provider => {
      const reading = this.readings.get(provider.name);
      if (!reading) return false;
      
      // Check cooldown
      if (now < reading.cooldownUntil) return false;
      
      // Check radiation level
      if (reading.radiation > this.RADIATION_THRESHOLD) return false;
      
      // Check daily limit
      if (reading.dailyUsage >= provider.rpdLimit * 0.95) return false;
      
      // Check minute limit
      if (reading.minuteUsage >= provider.rpmLimit * 0.9) return false;
      
      // Check health
      if (reading.healthScore < 20) return false;
      
      return true;
    });
  }

  /**
   * Calculate provider score for selection (lower = better)
   */
  private calculateProviderScore(provider: ProviderConfig): number {
    const reading = this.readings.get(provider.name);
    if (!reading) return Infinity;
    
    // 3D scoring: radiation × usage × inverse health
    const radiationFactor = reading.radiation / 100;
    const usageFactor = reading.dailyUsage / provider.rpdLimit;
    const healthFactor = 1 - (reading.healthScore / 100);
    const priorityFactor = provider.priority / 10;
    
    // Combined score (lower is better)
    return (radiationFactor * 0.4) + (usageFactor * 0.3) + (healthFactor * 0.2) + (priorityFactor * 0.1);
  }

  /**
   * Record a "click" (usage) on the Geiger counter
   */
  public recordClick(providerName: string): void {
    const reading = this.readings.get(providerName);
    if (!reading) return;
    
    const now = Date.now();
    const timeSinceLastSpike = now - reading.lastSpike;
    
    // Calculate radiation spike
    let spike = this.SPIKE_MULTIPLIER;
    
    // Consecutive hits multiply the spike (Geiger counter behavior)
    if (timeSinceLastSpike < 1000) {
      reading.consecutiveHits++;
      spike *= Math.pow(this.CONSECUTIVE_MULTIPLIER, Math.min(reading.consecutiveHits, 5));
    }
    
    // Add radiation
    reading.radiation = Math.min(100, reading.radiation + spike);
    reading.lastSpike = now;
    reading.dailyUsage++;
    reading.minuteUsage++;
    
    // Check for critical radiation - trigger cooldown
    if (reading.radiation >= this.CRITICAL_RADIATION) {
      const cooldownMs = Math.min(
        this.COOLDOWN_MAX_MS,
        this.COOLDOWN_BASE_MS * Math.pow(2, reading.failures)
      );
      reading.cooldownUntil = now + cooldownMs;
      reading.healthScore = Math.max(0, reading.healthScore - 20);
      console.log(`[Geiger3D] ⚠️ CRITICAL radiation on ${providerName} (${reading.radiation.toFixed(1)}) - cooldown ${cooldownMs/1000}s`);
    }
  }

  /**
   * Record a successful request
   */
  public recordSuccess(providerName: string): void {
    const reading = this.readings.get(providerName);
    if (!reading) return;
    
    // Success improves health slightly
    reading.healthScore = Math.min(100, reading.healthScore + 1);
    reading.failures = 0;
  }

  /**
   * Record a failed request
   */
  public recordFailure(providerName: string, error?: string): void {
    const reading = this.readings.get(providerName);
    if (!reading) return;
    
    const now = Date.now();
    reading.failures++;
    reading.lastFailure = now;
    reading.healthScore = Math.max(0, reading.healthScore - 15);
    
    // Spike radiation on failure
    reading.radiation = Math.min(100, reading.radiation + 30);
    
    // Calculate exponential backoff cooldown
    const cooldownMs = Math.min(
      this.COOLDOWN_MAX_MS,
      this.COOLDOWN_BASE_MS * Math.pow(2, Math.min(reading.failures, 5))
    );
    reading.cooldownUntil = now + cooldownMs;
    
    console.log(`[Geiger3D] ❌ Failure on ${providerName} (${reading.failures} consecutive) - cooldown ${cooldownMs/1000}s. Error: ${error || 'unknown'}`);
  }

  /**
   * Get the next provider in rotation (main entry point)
   */
  public getNextProvider(preferredModel?: string): RotationResult | null {
    const healthyProviders = this.getHealthyProviders();
    
    if (healthyProviders.length === 0) {
      // Emergency: No healthy providers - find the least bad one
      const available = this.getAvailableProviders();
      if (available.length === 0) {
        console.error('[Geiger3D] No AI providers available! Check API keys.');
        return null;
      }
      
      // Sort by score and pick the best
      const sorted = available.sort((a, b) => this.calculateProviderScore(a) - this.calculateProviderScore(b));
      const emergency = sorted[0];
      const reading = this.readings.get(emergency.name)!;
      
      console.warn(`[Geiger3D] ⚠️ Emergency fallback to ${emergency.name} (radiation: ${reading.radiation.toFixed(1)}, health: ${reading.healthScore.toFixed(1)})`);
      
      return {
        provider: emergency.name,
        model: emergency.models[0],
        endpoint: emergency.endpoint,
        apiKey: process.env[emergency.apiKeyEnv] || '',
        reason: 'emergency_fallback',
        geigerReading: reading,
        allReadings: this.readings,
      };
    }

    // Score all healthy providers
    const scored = healthyProviders.map(p => ({
      provider: p,
      score: this.calculateProviderScore(p),
      reading: this.readings.get(p.name)!,
    }));
    
    // Sort by score (lowest first)
    scored.sort((a, b) => a.score - b.score);
    
    // Weighted random selection from top 3 (adds variety)
    const topN = scored.slice(0, Math.min(3, scored.length));
    const totalWeight = topN.reduce((sum, item) => sum + (1 / (item.score + 0.1)), 0);
    let random = Math.random() * totalWeight;
    
    let selected = topN[0];
    for (const item of topN) {
      const weight = 1 / (item.score + 0.1);
      if (random < weight) {
        selected = item;
        break;
      }
      random -= weight;
    }
    
    // Record the click
    this.recordClick(selected.provider.name);
    
    // Select model (prefer model if specified and available)
    let model = selected.provider.models[0];
    if (preferredModel && selected.provider.models.includes(preferredModel)) {
      model = preferredModel;
    }
    
    console.log(`[Geiger3D] Selected ${selected.provider.name}/${model} (score: ${selected.score.toFixed(3)}, radiation: ${selected.reading.radiation.toFixed(1)}, health: ${selected.reading.healthScore.toFixed(1)})`);
    
    return {
      provider: selected.provider.name,
      model,
      endpoint: selected.provider.endpoint,
      apiKey: process.env[selected.provider.apiKeyEnv] || '',
      reason: 'optimal_selection',
      geigerReading: selected.reading,
      allReadings: this.readings,
    };
  }

  /**
   * Get current status of all providers
   */
  public getStatus(): Record<string, {
    available: boolean;
    radiation: number;
    health: number;
    dailyUsage: number;
    dailyLimit: number;
    minuteUsage: number;
    minuteLimit: number;
    inCooldown: boolean;
    cooldownRemaining: number;
  }> {
    const status: Record<string, any> = {};
    const now = Date.now();
    
    for (const provider of FREE_PROVIDERS) {
      const reading = this.readings.get(provider.name);
      status[provider.name] = {
        available: provider.isAvailable(),
        radiation: reading?.radiation ?? 0,
        health: reading?.healthScore ?? 0,
        dailyUsage: reading?.dailyUsage ?? 0,
        dailyLimit: provider.rpdLimit,
        minuteUsage: reading?.minuteUsage ?? 0,
        minuteLimit: provider.rpmLimit,
        inCooldown: reading ? now < reading.cooldownUntil : false,
        cooldownRemaining: reading ? Math.max(0, reading.cooldownUntil - now) : 0,
      };
    }
    
    return status;
  }

  /**
   * Get aggregate statistics
   */
  public getAggregateStats(): {
    totalAvailable: number;
    totalHealthy: number;
    averageRadiation: number;
    averageHealth: number;
    totalDailyUsage: number;
    totalDailyCapacity: number;
    utilizationPercent: number;
  } {
    const available = this.getAvailableProviders();
    const healthy = this.getHealthyProviders();
    
    let totalRadiation = 0;
    let totalHealth = 0;
    let totalDailyUsage = 0;
    let totalDailyCapacity = 0;
    
    for (const provider of available) {
      const reading = this.readings.get(provider.name);
      if (reading) {
        totalRadiation += reading.radiation;
        totalHealth += reading.healthScore;
        totalDailyUsage += reading.dailyUsage;
      }
      totalDailyCapacity += provider.rpdLimit;
    }
    
    return {
      totalAvailable: available.length,
      totalHealthy: healthy.length,
      averageRadiation: available.length > 0 ? totalRadiation / available.length : 0,
      averageHealth: available.length > 0 ? totalHealth / available.length : 0,
      totalDailyUsage,
      totalDailyCapacity,
      utilizationPercent: totalDailyCapacity > 0 ? (totalDailyUsage / totalDailyCapacity) * 100 : 0,
    };
  }

  /**
   * Force reset a specific provider (admin function)
   */
  public resetProvider(providerName: string): void {
    this.initializeReading(providerName);
    console.log(`[Geiger3D] Provider ${providerName} manually reset`);
  }

  /**
   * Force reset all providers (admin function)
   */
  public resetAll(): void {
    for (const provider of FREE_PROVIDERS) {
      this.initializeReading(provider.name);
    }
    console.log('[Geiger3D] All providers manually reset');
  }
}

// Singleton instance
export const geigerRateLimiter = new GeigerRateLimiter();

// Export provider configurations for external use
export { FREE_PROVIDERS };
