import { marketConditionDetector, MarketConditionDetector } from '../../cryptocrawl/core/market-condition-detector.js';
import type {
  CryptaraMarketGateConfig,
  CryptaraMarketGateContext,
  GateEvaluation,
  GateSignal,
  SignalStatus,
} from './types.js';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function mk(id: string, status: SignalStatus, message: string, details?: Record<string, unknown>, score?: number): GateSignal {
  return { id, status, message, details, score };
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

const DEFAULT_CONFIG: Required<CryptaraMarketGateConfig> = {
  blockOnUnknownCritical: false,
  criticalSignals: [],
};

export class CryptaraMarketGateEngine {
  evaluate(context: CryptaraMarketGateContext, config: CryptaraMarketGateConfig = {}): GateEvaluation {
    const cfg: Required<CryptaraMarketGateConfig> = { ...DEFAULT_CONFIG, ...config };
    const signals: GateSignal[] = [];
    const advisoryReasons: string[] = [];
    const actions: GateEvaluation['actions'] = {};

    // Cryptara market-condition signals are advisory by default. Canonical
    // execution admission remains authoritative for fresh all-in profitability,
    // executable depth, settlement feasibility, and hard governance constraints.

    // 1) Volatility regime detection
    {
      const c = context.volatilityRegime;
      if (!c) {
        signals.push(mk('volatilityRegime', 'unknown', 'No volatility regime inputs provided'));
      } else {
        const metrics = MarketConditionDetector.createMetrics({
          volatility: c.volatility,
          liquidity: c.liquidityScore,
          spread: c.spreadSize,
          competitors: c.competitorDensity,
          congestion: c.networkCongestion,
          priceChange: c.recentPriceMovement,
          gas: c.gasPriceGwei,
          mempool: c.mempoolActivity,
        });
        const result = marketConditionDetector.detect(metrics);
        const status: SignalStatus = result.level === 'poor' && result.confidence > 0.75 ? 'fail' : 'pass';
        signals.push(
          mk(
            'volatilityRegime',
            status,
            `Market condition=${result.level} score=${result.score.toFixed(1)} confidence=${result.confidence.toFixed(2)}`,
            { result }
          )
        );
        if (status === 'fail') advisoryReasons.push('Volatility regime unfavorable (advisory)');
      }
    }

    // 2) Order flow (volume delta)
    {
      const of = context.orderFlow;
      if (!of || !Array.isArray(of.trades) || of.trades.length === 0 || !isFiniteNumber(of.windowMs) || of.windowMs <= 0) {
        signals.push(mk('orderFlow.volumeDelta', 'unknown', 'No order flow trades/window provided'));
      } else {
        const now = Date.now();
        const cutoff = now - of.windowMs;
        const trades = of.trades.filter(t => isFiniteNumber(t.ts) && t.ts >= cutoff);
        const buyVol = trades.filter(t => t.side === 'buy').reduce((s, t) => s + (isFiniteNumber(t.size) ? t.size : 0), 0);
        const sellVol = trades.filter(t => t.side === 'sell').reduce((s, t) => s + (isFiniteNumber(t.size) ? t.size : 0), 0);
        const total = buyVol + sellVol;
        const delta = buyVol - sellVol;
        const deltaNorm = total > 0 ? delta / total : 0;
        const status: SignalStatus = Math.abs(deltaNorm) > 0.6 ? 'fail' : 'pass';
        signals.push(
          mk('orderFlow.volumeDelta', status, `Δ=${delta.toFixed(4)} (norm=${deltaNorm.toFixed(3)})`, { buyVol, sellVol, windowMs: of.windowMs }, clamp(1 - Math.abs(deltaNorm), 0, 1))
        );
        if (status === 'fail') advisoryReasons.push('Order flow imbalance indicates elevated execution risk (advisory)');
      }
    }

    // 3) Market profile (value areas)
    {
      const mp = context.marketProfile;
      if (!mp || !Array.isArray(mp.buckets) || mp.buckets.length < 5) {
        signals.push(mk('marketProfile.valueArea', 'unknown', 'No market profile buckets provided'));
      } else {
        const buckets = [...mp.buckets].filter(b => isFiniteNumber(b.price) && isFiniteNumber(b.volume) && b.volume >= 0).sort((a, b) => a.price - b.price);
        const totalVol = buckets.reduce((s, b) => s + b.volume, 0);
        if (totalVol <= 0) {
          signals.push(mk('marketProfile.valueArea', 'unknown', 'Market profile volume is empty'));
        } else {
          const valueAreaPct = isFiniteNumber(mp.valueAreaPct) ? clamp(mp.valueAreaPct, 0.5, 0.9) : 0.7;
          const poc = isFiniteNumber(mp.pocPrice)
            ? mp.pocPrice
            : buckets.reduce((best, b) => (b.volume > best.volume ? b : best), buckets[0]).price;
          const pocIndex = buckets.findIndex(b => b.price === poc);
          let lo = pocIndex >= 0 ? pocIndex : Math.floor(buckets.length / 2);
          let hi = lo;
          let acc = buckets[lo]?.volume || 0;
          const target = totalVol * valueAreaPct;
          while (acc < target && (lo > 0 || hi < buckets.length - 1)) {
            const left = lo > 0 ? buckets[lo - 1].volume : -1;
            const right = hi < buckets.length - 1 ? buckets[hi + 1].volume : -1;
            if (right >= left) {
              hi++;
              acc += buckets[hi].volume;
            } else {
              lo--;
              acc += buckets[lo].volume;
            }
          }
          const vah = buckets[hi].price;
          const val = buckets[lo].price;
          const ref = mp.referencePrice;
          const status: SignalStatus = isFiniteNumber(ref) && (ref < val || ref > vah) ? 'fail' : 'pass';
          signals.push(mk('marketProfile.valueArea', status, `VAL=${val} POC=${poc} VAH=${vah}`, { val, poc, vah, valueAreaPct, referencePrice: ref }));
          if (status === 'fail') advisoryReasons.push('Reference price is outside the modeled value area (advisory)');
        }
      }
    }

    // 4) Liquidity / heatmap analysis
    {
      const lh = context.liquidityHeatmap;
      if (!lh || !Array.isArray(lh.bids) || !Array.isArray(lh.asks)) {
        signals.push(mk('liquidity.heatmap', 'unknown', 'No liquidity heatmap orderbook provided'));
      } else {
        const ref = lh.referencePrice;
        const bandBps = isFiniteNumber(lh.bandBps) ? Math.max(1, lh.bandBps) : 50;
        const required = isFiniteNumber(lh.requiredDepth) ? Math.max(0, lh.requiredDepth) : undefined;
        if (!isFiniteNumber(ref) || !required) {
          signals.push(mk('liquidity.heatmap', 'unknown', 'Missing referencePrice and/or requiredDepth'));
        } else {
          const band = (ref * bandBps) / 10000;
          const bidDepth = lh.bids.filter(l => isFiniteNumber(l.price) && isFiniteNumber(l.size) && l.price >= ref - band).reduce((s, l) => s + l.size, 0);
          const askDepth = lh.asks.filter(l => isFiniteNumber(l.price) && isFiniteNumber(l.size) && l.price <= ref + band).reduce((s, l) => s + l.size, 0);
          const available = Math.min(bidDepth, askDepth);
          const status: SignalStatus = available >= required ? 'pass' : 'fail';
          signals.push(mk('liquidity.heatmap', status, `depth=${available.toFixed(4)} required=${required}`, { bidDepth, askDepth, required, bandBps }));
          if (status === 'fail') advisoryReasons.push('Auxiliary heatmap depth is below requested depth (advisory; canonical executable depth remains authoritative)');
        }
      }
    }

    // 5) Funding/sentiment via funding rates
    {
      const fr = context.fundingRates;
      if (!fr || !isFiniteNumber(fr.fundingRate)) {
        signals.push(mk('fundingRates', 'unknown', 'No funding rate provided'));
      } else {
        const abs = Math.abs(fr.fundingRate);
        const maxAbs = fr.unit === 'per8h' ? 0.01 : 2.0;
        const status: SignalStatus = abs > maxAbs ? 'fail' : 'pass';
        signals.push(mk('fundingRates', status, `funding=${fr.fundingRate} (${fr.unit})`, { openInterestUsd: fr.openInterestUsd, maxAbs }));
        if (status === 'fail') advisoryReasons.push('Funding rate is extreme (advisory)');
      }
    }

    // 6) Inter-market correlation
    {
      const c = context.correlation;
      if (!c || !isFiniteNumber(c.correlation)) {
        signals.push(mk('interMarket.correlation', 'unknown', 'No correlation input provided'));
      } else {
        const status: SignalStatus = Math.abs(c.correlation) < 0.1 ? 'fail' : 'pass';
        signals.push(mk('interMarket.correlation', status, `corr=${c.correlation.toFixed(3)} vs ${c.against}`, { against: c.against }));
        if (status === 'fail') advisoryReasons.push('Correlation breakdown detected (advisory)');
      }
    }

    // 7) Time-of-day behavior
    {
      const t = context.timeOfDay;
      if (!t || !isFiniteNumber(t.utcHour)) {
        signals.push(mk('timeOfDay', 'unknown', 'No UTC hour provided'));
      } else {
        const hour = Math.floor(t.utcHour);
        const risk = t.riskByHour?.[hour];
        if (!isFiniteNumber(risk)) {
          signals.push(mk('timeOfDay', 'unknown', `No time-of-day risk model for hour=${hour}`));
        } else {
          const status: SignalStatus = risk >= 0.8 ? 'fail' : 'pass';
          signals.push(mk('timeOfDay', status, `hour=${hour} risk=${risk.toFixed(2)}`, { hour, risk }));
          if (status === 'fail') advisoryReasons.push('Time-of-day risk model is elevated (advisory)');
        }
      }
    }

    // 8) Options-implied market (IV / skew / term structure)
    {
      const o = context.optionsImplied;
      if (!o) {
        signals.push(mk('optionsImplied', 'unknown', 'No options-implied inputs provided'));
      } else {
        const iv = o.impliedVol;
        if (!isFiniteNumber(iv)) {
          signals.push(mk('optionsImplied', 'unknown', 'No implied volatility provided'));
        } else {
          const status: SignalStatus = iv > 1.2 ? 'fail' : 'pass';
          signals.push(mk('optionsImplied', status, `iv=${iv.toFixed(3)} skew=${o.skew ?? 'n/a'} slope=${o.termStructureSlope ?? 'n/a'}`, { ...o }));
          if (status === 'fail') advisoryReasons.push('Options-implied volatility is elevated (advisory)');
        }
      }
    }

    // 9) Latency-aware venue selection
    {
      const v = context.venueLatency;
      if (!v || !v.p50Ms || Object.keys(v.p50Ms).length === 0) {
        signals.push(mk('venueLatency', 'unknown', 'No venue latency map provided'));
      } else {
        const max = isFiniteNumber(v.maxP50Ms) ? v.maxP50Ms : 250;
        const entries = Object.entries(v.p50Ms).filter(([, ms]) => isFiniteNumber(ms));
        const best = entries.sort((a, b) => a[1] - b[1])[0];
        const worst = entries.sort((a, b) => b[1] - a[1])[0];
        const allTooSlow = entries.length > 0 && entries.every(([, ms]) => ms > max);
        const status: SignalStatus = allTooSlow ? 'fail' : 'pass';
        signals.push(mk('venueLatency', status, `best=${best?.[0] ?? 'n/a'}@${best?.[1] ?? 'n/a'}ms max=${max}ms`, { best, worst, max }));
        if (status === 'fail') advisoryReasons.push('Observed venue latency exceeds the advisory target');
      }
    }

    // 10) Fees / rebates
    {
      const f = context.feesRebates;
      if (!f) {
        signals.push(mk('feesRebates', 'unknown', 'No fee/rebate context provided'));
      } else {
        const makerOnly = f.makerOnly === true;
        const makerFee = isFiniteNumber(f.makerFeeBps) ? f.makerFeeBps : undefined;
        const takerFee = isFiniteNumber(f.takerFeeBps) ? f.takerFeeBps : undefined;
        // Canonical fee evidence carries rebate magnitude as a positive credit,
        // while older Cryptara/test contexts encoded the same credit as negative
        // BPS. Normalize both representations without changing economic meaning.
        const rebate = isFiniteNumber(f.makerRebateBps) ? Math.abs(f.makerRebateBps) : undefined;

        if (makerOnly) {
          if (!isFiniteNumber(makerFee)) {
            signals.push(mk('feesRebates', 'unknown', 'Maker-only strategy but makerFeeBps missing'));
          } else {
            const effectiveMakerBps = makerFee - (rebate ?? 0);
            signals.push(mk('feesRebates', 'pass', `makerOnly effectiveMakerBps=${effectiveMakerBps.toFixed(2)}; profitability decided by canonical all-in economics`, { makerFeeBps: makerFee, makerRebateBps: rebate, effectiveMakerBps }));
          }
        } else {
          if (!isFiniteNumber(takerFee) && !isFiniteNumber(makerFee)) {
            signals.push(mk('feesRebates', 'unknown', 'Fee data missing'));
          } else {
            signals.push(mk('feesRebates', 'pass', 'Fee/rebate inputs present; canonical all-in economics remain authoritative', { makerFeeBps: makerFee, takerFeeBps: takerFee, makerRebateBps: rebate }));
          }
        }
      }
    }

    // 11) Cross-exchange fee asymmetry
    {
      const x = context.crossVenueFees;
      if (!x) {
        signals.push(mk('crossVenueFees', 'unknown', 'No cross-venue fee asymmetry context provided'));
      } else {
        const feeBps = x.buyTakerFeeBps + x.sellTakerFeeBps;
        const netBps = x.grossSpreadBps - feeBps;
        const status: SignalStatus = netBps > 0 ? 'pass' : 'fail';
        signals.push(mk('crossVenueFees', status, `gross=${x.grossSpreadBps.toFixed(2)}bps fees=${feeBps.toFixed(2)}bps net=${netBps.toFixed(2)}bps`, { ...x, feeBps, netBps }));
        if (status === 'fail') advisoryReasons.push('Taker-only fee comparison is not positive (advisory; maker/rebate transformations and canonical all-in economics may supersede it)');
      }
    }

    // 12) Funding rate capture without inventory
    {
      const fc = context.fundingCaptureNoInventory;
      if (!fc) {
        signals.push(mk('fundingCapture.noInventory', 'unknown', 'No funding-capture inventory context provided'));
      } else {
        const ok = fc.deltaNeutralAvailable && !fc.requiresInventory;
        const status: SignalStatus = ok ? 'pass' : 'fail';
        signals.push(mk('fundingCapture.noInventory', status, ok ? 'Delta-neutral capture available' : 'Inventory-free capture not available', { ...fc }));
        if (status === 'fail') advisoryReasons.push('Funding capture is not inventory-free/delta-neutral (advisory here; strategy-specific execution authority decides)');
      }
    }

    // 13) Drawdown caps
    {
      const d = context.drawdownCaps;
      if (!d) {
        signals.push(mk('drawdownCaps', 'unknown', 'No drawdown cap context provided'));
      } else {
        const blocks: string[] = [];
        if (isFiniteNumber(d.drawdownUsd) && isFiniteNumber(d.maxDrawdownUsd) && d.drawdownUsd > d.maxDrawdownUsd) {
          blocks.push(`drawdownUsd ${d.drawdownUsd} > maxDrawdownUsd ${d.maxDrawdownUsd}`);
        }
        if (isFiniteNumber(d.drawdownPct) && isFiniteNumber(d.maxDrawdownPct) && d.drawdownPct > d.maxDrawdownPct) {
          blocks.push(`drawdownPct ${d.drawdownPct} > maxDrawdownPct ${d.maxDrawdownPct}`);
        }
        const status: SignalStatus = blocks.length ? 'fail' : 'pass';
        signals.push(mk('drawdownCaps', status, blocks.length ? blocks.join('; ') : 'Drawdown within caps', { ...d }));
        if (status === 'fail') advisoryReasons.push('Drawdown cap telemetry exceeded (advisory here; canonical governance remains authoritative)');
      }
    }

    // 14) Profit-only reinvestment ladder
    {
      const p = context.profitReinvestment;
      if (!p) {
        signals.push(mk('profitReinvestment', 'unknown', 'No profit reinvestment ladder context provided'));
      } else {
        const realized = isFiniteNumber(p.realizedProfitUsd) ? Math.max(0, p.realizedProfitUsd) : 0;
        const requested = isFiniteNumber(p.requestedNotionalUsd) ? Math.max(0, p.requestedNotionalUsd) : undefined;
        const frac = isFiniteNumber(p.reinvestFraction) ? clamp(p.reinvestFraction, 0, 1) : 1.0;
        const budget = realized * frac;
        if (!isFiniteNumber(requested)) {
          signals.push(mk('profitReinvestment', 'unknown', 'requestedNotionalUsd missing', { realizedProfitUsd: realized, reinvestFraction: frac, budgetUsd: budget }));
        } else {
          const status: SignalStatus = requested <= budget ? 'pass' : 'fail';
          signals.push(mk('profitReinvestment', status, `requested=${requested} budget=${budget.toFixed(2)} (profitOnly)`, { realizedProfitUsd: realized, reinvestFraction: frac, budgetUsd: budget }));
          if (status === 'fail') advisoryReasons.push('Requested notional exceeds advisory realized-profit reinvestment budget');
        }
      }
    }

    // 15) Slippage telemetry
    {
      const s = context.slippage;
      if (!s) {
        signals.push(mk('slippage', 'unknown', 'No slippage context provided'));
      } else {
        const max = isFiniteNumber(s.maxSlippageBps) ? s.maxSlippageBps : undefined;
        const expected = s.expectedSlippageBps;
        const observed = s.observedSlippageBps;

        if (!isFiniteNumber(max)) {
          signals.push(mk('slippage', 'unknown', 'maxSlippageBps missing', { expectedSlippageBps: expected, observedSlippageBps: observed }));
        } else {
          const exceedExpected = isFiniteNumber(expected) && expected > max;
          const exceedObserved = isFiniteNumber(observed) && observed > max;
          const status: SignalStatus = exceedExpected || exceedObserved ? 'fail' : 'pass';
          signals.push(mk('slippage', status, `expected=${expected ?? 'n/a'}bps observed=${observed ?? 'n/a'}bps max=${max}bps`, { expectedSlippageBps: expected, observedSlippageBps: observed, maxSlippageBps: max }));
          if (status === 'fail') advisoryReasons.push('Slippage telemetry exceeds the advisory target');
        }
      }
    }

    // Only explicitly configured critical signals can turn this analysis-only
    // engine into a blocker. With default configuration every signal remains
    // advisory and canonical execution authorities retain sole veto power.
    const hardBlockReasons: string[] = [];
    for (const critical of cfg.criticalSignals) {
      const match = signals.find(s => s.id === critical || s.id.startsWith(`${critical}.`));
      if (!match) continue;
      if (match.status === 'fail') hardBlockReasons.push(`Explicit critical signal failed: ${match.id}`);
      if (cfg.blockOnUnknownCritical && match.status === 'unknown') {
        hardBlockReasons.push(`Explicit critical signal unknown: ${match.id}`);
      }
    }

    const decision: GateEvaluation['decision'] = hardBlockReasons.length > 0 ? 'BLOCK' : 'ALLOW';

    return {
      decision,
      signals,
      blockReasons: Array.from(new Set(hardBlockReasons)),
      actions,
      metadata: {
        evaluatedAt: Date.now(),
        stageHint: advisoryReasons.length > 0
          ? `advisory_only:${Array.from(new Set(advisoryReasons)).length}_signal_reason(s)`
          : 'advisory_only:no_negative_signal',
      },
    };
  }
}