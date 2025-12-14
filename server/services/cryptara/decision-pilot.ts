import crypto from 'crypto';
import { scoreCandidateSignal } from '../cryptocrawl/signal-intelligence/monte-carlo-scorer.js';
import { getCexSpotArbBaseCandidate } from '../cryptocrawl/signal/cex-arb-signals.js';

export interface CryptaraDecisionObject {
  kind: 'crypto_decision';
  decisionId: string;
  computedAt: number;
  base: {
    decision: 'SIGNAL' | 'NO SIGNAL';
    candidate: Awaited<ReturnType<typeof getCexSpotArbBaseCandidate>> | null;
  };
  monteCarlo: {
    decision: 'NO SIGNAL' | { confidenceScore: number; expectedValueUSD: number };
  };
  aiConcurrence: { ok: boolean };
  eligibility: { ok: boolean };
  envelope: {
    dailyCapUsd: 200;
    notionalUsd: 200;
    allowedVenues: readonly ['binance', 'kraken'];
    allowedPairs: readonly ['BTS-USDT', 'ETH-USDT', 'SOL-USDT'];
  };
}

const DAILY_CAP_USD = 200 as const;
const NOTIONAL_USD = 200 as const;
const ALLOWED_VENUES = ['binance', 'kraken'] as const;
const ALLOWED_PAIRS = ['BTS-USDT', 'ETH-USDT', 'SOL-USDT'] as const;

const MC_CONFIG = Object.freeze({
  simulations: 10000,
  confidenceThreshold: 0.7,
  volatilityWindow: 60,
  latencyMs: 800,
  latencyJitterMs: 400,
  spreadWidenBpsStd: 25,
});

function stableJson(obj: unknown): string {
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

function aiConcurrence(candidate: any | null): boolean {
  // Logic-only constraints (no sentiment): must be within allowed venues/pairs and structurally valid.
  if (!candidate) return false;
  if (candidate.notionalUsd !== 200) return false;
  if (!ALLOWED_VENUES.includes(candidate.buyVenue) || !ALLOWED_VENUES.includes(candidate.sellVenue)) return false;
  if (!ALLOWED_PAIRS.includes(candidate.pair)) return false;
  if (!(candidate.buyBestAsk > candidate.buyBestBid)) return false;
  if (!(candidate.sellBestAsk > candidate.sellBestBid)) return false;
  if (!(candidate.pessimisticFeeRateBuy >= 0 && candidate.pessimisticFeeRateSell >= 0)) return false;
  return true;
}

export class CryptaraDecisionPilot {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private subscribers: Set<(d: CryptaraDecisionObject) => void> = new Set();
  private history: Map<string, number[]> = new Map();

  subscribe(fn: (d: CryptaraDecisionObject) => void): () => void {
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
    this.timer = setInterval(() => {
      this.tick().catch(() => {
        const d: CryptaraDecisionObject = {
          kind: 'crypto_decision',
          decisionId: sha256Hex('no-signal'),
          computedAt: Date.now(),
          base: { decision: 'NO SIGNAL', candidate: null },
          monteCarlo: { decision: 'NO SIGNAL' },
          aiConcurrence: { ok: false },
          eligibility: { ok: false },
          envelope: {
            dailyCapUsd: DAILY_CAP_USD,
            notionalUsd: NOTIONAL_USD,
            allowedVenues: ALLOWED_VENUES,
            allowedPairs: ALLOWED_PAIRS,
          },
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

  private emit(d: CryptaraDecisionObject) {
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
    if (arr.length > 1000) arr.splice(0, arr.length - 1000);
    this.history.set(pair, arr);
  }

  private async tick(): Promise<void> {
    const envelope = {
      dailyCapUsd: DAILY_CAP_USD,
      notionalUsd: NOTIONAL_USD,
      allowedVenues: ALLOWED_VENUES,
      allowedPairs: ALLOWED_PAIRS,
    } as const;

    const candidate = await getCexSpotArbBaseCandidate();
    const baseDecision: 'SIGNAL' | 'NO SIGNAL' = candidate ? 'SIGNAL' : 'NO SIGNAL';

    if (candidate) {
      const buyMid = (candidate.buyBestBid + candidate.buyBestAsk) / 2;
      const sellMid = (candidate.sellBestBid + candidate.sellBestAsk) / 2;
      this.pushHistory(candidate.pair, (buyMid + sellMid) / 2);
    }

    const aiOk = aiConcurrence(candidate);
    let mcDecision: 'NO SIGNAL' | { confidenceScore: number; expectedValueUSD: number } = 'NO SIGNAL';

    if (candidate && aiOk) {
      const hist = this.history.get(candidate.pair) || [];
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
        seed: Number.parseInt(sha256Hex(stableJson({ candidate, h: hist.slice(-MC_CONFIG.volatilityWindow - 1) })).slice(0, 8), 16),
      });
      mcDecision = mc === 'NO SIGNAL' ? 'NO SIGNAL' : mc;
    }

    const eligible =
      baseDecision === 'SIGNAL' &&
      mcDecision !== 'NO SIGNAL' &&
      aiOk &&
      mcDecision.expectedValueUSD > 0;

    const decisionInput = { baseDecision, candidate, mcDecision, aiOk, envelope };
    const decisionId = sha256Hex(stableJson(decisionInput));

    const d: CryptaraDecisionObject = {
      kind: 'crypto_decision',
      decisionId,
      computedAt: Date.now(),
      base: { decision: baseDecision, candidate },
      monteCarlo: { decision: mcDecision },
      aiConcurrence: { ok: aiOk },
      eligibility: { ok: eligible },
      envelope,
    };

    this.emit(d);
  }
}

