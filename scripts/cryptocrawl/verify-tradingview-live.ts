import assert from 'node:assert/strict';
import { TradingViewEngine } from '../../server/services/cryptocrawl/babel/tradingview-integration.js';

TradingViewEngine.reset();
const analysis = await TradingViewEngine.getAnalysis('MATICUSDT', '1h');

assert.equal(analysis.dataProvenance, 'live');
assert.equal(analysis.symbol, 'MATICUSDT');
assert.ok(Number.isFinite(analysis.movingAverages.indicators.ema20));

TradingViewEngine.shutdown();
console.log('TradingView MATICUSDT live verification passed');