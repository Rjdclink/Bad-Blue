/**
 * PANTHEON Learning Systems - Zombie Hive Mind + Dark Magic AI
 * Intelligence and learning layer that enables zombies to learn from death and share knowledge globally
 */

import { PhylacterySystem, DeathMemory, AvoidanceStrategy, BrowserFingerprint } from '../storage/PhylacterySystem';

export interface DeathPatternAnalysis {
  target: string;
  totalDeaths: number;
  commonCauses: { cause: string; count: number; percentage: number }[];
  averageRequestsBeforeDeath: number;
  averageSessionAge: number;
  recommendedMaxRequests: number;
  recommendedDelay: { min: number; max: number };
  confidence: number;
}

export interface AvoidanceStrategyExtended extends AvoidanceStrategy {
  target: string;
  type: 'conservative' | 'moderate' | 'aggressive';
  rotateFingerprintEvery?: number;
  rotateIPEvery?: number;
  generation: number;
}

export interface EnhancedZombie {
  zombieId: string;
  generation: number;
  inheritedMemories: DeathMemory[];
  strategy: AvoidanceStrategyExtended;
  powerBoost: number;
  wisdom: number;
}

export interface AIAnalysis {
  target: string;
  bestTimeToAttack: string;
  bestUserAgents: string[];
  bestIPRegions: string[];
  successRate: number;
  sampleSize: number;
}

export interface EvolvedStrategy {
  name: string;
  parentStrategies: string[];
  mutations: string[];
  predictedSuccessRate: number;
}

export interface StrategyPerformance {
  strategyName: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  lastUsed: number;
}

export class ZombieHiveMind {
  private phylactery: PhylacterySystem;
  private deathCache = new Map<string, DeathMemory[]>();

  constructor(phylactery: PhylacterySystem) { this.phylactery = phylactery; }

  async recordDeath(memory: DeathMemory): Promise<void> {
    const dedupeKey = `${memory.target}:${memory.causeOfDeath}:${memory.triggerPattern}`;
    const existing = await this.findExistingDeath(dedupeKey);
    if (existing) {
      const updated = { ...existing, requestCount: existing.requestCount + 1, timestamp: Date.now() };
      await this.phylactery.recordDeath(updated);
    } else {
      await this.phylactery.recordDeath(memory);
    }
    this.deathCache.delete(memory.target);
  }

  private async findExistingDeath(dedupeKey: string): Promise<DeathMemory | null> {
    const [target] = dedupeKey.split(':');
    const deaths = await this.queryDeaths(target);
    return deaths.find(d => `${d.target}:${d.causeOfDeath}:${d.triggerPattern}` === dedupeKey) || null;
  }

  async queryDeaths(target: string): Promise<DeathMemory[]> {
    if (this.deathCache.has(target)) return this.deathCache.get(target)!;
    const deaths = await this.phylactery.queryDeaths(target) as DeathMemory[];
    this.deathCache.set(target, deaths);
    return deaths;
  }

  async analyzePatterns(target: string): Promise<DeathPatternAnalysis> {
    const deaths = await this.queryDeaths(target);
    if (deaths.length === 0) {
      return { target, totalDeaths: 0, commonCauses: [], averageRequestsBeforeDeath: 0, averageSessionAge: 0, recommendedMaxRequests: 20, recommendedDelay: { min: 2000, max: 5000 }, confidence: 0 };
    }
    const causeCounts = new Map<string, number>();
    deaths.forEach(d => causeCounts.set(d.causeOfDeath, (causeCounts.get(d.causeOfDeath) || 0) + 1));
    const commonCauses = Array.from(causeCounts.entries()).map(([cause, count]) => ({ cause, count, percentage: (count / deaths.length) * 100 })).sort((a, b) => b.count - a.count);
    const avgRequests = deaths.reduce((sum, d) => sum + d.requestCount, 0) / deaths.length;
    const avgSessionAge = deaths.reduce((sum, d) => sum + d.sessionAge, 0) / deaths.length;
    const avgDelayPerRequest = avgRequests > 0 ? avgSessionAge / avgRequests : 2000;
    return {
      target,
      totalDeaths: deaths.length,
      commonCauses,
      averageRequestsBeforeDeath: avgRequests,
      averageSessionAge: avgSessionAge,
      recommendedMaxRequests: Math.max(5, Math.floor(avgRequests * 0.7)),
      recommendedDelay: { min: Math.max(1000, Math.floor(avgDelayPerRequest * 0.8)), max: Math.max(2000, Math.floor(avgDelayPerRequest * 1.5)) },
      confidence: Math.min(1.0, deaths.length / 50)
    };
  }

  async generateStrategy(target: string): Promise<AvoidanceStrategyExtended> {
    const analysis = await this.analyzePatterns(target);
    if (analysis.totalDeaths === 0) return this.createStrategy(target, 'conservative', 1, analysis);
    const mostCommon = analysis.commonCauses[0];
    let strategyType: 'conservative' | 'moderate' | 'aggressive' = 'conservative';
    if (analysis.confidence >= 0.3 && analysis.totalDeaths <= 10) strategyType = 'aggressive';
    else if (analysis.confidence >= 0.3 && analysis.totalDeaths <= 20) strategyType = 'moderate';
    if (mostCommon && mostCommon.percentage > 70 && ['captcha', 'ip-ban', 'cloudflare'].includes(mostCommon.cause)) strategyType = 'conservative';
    return this.createStrategy(target, strategyType, 1, analysis);
  }

  private createStrategy(target: string, type: 'conservative' | 'moderate' | 'aggressive', generation: number, analysis: DeathPatternAnalysis): AvoidanceStrategyExtended {
    const config = {
      conservative: { maxReqMult: 1.0, minDelayMult: 1.0, maxDelayMult: 1.6, rotateFP: true, rotateIP: true, fpEvery: 5, ipEvery: 3 },
      moderate: { maxReqMult: 1.0, minDelayMult: 1.0, maxDelayMult: 1.0, rotateFP: true, rotateIP: false, fpEvery: 10, ipEvery: 0 },
      aggressive: { maxReqMult: 1.5, minDelayMult: 0.5, maxDelayMult: 1.0, rotateFP: false, rotateIP: false, fpEvery: 0, ipEvery: 0 }
    }[type];
    return {
      name: `${type}-${target}-gen${generation}`,
      target,
      type,
      maxRequests: Math.floor((analysis.recommendedMaxRequests || 10) * config.maxReqMult),
      minDelay: Math.floor((analysis.recommendedDelay?.min || 3000) * config.minDelayMult),
      maxDelay: Math.floor((analysis.recommendedDelay?.max || 8000) * config.maxDelayMult),
      rotateFingerprint: config.rotateFP,
      rotateFingerprintEvery: config.fpEvery > 0 ? config.fpEvery : undefined,
      rotateIP: config.rotateIP,
      rotateIPEvery: config.ipEvery > 0 ? config.ipEvery : undefined,
      useGhostInstead: false,
      confidence: analysis.confidence,
      generation
    };
  }

  async resurrectZombie(target: string, generation: number): Promise<EnhancedZombie> {
    const inheritedMemories = await this.queryDeaths(target);
    const strategy = await this.generateStrategy(target);
    strategy.generation = generation;
    return {
      zombieId: `zombie-${target}-gen${generation}-${Date.now()}`,
      generation,
      inheritedMemories,
      strategy,
      powerBoost: Math.min(2.0, 1.0 + (generation * 0.1)),
      wisdom: Math.min(100, inheritedMemories.length * 2)
    };
  }

  mutateFingerprint(old: BrowserFingerprint): BrowserFingerprint {
    const userAgents = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'];
    const platforms = ['Win32', 'MacIntel', 'Linux x86_64'];
    const timezones = ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo'];
    return {
      userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
      platform: platforms[Math.floor(Math.random() * platforms.length)],
      vendor: old.vendor,
      languages: old.languages,
      screenResolution: old.screenResolution,
      timezone: timezones[Math.floor(Math.random() * timezones.length)]
    };
  }
}

export class DarkMagicAI {
  private phylactery: PhylacterySystem;
  private strategies = new Map<string, StrategyPerformance>();

  constructor(phylactery: PhylacterySystem) { this.phylactery = phylactery; }

  async analyzeTarget(target: string): Promise<AIAnalysis> {
    const deaths = await this.phylactery.queryDeaths(target) as DeathMemory[];
    if (deaths.length === 0) {
      return { target, bestTimeToAttack: 'morning', bestUserAgents: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'], bestIPRegions: ['US-East'], successRate: 0, sampleSize: 0 };
    }
    const hourCounts = new Map<string, number>();
    deaths.forEach(d => {
      const hour = new Date(d.timestamp).getHours();
      const period = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'night';
      hourCounts.set(period, (hourCounts.get(period) || 0) + 1);
    });
    const bestTime = Array.from(hourCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'morning';
    const agentCounts = new Map<string, number>();
    deaths.forEach(d => agentCounts.set(d.userAgent, (agentCounts.get(d.userAgent) || 0) + 1));
    const bestAgents = Array.from(agentCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([agent]) => agent);
    const failedRequests = deaths.reduce((sum, d) => sum + d.requestCount, 0);
    const estimatedTotal = failedRequests * 1.5;
    const successRate = Math.max(0, (estimatedTotal - failedRequests) / estimatedTotal);
    return {
      target,
      bestTimeToAttack: bestTime,
      bestUserAgents: bestAgents.length > 0 ? bestAgents : ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)'],
      bestIPRegions: ['US-East', 'US-West', 'EU-Central'],
      successRate,
      sampleSize: deaths.length
    };
  }

  async evolveStrategy(target: string): Promise<EvolvedStrategy> {
    const analysis = await this.analyzeTarget(target);
    const existing = Array.from(this.strategies.values()).filter(s => s.strategyName.includes(target));
    if (existing.length === 0) {
      return { name: `initial-${target}-${Date.now()}`, parentStrategies: [], mutations: ['conservative-approach'], predictedSuccessRate: 0.5 };
    }
    const parents = existing.sort((a, b) => b.successRate - a.successRate).slice(0, 2);
    const mutations: string[] = [];
    if (analysis.successRate < 0.5) {
      mutations.push('increase-delay', 'rotate-fingerprint');
    }
    if (analysis.sampleSize > 10) {
      mutations.push('use-best-time', 'use-best-user-agent');
    }
    const avgParentRate = parents.reduce((sum, p) => sum + p.successRate, 0) / parents.length;
    const predictedRate = Math.min(1.0, avgParentRate + mutations.length * 0.05);
    return {
      name: `evolved-${target}-${Date.now()}`,
      parentStrategies: parents.map(p => p.strategyName),
      mutations,
      predictedSuccessRate: predictedRate
    };
  }

  async trackPerformance(strategy: string, success: boolean): Promise<void> {
    const existing = this.strategies.get(strategy);
    if (existing) {
      existing.attempts++;
      if (success) existing.successes++; else existing.failures++;
      existing.successRate = existing.successes / existing.attempts;
      existing.lastUsed = Date.now();
    } else {
      this.strategies.set(strategy, {
        strategyName: strategy,
        attempts: 1,
        successes: success ? 1 : 0,
        failures: success ? 0 : 1,
        successRate: success ? 1.0 : 0.0,
        lastUsed: Date.now()
      });
    }
  }

  async getBestStrategy(target: string): Promise<StrategyPerformance | null> {
    const targetStrategies = Array.from(this.strategies.values()).filter(s => s.strategyName.includes(target));
    if (targetStrategies.length === 0) return null;
    return targetStrategies.sort((a, b) => b.successRate - a.successRate)[0];
  }
}
