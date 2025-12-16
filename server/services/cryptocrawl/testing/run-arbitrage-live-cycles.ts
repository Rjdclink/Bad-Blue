/**
 * Small, controlled "live" cycles (quotes-only).
 *
 * Runs N cycles of real-time quote verification and prints a compact result per cycle.
 * This is intentionally non-executing: it proves consistency of the arbitrage *verification* layer.
 *
 * Usage:
 *   tsx server/services/cryptocrawl/testing/run-arbitrage-live-cycles.ts
 *
 * Env:
 *   CRYPTO_ARBITRAGE_SYMBOL=ETHUSDT
 *   CRYPTO_ARBITRAGE_NOTIONAL_USD=200
 *   CRYPTO_ARBITRAGE_MIN_NET_PROFIT_USD=0.5
 *   CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS=5000
 *   CRYPTO_ARBITRAGE_GAS_CHAIN=polygon
 *   ARB_CYCLES=5
 *   ARB_INTERVAL_MS=3000
 */
import { arbitrageVerifier } from '../arbitrage/arbitrage-verifier.js';
import type { ChainId as BridgeChainId } from '../bridge/types';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { getCryptara } from '../../cryptara/index.js';
import { marketConditionDetector, MarketConditionDetector } from '../core/market-condition-detector.js';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function n(v: unknown, fallback: number): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

async function main(): Promise<void> {
  const symbol = (process.env.CRYPTO_ARBITRAGE_SYMBOL || 'ETHUSDT').trim().toUpperCase();
  const notionalUsd = n(process.env.CRYPTO_ARBITRAGE_NOTIONAL_USD, 200);
  const minNetProfitUsd = n(process.env.CRYPTO_ARBITRAGE_MIN_NET_PROFIT_USD, 0.5);
  const maxQuoteAgeMs = n(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS, 5000);

  const cycles = Math.max(1, Math.floor(n(process.env.ARB_CYCLES, 5)));
  const intervalMs = Math.max(250, Math.floor(n(process.env.ARB_INTERVAL_MS, 3000)));

  const gasChain = (process.env.CRYPTO_ARBITRAGE_GAS_CHAIN || 'polygon') as BridgeChainId;

  let profitable = 0;
  let skipped = 0;

  console.log(`[arb] cycles=${cycles} intervalMs=${intervalMs} symbol=${symbol} notionalUsd=${notionalUsd} minNetProfitUsd=${minNetProfitUsd}`);

  // Canonical: "one constrained live cycle" and Stage 1: auto-pause after each advisory cycle.
  if (cycles !== 1) {
    console.log('[arb] NOTE: For canonical constrained run, set ARB_CYCLES=1');
  }

  // Explicit advisory UNPAUSE for this script run (required by governance).
  // This is NOT autonomous: it requires CRYPTO_ADVISORY_UNPAUSE=true set by the human.
  const governance = getCryptocrawlGovernance();
  if (process.env.CRYPTO_ADVISORY_UNPAUSE === 'true') {
    // Ensure we are in Stage 1 advisory mode
    if (governance.getState().stage !== 1) {
      console.log(`[arb] WARNING: governance stage=${governance.getState().stage}. This script expects Stage 1 advisory mode.`);
    }
    governance.unpauseWithEnvelope({
      stage: 1,
      scope: 'constrained_live_cycle_quote_verification',
      authority: 'human',
      durationMs: Math.max(1000, intervalMs + 5000),
      allowedActions: ['ADVISE'],
      constraints: {
        chains: [gasChain],
        pairs: [symbol],
        maxExecutions: 1,
      },
    });
  } else {
    console.log('[arb] BLOCKED: set CRYPTO_ADVISORY_UNPAUSE=true to run this advisory cycle');
    return;
  }

  for (let i = 0; i < cycles; i++) {
    const started = Date.now();
    try {
      const plan = await arbitrageVerifier.evaluateOnce({
        symbol,
        notionalUsd,
        maxQuoteAgeMs,
        gas: { enabled: true, chain: gasChain },
        bridge: { enabled: false, fromChain: 'polygon', toChain: 'polygon', token: 'USDC' },
      });

      const elapsed = Date.now() - started;
      if (!plan) {
        skipped++;
        console.log(`[arb] ${i + 1}/${cycles} SKIP elapsedMs=${elapsed}`);
      } else {
        const decision = plan.netProfitUsd >= minNetProfitUsd ? 'PROFIT' : 'NO_PROFIT';
        if (decision === 'PROFIT') profitable++;
        else skipped++;

        // Cryptara gating signals + volatility regime classification (logged for evidence)
        const cryptara = getCryptara();
        try {
          await cryptara.initialize();
        } catch {
          // ignore
        }

        const metrics = MarketConditionDetector.createMetrics({
          // Approximate: use quote spread as proxy for spreadSize; higher spread => worse conditions.
          spread: plan.spreadPct / 100,
          // Keep defaults for unknowns; the detector is still logged.
        });
        const regime = marketConditionDetector.detect(metrics);
        const gate = cryptara.evaluateMarketGates(
          {
            chain: gasChain,
            pairOrSymbol: symbol,
            expectedProfitUsd: plan.netProfitUsd,
            volatilityRegime: { spreadSize: plan.spreadPct / 100 },
            timeOfDay: { utcHour: new Date().getUTCHours() },
            slippage: { maxSlippageBps: 50 },
            venueLatency: { p50Ms: { quote_fetch: elapsed }, maxP50Ms: 2500 },
          },
          { blockOnUnknownCritical: true, criticalSignals: ['volatilityRegime', 'slippage', 'venueLatency'] }
        );

        console.log(
          `[arb] gates decision=${gate.decision} blockReasons=${gate.blockReasons.join('|') || 'none'} regime=${regime.level}@${regime.score.toFixed(1)} conf=${regime.confidence.toFixed(2)}`
        );

        console.log(
          `[arb] ${i + 1}/${cycles} ${decision} netUsd=${plan.netProfitUsd.toFixed(4)} spreadPct=${plan.spreadPct.toFixed(4)} buy=${plan.buyVenue}@${plan.buyAsk} sell=${plan.sellVenue}@${plan.sellBid} costsUsd=${plan.costs.totalCostsUsd.toFixed(4)} quoteAgeMs=${plan.quoteAgeMs} elapsedMs=${elapsed}`
        );
      }
    } catch (e) {
      skipped++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[arb] ${i + 1}/${cycles} ERROR ${msg}`);
    }

    if (i < cycles - 1) await sleep(intervalMs);
  }

  console.log(`[arb] done profitable=${profitable} nonProfitOrError=${skipped}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

