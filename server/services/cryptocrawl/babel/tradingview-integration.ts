/**
 * TradingView Integration
 * 
 * Integrates TradingView technical analysis into the faucet system
 * for optimization of crawler behavior based on market signals.
 * 
 * Uses TradingView's technical analysis signals to:
 * 1. Optimize entry/exit timing
 * 2. Adjust crawler aggressiveness
 * 3. Filter opportunities based on technical indicators
 */

import logger from '../../../logger.js';
import crypto from 'crypto';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';

export type TradingSignal = 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';

export interface TechnicalIndicator {
  name: string;
  value: number;
  signal: TradingSignal;
  weight: number;
}

export interface OscillatorIndicators {
  rsi: number;
  stochK: number;
  stochD: number;
  cci: number;
  adx: number;
  awesome: number;
  momentum: number;
  macd: {
    value: number;
    signal: number;
    histogram: number;
  };
  williamsR: number;
  ultimateOsc: number;
}

export interface MovingAverages {
  ema5: number;
  ema10: number;
  ema20: number;
  ema50: number;
  ema100: number;
  ema200: number;
  sma5: number;
  sma10: number;
  sma20: number;
  sma50: number;
  sma100: number;
  sma200: number;
  ichimoku: {
    conversionLine: number;
    baseLine: number;
    leadingSpanA: number;
    leadingSpanB: number;
  };
  vwma: number;
  hull: number;
}

export interface TechnicalAnalysis {
  symbol: string;
  timestamp: number;
  dataProvenance: 'live' | 'cached' | 'deterministic-fallback';
  sourceTimestamp: number;
  oscillators: {
    summary: TradingSignal;
    indicators: OscillatorIndicators;
    buyCount: number;
    sellCount: number;
    neutralCount: number;
  };
  movingAverages: {
    summary: TradingSignal;
    indicators: MovingAverages;
    buyCount: number;
    sellCount: number;
    neutralCount: number;
  };
  summary: {
    signal: TradingSignal;
    recommendation: string;
    strength: number;
  };
  pivotPoints: {
    classic: PivotLevels;
    fibonacci: PivotLevels;
    camarilla: PivotLevels;
  };
}

export interface PivotLevels {
  pivot: number;
  support1: number;
  support2: number;
  support3: number;
  resistance1: number;
  resistance2: number;
  resistance3: number;
}

export interface CrawlerOptimization {
  aggressiveness: number;
  positionSize: number;
  entryThreshold: number;
  exitThreshold: number;
  riskMultiplier: number;
  preferredTimeframe: string;
}

export interface TradingViewHealthStatus {
  liveEnabled: boolean;
  degraded: boolean;
  consecutiveLiveFailures: number;
  circuitOpenUntil: number;
  lastLiveSuccessAt: number | null;
  lastLiveFailureAt: number | null;
  lastLiveFailureReason?: string;
  mode: 'live' | 'degraded' | 'simulated';
}

const TRADINGVIEW_CONFIG = {
  defaultSymbol: 'BTCUSDT',
  defaultExchange: 'BINANCE',
  updateInterval: 60000,
  cacheTtlMs: Number(process.env.TRADINGVIEW_CACHE_TTL_MS || 60000),
  minRequestIntervalMs: Number(process.env.TRADINGVIEW_MIN_INTERVAL_MS || 1250),
  liveEnabled: process.env.TRADINGVIEW_LIVE_ENABLED !== 'false',
  scannerEndpoint: process.env.TRADINGVIEW_SCANNER_ENDPOINT || 'https://scanner.tradingview.com/crypto/scan',
  liveCircuitFailureThreshold: Number(process.env.TRADINGVIEW_LIVE_CIRCUIT_FAILURE_THRESHOLD || 3),
  liveCircuitCooldownMs: Number(process.env.TRADINGVIEW_LIVE_CIRCUIT_COOLDOWN_MS || 60000),
  signalWeights: {
    oscillators: 0.4,
    movingAverages: 0.6,
  },
  timeframes: ['1m', '5m', '15m', '1h', '4h', '1d'],
  supportedPairs: [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT', 'LINKUSDT',
  ],
};

export class TradingViewEngine {
  private static analysisCache = new Map<string, TechnicalAnalysis>();
  private static optimizationProfiles = new Map<string, CrawlerOptimization>();
  private static inFlightAnalysis = new Map<string, Promise<TechnicalAnalysis>>();
  private static requestQueue: Promise<void> = Promise.resolve();
  private static lastRequestAt = 0;
  private static updateInterval: NodeJS.Timeout | null = null;
  private static isActive = false;
  private static consecutiveLiveFailures = 0;
  private static liveCircuitOpenUntil = 0;
  private static lastLiveSuccessAt: number | null = null;
  private static lastLiveFailureAt: number | null = null;
  private static lastLiveFailureReason: string | undefined;

  private static isLiveCircuitOpen(): boolean {
    return Date.now() < this.liveCircuitOpenUntil;
  }

  private static registerLiveSuccess(): void {
    this.consecutiveLiveFailures = 0;
    this.liveCircuitOpenUntil = 0;
    this.lastLiveSuccessAt = Date.now();
    this.lastLiveFailureReason = undefined;
  }

  private static registerLiveFailure(error: unknown, symbol: string, timeframe: string): void {
    this.consecutiveLiveFailures += 1;
    this.lastLiveFailureAt = Date.now();
    this.lastLiveFailureReason = error instanceof Error ? error.message : String(error);

    if (this.consecutiveLiveFailures >= TRADINGVIEW_CONFIG.liveCircuitFailureThreshold) {
      this.liveCircuitOpenUntil = Date.now() + TRADINGVIEW_CONFIG.liveCircuitCooldownMs;
      logger.warn('[TRADINGVIEW] Live circuit opened after consecutive failures', {
        component: 'TradingView',
        failures: this.consecutiveLiveFailures,
        cooldownMs: TRADINGVIEW_CONFIG.liveCircuitCooldownMs,
        symbol,
        timeframe,
        reason: this.lastLiveFailureReason,
      });
    }
  }

  static initialize(): void {
    if (this.isActive) {
      logger.debug('[TRADINGVIEW] Engine already active', { component: 'TradingView' });
      return;
    }

    this.updateInterval = setInterval(() => {
      this.updateAllAnalysis();
    }, TRADINGVIEW_CONFIG.updateInterval);

    this.isActive = true;

    logger.info('[TRADINGVIEW] 📊 TradingView integration initialized', {
      component: 'TradingView',
      pairs: TRADINGVIEW_CONFIG.supportedPairs.length,
      timeframes: TRADINGVIEW_CONFIG.timeframes.length,
    });
  }

  static async getAnalysis(
    symbol: string = TRADINGVIEW_CONFIG.defaultSymbol,
    _timeframe: string = '1h'
  ): Promise<TechnicalAnalysis> {
    const cacheKey = `${symbol}-${_timeframe}`;
    const cached = this.analysisCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < TRADINGVIEW_CONFIG.cacheTtlMs) {
      return { ...cached };
    }

    const inFlight = this.inFlightAnalysis.get(cacheKey);
    if (inFlight) return inFlight;

    const request = (async () => {
      if (TRADINGVIEW_CONFIG.liveEnabled && !this.isLiveCircuitOpen()) {
        try {
          const live = await this.fetchLiveAnalysis(symbol, _timeframe);
          this.registerLiveSuccess();
          this.analysisCache.set(cacheKey, live);
          logger.info('[TRADINGVIEW] Live fetch succeeded', {
            component: 'TradingView',
            symbol: live.symbol,
            providerSymbol: `${TRADINGVIEW_CONFIG.defaultExchange}:${this.mapSymbol(symbol)}`,
            timeframe: _timeframe,
            sourceTimestamp: live.sourceTimestamp,
          });
          return live;
        } catch (error) {
          this.registerLiveFailure(error, symbol, _timeframe);
          logger.warn('[TRADINGVIEW] Live fetch failed, using deterministic fallback', {
            component: 'TradingView',
            symbol,
            timeframe: _timeframe,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else if (TRADINGVIEW_CONFIG.liveEnabled && this.isLiveCircuitOpen()) {
        logger.debug('[TRADINGVIEW] Live circuit open; using fallback mode', {
          component: 'TradingView',
          symbol,
          timeframe: _timeframe,
          circuitOpenUntil: this.liveCircuitOpenUntil,
        });
      }

      const simulated = this.generateAnalysis(symbol);
      this.analysisCache.set(cacheKey, simulated);
      return simulated;
    })().finally(() => this.inFlightAnalysis.delete(cacheKey));

    this.inFlightAnalysis.set(cacheKey, request);
    return request;
  }

  private static mapInterval(timeframe: string): string {
    switch (timeframe) {
      case '1m': return '1';
      case '5m': return '5';
      case '15m': return '15';
      case '1h': return '60';
      case '4h': return '240';
      case '1d':
      default: return '1D';
    }
  }

  private static mapSymbol(symbol: string): string {
    const aliases: Record<string, string> = { MATICUSDT: 'POLUSDT' };
    return aliases[symbol.toUpperCase()] || symbol.toUpperCase();
  }

  private static async queueRateLimitedRequest<T>(task: () => Promise<T>): Promise<T> {
    const run = this.requestQueue.then(async () => {
      const elapsed = Date.now() - this.lastRequestAt;
      if (elapsed < TRADINGVIEW_CONFIG.minRequestIntervalMs) {
        await new Promise(resolve => setTimeout(resolve, TRADINGVIEW_CONFIG.minRequestIntervalMs - elapsed));
      }
      const result = await task();
      this.lastRequestAt = Date.now();
      return result;
    });
    this.requestQueue = run.then(() => undefined).catch(() => undefined);
    return run;
  }

  private static mapRecommendationToSignal(recommendation: number): TradingSignal {
    if (recommendation >= 0.5) return 'strong_buy';
    if (recommendation >= 0.1) return 'buy';
    if (recommendation <= -0.5) return 'strong_sell';
    if (recommendation <= -0.1) return 'sell';
    return 'neutral';
  }

  private static async fetchLiveAnalysis(symbol: string, timeframe: string): Promise<TechnicalAnalysis> {
    const interval = this.mapInterval(timeframe);
    const ticker = `${TRADINGVIEW_CONFIG.defaultExchange}:${this.mapSymbol(symbol)}`;
    const cols = [
      'Recommend.All', 'RSI', 'Stoch.K', 'Stoch.D', 'CCI20', 'ADX', 'AO', 'Mom',
      'MACD.macd', 'MACD.signal', 'W.R', 'UO',
      'EMA5', 'EMA10', 'EMA20', 'EMA50', 'EMA100', 'EMA200',
      'SMA5', 'SMA10', 'SMA20', 'SMA50', 'SMA100', 'SMA200',
      'Ichimoku.BLine', 'VWMA', 'HullMA9', 'close',
    ].map(column => `${column}|${interval}`);

    const body = { symbols: { tickers: [ticker], query: { types: [] as string[] } }, columns: cols };

    return this.queueRateLimitedRequest(async () => {
      const payload = await fetchJsonWithRetry<any>(TRADINGVIEW_CONFIG.scannerEndpoint, {
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        },
        maxRetries: 4,
        baseDelayMs: 600,
        maxDelayMs: 12000,
        timeoutMs: 10000,
      });

      const row = payload?.data?.[0]?.d;
      if (!Array.isArray(row) || row.length < cols.length) throw new Error('Unexpected TradingView payload shape');
      if (!row.slice(0, cols.length).every(value => typeof value === 'number' && Number.isFinite(value))) {
        throw new Error('TradingView payload contains incomplete indicator data');
      }

      const toNumber = (value: unknown, fallback: number = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
      const recommendAll = toNumber(row[0], 0);
      const closePrice = Math.max(1, toNumber(row[27], 1));
      const oscillators: OscillatorIndicators = {
        rsi: toNumber(row[1], 50), stochK: toNumber(row[2], 50), stochD: toNumber(row[3], 50),
        cci: toNumber(row[4], 0), adx: toNumber(row[5], 20), awesome: toNumber(row[6], 0), momentum: toNumber(row[7], 0),
        macd: { value: toNumber(row[8], 0), signal: toNumber(row[9], 0), histogram: toNumber(row[8], 0) - toNumber(row[9], 0) },
        williamsR: toNumber(row[10], -50), ultimateOsc: toNumber(row[11], 50),
      };
      const movingAverages: MovingAverages = {
        ema5: toNumber(row[12], closePrice), ema10: toNumber(row[13], closePrice), ema20: toNumber(row[14], closePrice),
        ema50: toNumber(row[15], closePrice), ema100: toNumber(row[16], closePrice), ema200: toNumber(row[17], closePrice),
        sma5: toNumber(row[18], closePrice), sma10: toNumber(row[19], closePrice), sma20: toNumber(row[20], closePrice),
        sma50: toNumber(row[21], closePrice), sma100: toNumber(row[22], closePrice), sma200: toNumber(row[23], closePrice),
        ichimoku: { conversionLine: toNumber(row[24], closePrice), baseLine: toNumber(row[24], closePrice), leadingSpanA: toNumber(row[24], closePrice), leadingSpanB: toNumber(row[24], closePrice) },
        vwma: toNumber(row[25], closePrice), hull: toNumber(row[26], closePrice),
      };
      const oscillatorSignals = this.analyzeOscillators(oscillators);
      const maSignals = this.analyzeMovingAverages(movingAverages);
      const fallbackSummary = this.calculateSummary(oscillatorSignals, maSignals);
      const mappedSignal = this.mapRecommendationToSignal(recommendAll);
      const summary = { signal: mappedSignal, recommendation: fallbackSummary.recommendation, strength: Math.min(100, Math.round(Math.abs(recommendAll) * 100)) };
      const pivotPoints = this.generatePivotPointsFromBasePrice(closePrice, Math.max(0.5, Math.abs(recommendAll) + 0.8));
      const now = Date.now();
      const analysis: TechnicalAnalysis = {
        symbol,
        timestamp: now,
        dataProvenance: 'live',
        sourceTimestamp: now,
        oscillators: { summary: oscillatorSignals.signal, indicators: oscillators, buyCount: oscillatorSignals.buyCount, sellCount: oscillatorSignals.sellCount, neutralCount: oscillatorSignals.neutralCount },
        movingAverages: { summary: maSignals.signal, indicators: movingAverages, buyCount: maSignals.buyCount, sellCount: maSignals.sellCount, neutralCount: maSignals.neutralCount },
        summary,
        pivotPoints,
      };
      logger.debug('[TRADINGVIEW] Live analysis fetched', { component: 'TradingView', symbol, signal: summary.signal, strength: summary.strength });
      return analysis;
    });
  }

  private static generateAnalysis(symbol: string): TechnicalAnalysis {
    const symbolHash = symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const timeBucket = Math.floor(Date.now() / 60000);
    const seedValue = (symbolHash * 31) + timeBucket;
    const seededRandom = this.createSeededRandom(seedValue);
    const oscillators = this.generateOscillators(seededRandom);
    const oscillatorSignals = this.analyzeOscillators(oscillators);
    const movingAverages = this.generateMovingAverages(seededRandom);
    const maSignals = this.analyzeMovingAverages(movingAverages);
    const summary = this.calculateSummary(oscillatorSignals, maSignals);
    const pivotPoints = this.generatePivotPoints(seededRandom);
    const now = Date.now();
    const analysis: TechnicalAnalysis = {
      symbol,
      timestamp: now,
      dataProvenance: 'deterministic-fallback',
      sourceTimestamp: now,
      oscillators: { summary: oscillatorSignals.signal, indicators: oscillators, buyCount: oscillatorSignals.buyCount, sellCount: oscillatorSignals.sellCount, neutralCount: oscillatorSignals.neutralCount },
      movingAverages: { summary: maSignals.signal, indicators: movingAverages, buyCount: maSignals.buyCount, sellCount: maSignals.sellCount, neutralCount: maSignals.neutralCount },
      summary,
      pivotPoints,
    };
    logger.debug('[TRADINGVIEW] Analysis generated', { component: 'TradingView', symbol, signal: summary.signal, strength: summary.strength });
    return analysis;
  }

  private static createSeededRandom(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  }

  private static generateOscillators(random: () => number): OscillatorIndicators {
    return {
      rsi: random() * 100,
      stochK: random() * 100,
      stochD: random() * 100,
      cci: (random() - 0.5) * 400,
      adx: random() * 100,
      awesome: (random() - 0.5) * 200,
      momentum: (random() - 0.5) * 50,
      macd: { value: (random() - 0.5) * 100, signal: (random() - 0.5) * 100, histogram: (random() - 0.5) * 50 },
      williamsR: -random() * 100,
      ultimateOsc: random() * 100,
    };
  }

  private static analyzeOscillators(osc: OscillatorIndicators): { signal: TradingSignal; buyCount: number; sellCount: number; neutralCount: number } {
    let buyCount = 0, sellCount = 0, neutralCount = 0;
    if (osc.rsi < 30) buyCount++; else if (osc.rsi > 70) sellCount++; else neutralCount++;
    if (osc.stochK < 20) buyCount++; else if (osc.stochK > 80) sellCount++; else neutralCount++;
    if (osc.cci < -100) buyCount++; else if (osc.cci > 100) sellCount++; else neutralCount++;
    if (osc.macd.histogram > 0) buyCount++; else if (osc.macd.histogram < 0) sellCount++; else neutralCount++;
    if (osc.williamsR < -80) buyCount++; else if (osc.williamsR > -20) sellCount++; else neutralCount++;
    const total = buyCount + sellCount + neutralCount;
    const buyRatio = buyCount / total, sellRatio = sellCount / total;
    const signal: TradingSignal = buyRatio > 0.6 ? (buyRatio > 0.8 ? 'strong_buy' : 'buy') : sellRatio > 0.6 ? (sellRatio > 0.8 ? 'strong_sell' : 'sell') : 'neutral';
    return { signal, buyCount, sellCount, neutralCount };
  }

  private static generateMovingAverages(random: () => number): MovingAverages {
    const basePrice = 40000 + random() * 5000;
    return {
      ema5: basePrice * (0.99 + random() * 0.02), ema10: basePrice * (0.985 + random() * 0.03), ema20: basePrice * (0.98 + random() * 0.04),
      ema50: basePrice * (0.97 + random() * 0.06), ema100: basePrice * (0.96 + random() * 0.08), ema200: basePrice * (0.95 + random() * 0.1),
      sma5: basePrice * (0.99 + random() * 0.02), sma10: basePrice * (0.985 + random() * 0.03), sma20: basePrice * (0.98 + random() * 0.04),
      sma50: basePrice * (0.97 + random() * 0.06), sma100: basePrice * (0.96 + random() * 0.08), sma200: basePrice * (0.95 + random() * 0.1),
      ichimoku: { conversionLine: basePrice * (0.99 + random() * 0.02), baseLine: basePrice * (0.985 + random() * 0.03), leadingSpanA: basePrice * (0.98 + random() * 0.04), leadingSpanB: basePrice * (0.97 + random() * 0.06) },
      vwma: basePrice * (0.995 + random() * 0.01), hull: basePrice * (0.998 + random() * 0.004),
    };
  }

  private static analyzeMovingAverages(ma: MovingAverages): { signal: TradingSignal; buyCount: number; sellCount: number; neutralCount: number } {
    let buyCount = 0, sellCount = 0, neutralCount = 0;
    const currentPrice = ma.hull;
    for (const maValue of [ma.ema20, ma.ema50, ma.ema200, ma.sma20, ma.sma50, ma.sma200]) {
      if (currentPrice > maValue * 1.01) buyCount++; else if (currentPrice < maValue * 0.99) sellCount++; else neutralCount++;
    }
    const total = buyCount + sellCount + neutralCount;
    const buyRatio = buyCount / total, sellRatio = sellCount / total;
    const signal: TradingSignal = buyRatio > 0.6 ? (buyRatio > 0.8 ? 'strong_buy' : 'buy') : sellRatio > 0.6 ? (sellRatio > 0.8 ? 'strong_sell' : 'sell') : 'neutral';
    return { signal, buyCount, sellCount, neutralCount };
  }

  private static calculateSummary(
    oscillatorSignals: { signal: TradingSignal; buyCount: number; sellCount: number },
    maSignals: { signal: TradingSignal; buyCount: number; sellCount: number }
  ): { signal: TradingSignal; recommendation: string; strength: number } {
    const signalValues: Record<TradingSignal, number> = { strong_buy: 2, buy: 1, neutral: 0, sell: -1, strong_sell: -2 };
    const weightedScore = signalValues[oscillatorSignals.signal] * TRADINGVIEW_CONFIG.signalWeights.oscillators + signalValues[maSignals.signal] * TRADINGVIEW_CONFIG.signalWeights.movingAverages;
    const signal: TradingSignal = weightedScore > 1.5 ? 'strong_buy' : weightedScore > 0.5 ? 'buy' : weightedScore > -0.5 ? 'neutral' : weightedScore > -1.5 ? 'sell' : 'strong_sell';
    const strength = Math.min(100, Math.abs(weightedScore) * 50);
    const recommendations: Record<TradingSignal, string> = {
      strong_buy: 'Strongly bullish - Crawlers should be aggressive',
      buy: 'Bullish - Favorable conditions for execution',
      neutral: 'Mixed signals - Exercise caution',
      sell: 'Bearish - Reduce exposure',
      strong_sell: 'Strongly bearish - Minimize activity',
    };
    return { signal, recommendation: recommendations[signal], strength };
  }

  private static generatePivotPoints(random: () => number): { classic: PivotLevels; fibonacci: PivotLevels; camarilla: PivotLevels } {
    const basePrice = 40000 + random() * 5000;
    const generateLevels = (volatilityFactor: number): PivotLevels => ({
      pivot: basePrice,
      support1: basePrice * (1 - 0.01 * volatilityFactor), support2: basePrice * (1 - 0.02 * volatilityFactor), support3: basePrice * (1 - 0.03 * volatilityFactor),
      resistance1: basePrice * (1 + 0.01 * volatilityFactor), resistance2: basePrice * (1 + 0.02 * volatilityFactor), resistance3: basePrice * (1 + 0.03 * volatilityFactor),
    });
    return { classic: generateLevels(1), fibonacci: generateLevels(0.618), camarilla: generateLevels(0.382) };
  }

  private static generatePivotPointsFromBasePrice(basePrice: number, volatilityFactor: number): { classic: PivotLevels; fibonacci: PivotLevels; camarilla: PivotLevels } {
    const generateLevels = (factor: number): PivotLevels => ({
      pivot: basePrice,
      support1: basePrice * (1 - 0.01 * factor), support2: basePrice * (1 - 0.02 * factor), support3: basePrice * (1 - 0.03 * factor),
      resistance1: basePrice * (1 + 0.01 * factor), resistance2: basePrice * (1 + 0.02 * factor), resistance3: basePrice * (1 + 0.03 * factor),
    });
    return { classic: generateLevels(volatilityFactor), fibonacci: generateLevels(0.618 * volatilityFactor), camarilla: generateLevels(0.382 * volatilityFactor) };
  }

  static getOptimization(crawlerId: string, analysis: TechnicalAnalysis): CrawlerOptimization {
    const signalMultipliers: Record<TradingSignal, number> = { strong_buy: 1.5, buy: 1.2, neutral: 1.0, sell: 0.8, strong_sell: 0.5 };
    const multiplier = signalMultipliers[analysis.summary.signal];
    const optimization: CrawlerOptimization = {
      aggressiveness: Math.min(1, (analysis.summary.strength / 100) * multiplier),
      positionSize: multiplier,
      entryThreshold: analysis.summary.signal.includes('buy') ? 0.3 : 0.7,
      exitThreshold: analysis.summary.signal.includes('sell') ? 0.3 : 0.7,
      riskMultiplier: 2 - multiplier,
      preferredTimeframe: this.selectTimeframe(analysis),
    };
    this.optimizationProfiles.set(crawlerId, optimization);
    return optimization;
  }

  private static selectTimeframe(analysis: TechnicalAnalysis): string {
    if (analysis.summary.strength > 75) return '5m';
    if (analysis.summary.strength > 50) return '15m';
    if (analysis.summary.strength > 25) return '1h';
    return '4h';
  }

  private static async updateAllAnalysis(): Promise<void> {
    for (const symbol of TRADINGVIEW_CONFIG.supportedPairs) {
      try {
        await this.getAnalysis(symbol);
      } catch (error) {
        logger.warn('[TRADINGVIEW] Failed to update analysis', { component: 'TradingView', symbol, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  static getSupportedPairs(): string[] {
    return [...TRADINGVIEW_CONFIG.supportedPairs];
  }

  static shouldAct(signal: TradingSignal): boolean {
    return signal !== 'neutral';
  }

  static getHealthStatus(): TradingViewHealthStatus {
    const mode: TradingViewHealthStatus['mode'] = !TRADINGVIEW_CONFIG.liveEnabled
      ? 'simulated'
      : (this.isLiveCircuitOpen() || this.consecutiveLiveFailures > 0) ? 'degraded' : 'live';
    return {
      liveEnabled: TRADINGVIEW_CONFIG.liveEnabled,
      degraded: mode !== 'live',
      consecutiveLiveFailures: this.consecutiveLiveFailures,
      circuitOpenUntil: this.liveCircuitOpenUntil,
      lastLiveSuccessAt: this.lastLiveSuccessAt,
      lastLiveFailureAt: this.lastLiveFailureAt,
      lastLiveFailureReason: this.lastLiveFailureReason,
      mode,
    };
  }

  static async checkReadiness(options?: { strictLive?: boolean; symbol?: string; timeframe?: string }): Promise<{ ready: boolean; mode: TradingViewHealthStatus['mode']; detail: string; status: TradingViewHealthStatus }> {
    const strictLive = options?.strictLive === true;
    const symbol = (options?.symbol || TRADINGVIEW_CONFIG.defaultSymbol).toUpperCase();
    const timeframe = options?.timeframe || '1h';
    if (!TRADINGVIEW_CONFIG.liveEnabled) {
      const status = this.getHealthStatus();
      return { ready: !strictLive, mode: status.mode, detail: strictLive ? 'TradingView live mode is disabled by configuration' : 'TradingView live mode disabled; running simulated fallback mode', status };
    }
    if (this.isLiveCircuitOpen()) {
      const status = this.getHealthStatus();
      return { ready: !strictLive, mode: status.mode, detail: `TradingView live circuit open until ${new Date(status.circuitOpenUntil).toISOString()}`, status };
    }
    try {
      await this.fetchLiveAnalysis(symbol, timeframe);
      this.registerLiveSuccess();
      const status = this.getHealthStatus();
      return { ready: true, mode: status.mode, detail: `TradingView live analysis succeeded for ${symbol} (${timeframe})`, status };
    } catch (error) {
      this.registerLiveFailure(error, symbol, timeframe);
      const status = this.getHealthStatus();
      return { ready: !strictLive, mode: status.mode, detail: `TradingView live analysis failed: ${status.lastLiveFailureReason || 'unknown error'}`, status };
    }
  }

  static signalToScore(signal: TradingSignal): number {
    const scores: Record<TradingSignal, number> = { strong_buy: 2, buy: 1, neutral: 0, sell: -1, strong_sell: -2 };
    return scores[signal];
  }

  static shutdown(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.analysisCache.clear();
    this.optimizationProfiles.clear();
    this.isActive = false;
    this.consecutiveLiveFailures = 0;
    this.liveCircuitOpenUntil = 0;
    this.lastLiveSuccessAt = null;
    this.lastLiveFailureAt = null;
    this.lastLiveFailureReason = undefined;
    logger.info('[TRADINGVIEW] TradingView engine shutdown', { component: 'TradingView' });
  }

  static reset(): void {
    this.shutdown();
    logger.info('[TRADINGVIEW] TradingView engine reset', { component: 'TradingView' });
  }
}

export { TRADINGVIEW_CONFIG };
