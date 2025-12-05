/**
 * PANTHEON Shadow Retrieval - Human-Like Timing Utilities
 * Generate realistic delays to avoid detection patterns
 */

import type { TimingConfig } from '../types';

/**
 * Generate a random delay with uniform distribution
 */
export function uniformDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Generate a random delay with normal (Gaussian) distribution
 * More realistic for human behavior - most delays cluster around the mean
 */
export function normalDelay(meanMs: number, stdDevMs: number): number {
  // Box-Muller transform for normal distribution
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  
  const delay = Math.round(meanMs + stdDevMs * z0);
  
  // Ensure delay is positive
  return Math.max(0, delay);
}

/**
 * Generate a random delay with exponential distribution
 * Useful for simulating think time between actions
 */
export function exponentialDelay(lambdaMs: number): number {
  const u = Math.random();
  return Math.round(-Math.log(1 - u) * lambdaMs);
}

/**
 * Generate a random delay based on configuration
 */
export function generateDelay(config: TimingConfig): number {
  const { minDelayMs, maxDelayMs, distribution } = config;
  
  switch (distribution) {
    case 'uniform':
      return uniformDelay(minDelayMs, maxDelayMs);
      
    case 'normal':
      // Calculate mean and standard deviation
      const mean = (minDelayMs + maxDelayMs) / 2;
      const stdDev = (maxDelayMs - minDelayMs) / 6; // 99.7% within range
      let delay = normalDelay(mean, stdDev);
      // Clamp to min/max
      delay = Math.max(minDelayMs, Math.min(maxDelayMs, delay));
      return delay;
      
    case 'exponential':
      // Use mean as lambda
      const lambda = (minDelayMs + maxDelayMs) / 2;
      let expDelay = exponentialDelay(lambda);
      // Clamp to max
      expDelay = Math.min(maxDelayMs, expDelay + minDelayMs);
      return expDelay;
      
    default:
      return uniformDelay(minDelayMs, maxDelayMs);
  }
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate human-like reading time based on content length
 */
export function calculateReadingTime(contentLength: number): number {
  // Average reading speed: 200-250 words per minute
  // Average word length: 5 characters
  const wordsPerMinute = 225;
  const avgWordLength = 5;
  const words = contentLength / avgWordLength;
  const minutes = words / wordsPerMinute;
  const milliseconds = minutes * 60 * 1000;
  
  // Add randomness (±30%)
  const variance = 0.3;
  const randomFactor = 1 + (Math.random() * variance * 2 - variance);
  
  return Math.round(milliseconds * randomFactor);
}

/**
 * Generate human-like typing delay based on text length
 */
export function calculateTypingTime(textLength: number): number {
  // Average typing speed: 40 words per minute (slower for forms)
  // Average word length: 5 characters
  const charsPerMinute = 200;
  const minutes = textLength / charsPerMinute;
  const milliseconds = minutes * 60 * 1000;
  
  // Add randomness (±25%)
  const variance = 0.25;
  const randomFactor = 1 + (Math.random() * variance * 2 - variance);
  
  return Math.round(milliseconds * randomFactor);
}

/**
 * Generate think time before an action
 */
export function generateThinkTime(): number {
  // Typical think time: 500ms to 3000ms
  return normalDelay(1250, 750);
}

/**
 * Generate mouse movement time
 */
export function generateMouseMovementTime(): number {
  // Typical mouse movement: 100ms to 500ms
  return normalDelay(250, 100);
}

/**
 * Generate scroll delay
 */
export function generateScrollDelay(): number {
  // Typical scroll pause: 300ms to 2000ms
  return normalDelay(800, 400);
}

/**
 * Generate page load wait time
 */
export function generatePageLoadWaitTime(): number {
  // Wait for page to stabilize: 1000ms to 5000ms
  return normalDelay(2000, 1000);
}

/**
 * Calculate exponential backoff delay for retries
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  multiplier: number = 2,
  jitterFactor: number = 0.2
): number {
  // Calculate exponential backoff
  const exponentialDelay = baseDelayMs * Math.pow(multiplier, attempt - 1);
  
  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  
  // Add jitter (random variation)
  const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);
  
  return Math.round(cappedDelay + jitter);
}

/**
 * Generate request interval to respect rate limits
 */
export function calculateRateLimitDelay(
  requestsPerMinute: number,
  safetyFactor: number = 0.8
): number {
  // Calculate minimum delay between requests
  const minDelayMs = (60 * 1000) / requestsPerMinute;
  
  // Apply safety factor
  const safeDelayMs = minDelayMs / safetyFactor;
  
  // Add some randomness (±10%)
  const variance = 0.1;
  const randomFactor = 1 + (Math.random() * variance * 2 - variance);
  
  return Math.round(safeDelayMs * randomFactor);
}

/**
 * Generate burst pattern delays (realistic browsing behavior)
 * Simulates periods of activity followed by pauses
 */
export function generateBurstPattern(
  actionsInBurst: number,
  burstDelayMs: number = 500,
  pauseDelayMs: number = 5000
): number[] {
  const delays: number[] = [];
  
  for (let i = 0; i < actionsInBurst; i++) {
    if (i === actionsInBurst - 1) {
      // Last action in burst - longer pause before next burst
      delays.push(pauseDelayMs + uniformDelay(-1000, 2000));
    } else {
      // Quick succession within burst
      delays.push(burstDelayMs + uniformDelay(-200, 200));
    }
  }
  
  return delays;
}

/**
 * Adaptive delay based on previous response time
 * Slower sites get longer delays
 */
export function calculateAdaptiveDelay(
  previousResponseTimeMs: number,
  baseDelayMs: number = 1000
): number {
  // If site is slow, wait longer
  if (previousResponseTimeMs > 5000) {
    return baseDelayMs * 2;
  } else if (previousResponseTimeMs > 2000) {
    return baseDelayMs * 1.5;
  }
  
  return baseDelayMs;
}

/**
 * Calculate time of day factor for request timing
 * Peak hours = slower, off-peak = faster
 */
export function getTimeOfDayFactor(): number {
  const hour = new Date().getHours();
  
  // Peak hours (9am-5pm): slower
  if (hour >= 9 && hour <= 17) {
    return 1.5;
  }
  
  // Off-peak hours: faster
  if (hour >= 22 || hour <= 6) {
    return 0.7;
  }
  
  // Normal hours
  return 1.0;
}

/**
 * Default timing configurations
 */
export const DEFAULT_TIMING_CONFIGS = {
  fast: {
    minDelayMs: 100,
    maxDelayMs: 500,
    distribution: 'uniform' as const,
  },
  normal: {
    minDelayMs: 500,
    maxDelayMs: 2000,
    distribution: 'normal' as const,
  },
  slow: {
    minDelayMs: 2000,
    maxDelayMs: 5000,
    distribution: 'normal' as const,
  },
  humanLike: {
    minDelayMs: 200,
    maxDelayMs: 3000,
    distribution: 'normal' as const,
  },
};
