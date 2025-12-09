// Rate Limiting Module Exports
export {
  AutomaticRateLimiter,
  autoRateLimiter,
  calculateBurstProbability,
  calculateNewRate,
  calculateWaveDelay,
  DEFAULT_AUTO_RATE_CONFIG,
  type AutoRateLimitConfig,
  type RateLimitState,
  type StarburstWaveConfig
} from './automatic-rate-limiter.js';
