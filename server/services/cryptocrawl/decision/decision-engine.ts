import crypto from 'crypto';
import type { DecisionObject, ActionEnvelope, BaseCandidate } from './types';
import { getCexSpotArbBaseCandidate } from '../signal/cex-arb-signals.js';
import { scoreCandidateSignal } from '../signal-intelligence/monte-carlo-scorer.js';

const DAILY_CAP_USD = 200 as const;
const NOTIONAL_USD = 200 as const;

const ALLOWED_VENUES = ['binance', 'kraken'] as const;
const ALLOWED_PAIRS = ['BTS-USDT', 'ETH-USDT', 'SOL-USDT'] as const;

// Fixed pessimistic constants (deterministic).
const MC_CONFIG = Object.freeze({
  simulations: 10000,
  confidenceThreshold: 0.7,
  volatilityWindow: 60, // samples
  latencyMs: 800,
  latencyJitterMs: 400,
  spreadWidenBpsStd: 25,
});

function stableJson(obj: unknown): string {
  // Minimal stable stringify for hashes: JSON with sorted keys (shallow + nested objects/arrays).
  const seen = new WeakSet<object>();
  const sorter = (v: any): any => {
    if (v && typeof v === 'object') {
      if (seen.has(v)) return null;
      seen.add(v);
      if (Array.isArray(v)) return v.map(sorter);
      const keys = Object.keys(v).sort();
      const out: any = {};
      for (const k of keys) out[k] = sorter(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sorter(obj));
}

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function aiConcurrence(candidate: BaseCandidate | null): boolean {
  // Logic-only constraints (no sentiment, no heuristics):
  if (!candidate) return false;
  if (candidate.notionalUsd !== 200) return false;
  if (!ALLOWED_VENUES.includes(candidate.buyVenue) || !ALLOWED_VENUES.includes(candidate.sellVenue)) return false;
  if (!ALLOWED_PAIRS.includes(candidate.pair)) return false;
  if (!(candidate.buyBestAsk > candidate.buyBestBid)) return false;
  if (!(candidate.sellBestAsk > candidate.sellBestBid)) return false;
  if (!(candidate.pessimisticFeeRateBuy >= 0 && candidate.pessimisticFeeRateSell >= 0)) return false;
  return true;
}

export class CryptoDecisionEngine {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private subscribers: Set<(d: DecisionObject) => void> = new Set();

  // Rolling mid-price history (combined midpoint of venues), per pair.
  private history: Map<string, number[]> = new Map();

  subscribe(fn: (d: DecisionObject) => void): () => void {
    this.subscribers.add(fn);
    this.ensureRunning();
    return () => {
      this.subscribers.delete(fn);
      this.ensureStoppedIfIdle();
    };
  }

  private ensureRunning() {
    if (this.running) return;
    this.running = true;
    // Decision loop runs only while there is at least one subscriber (no UI -> no loop).
    this.timer = setInterval(() => {
      this.tick().catch(() => {
        // Fail closed: still emit a NO SIGNAL decision object
        const envelope: ActionEnvelope = {
          dailyCapUsd: DAILY_CAP_USD,
          notionalUsd: NOTIONAL_USD,
          allowedVenues: ALLOWED_VENUES,
          allowedPairs: ALLOWED_PAIRS,
        };
        const d: DecisionObject = {
          kind: 'crypto_decision',
          decisionId: sha256Hex('no-signal'),
          computedAt: Date.now(),
          base: { decision: 'NO SIGNAL', candidate: null },
          monteCarlo: { decision: 'NO SIGNAL' },
          aiConcurrence: { ok: false },
          eligibility: { ok: false },
          envelope,
        };
        this.emit(d);
      });
    }, 5000);
  }

  private ensureStoppedIfIdle() {
    if (this.subscribers.size > 0) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private emit(d: DecisionObject) {
    for (const fn of this.subscribers) {
      try {
        fn(d);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  private pushHistory(pair: string, mid: number) {
    const arr = this.history.get(pair) || [];
    arr.push(mid);
    // Keep bounded memory
    if (arr.length > 1000) arr.splice(0, arr.length - 1000);
    this.history.set(pair, arr);
  }

  private async tick(): Promise<void> {
    const envelope: ActionEnvelope = {
      dailyCapUsd: DAILY_CAP_USD,
      notionalUsd: NOTIONAL_USD,
      allowedVenues: ALLOWED_VENUES,
      allowedPairs: ALLOWED_PAIRS,
    };

    const candidate = await getCexSpotArbBaseCandidate();
    const baseDecision: 'SIGNAL' | 'NO SIGNAL' = candidate ? 'SIGNAL' : 'NO SIGNAL';

    // Update observed historical series when we have live midpoints.
    if (candidate) {
      const buyMid = (candidate.buyBestBid + candidate.buyBestAsk) / 2;
      const sellMid = (candidate.sellBestBid + candidate.sellBestAsk) / 2;
      const combinedMid = (buyMid + sellMid) / 2;
      this.pushHistory(candidate.pair, combinedMid);
    }

    const aiOk = aiConcurrence(candidate);

    let mcDecision: 'NO SIGNAL' | { confidenceScore: number; expectedValueUSD: number } = 'NO SIGNAL';
    if (candidate && aiOk) {
      const hist = this.history.get(candidate.pair) || [];
      // Monte Carlo requires enough historical prices to estimate rolling volatility.
      const mc = scoreCandidateSignal({
        notionalUsd: candidate.notionalUsd,
        buy: { bestBid: candidate.buyBestBid, bestAsk: candidate.buyBestAsk, makerPlusTakerFeeRate: candidate.pessimisticFeeRateBuy },
        sell: { bestBid: candidate.sellBestBid, bestAsk: candidate.sellBestAsk, makerPlusTakerFeeRate: candidate.pessimisticFeeRateSell },
        historicalPrices: hist,
        volatilityWindow: MC_CONFIG.volatilityWindow,
        confidenceThreshold: MC_CONFIG.confidenceThreshold,
        simulations: MC_CONFIG.simulations,
        latencyMs: MC_CONFIG.latencyMs,
        latencyJitterMs: MC_CONFIG.latencyJitterMs,
        spreadWidenBpsStd: MC_CONFIG.spreadWidenBpsStd,
        // Seed deterministically from normalized inputs + latest history point.
        seed: Number.parseInt(sha256Hex(stableJson({ candidate, h: hist.slice(-MC_CONFIG.volatilityWindow - 1) })).slice(0, 8), 16),
      });
      mcDecision = mc === 'NO SIGNAL' ? 'NO SIGNAL' : mc;
    }

    const eligible =
      baseDecision === 'SIGNAL' &&
      mcDecision !== 'NO SIGNAL' &&
      aiOk &&
      (mcDecision.expectedValueUSD > 0);

    const decisionInput = {
      baseDecision,
      candidate,
      mcDecision,
      aiOk,
      envelope,
    };

    const decisionId = sha256Hex(stableJson(decisionInput));

    const decision: DecisionObject = {
      kind: 'crypto_decision',
      decisionId,
      computedAt: Date.now(),
      base: { decision: baseDecision, candidate },
      monteCarlo: { decision: mcDecision },
      aiConcurrence: { ok: aiOk },
      eligibility: { ok: eligible },
      envelope,
    };

    this.emit(decision);
  }
}

export const cryptoDecisionEngine = new CryptoDecisionEngine();

