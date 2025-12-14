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

