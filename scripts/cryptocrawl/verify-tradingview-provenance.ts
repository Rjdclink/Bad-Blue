import assert from 'node:assert/strict';

process.env.TRADINGVIEW_LIVE_ENABLED = 'false';
process.env.TRADINGVIEW_CACHE_TTL_MS = '60000';

const { TradingViewEngine } = await import('../../server/services/cryptocrawl/babel/tradingview-integration.js');

TradingViewEngine.reset();
const first = await TradingViewEngine.getAnalysis('ETHUSDT', '1h');
assert.equal(first.dataProvenance, 'deterministic-fallback');
assert.equal(first.symbol, 'ETHUSDT');
assert.ok(Number.isFinite(first.movingAverages.indicators.ema20));

const cachedFallback = await TradingViewEngine.getAnalysis('ETHUSDT', '1h');
assert.equal(cachedFallback.dataProvenance, 'deterministic-fallback');
assert.notEqual(cachedFallback.dataProvenance, 'cached');

TradingViewEngine.shutdown();
console.log('TradingView fallback provenance verification passed');
