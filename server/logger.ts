import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

// Constants for log file sizes
const MB = 1024 * 1024;
const LOG_FILE_MAX_SIZE = 10 * MB; // 10MB for combined logs
const ERROR_LOG_MAX_SIZE = 5 * MB;  // 5MB for error logs

// Ensure logs directory exists (with error handling for race conditions)
const logsDir = path.resolve(process.cwd(), 'logs');
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (err: any) {
  // Ignore EEXIST errors (directory already created by another process)
  if (err.code !== 'EEXIST') {
    console.error('Failed to create logs directory:', err);
  }
}

// Note: Using process.env.NODE_ENV directly here instead of config system
// because logger is initialized at module import time, before config validation.
// This is intentional to ensure logger is available during bootstrap.
const getLogLevel = (): string => {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production') return 'info';
  if (env === 'test') return 'error';
  return 'debug';
};

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Railway enforces a per-replica console-line throughput ceiling. CryptoCrawler's
// canonical scanners intentionally run at high cadence, so identical summary
// messages can otherwise crowd out the warnings/errors and terminal evidence we
// actually need in deploy logs. Sample only the known repetitive INFO summaries
// on the Console transport. File transports remain unsampled and retain every
// event, and warnings/errors are never filtered.
const HIGH_FREQUENCY_PRODUCTION_SUMMARIES = new Set([
  '[NoBpsMakerAdmission] Canonical bounded MM comparison completed',
  '[ExpandedUniverse] Final universe composed from broad market evidence plus live cross-venue product discovery',
  '[HybridCEX] MT/TM canonical comparison completed',
  '[OpportunityGraph] Measured CEX edge-formation cycle completed',
  '[ArbVerifier] Dynamic two-phase concurrent CEX scan completed',
  '[EvidenceScanner] Targeted CEX minimum execution evidence acquisition completed',
  '[EconomicTransformation] Raw positive CEX observation received fresh canonical reassessment',
  '[CEX Fees] Fee evidence resolved',
]);

type ConsoleSampleState = { lastEmittedAt: number; suppressed: number };
const productionConsoleSamples = new Map<string, ConsoleSampleState>();

function productionConsoleSampleIntervalMs(): number {
  const parsed = Number(process.env.PRODUCTION_CONSOLE_SUMMARY_SAMPLE_MS || 1_000);
  return Number.isFinite(parsed) ? Math.max(250, Math.min(10_000, Math.trunc(parsed))) : 1_000;
}

const productionConsoleNoiseFilter = winston.format(info => {
  if ((process.env.NODE_ENV || 'development') !== 'production') return info;
  if (String(info.level).toLowerCase() !== 'info') return info;
  const message = String(info.message || '');
  if (!HIGH_FREQUENCY_PRODUCTION_SUMMARIES.has(message)) return info;

  const key = `${String(info.component || '')}|${message}`;
  const now = Date.now();
  const intervalMs = productionConsoleSampleIntervalMs();
  const state = productionConsoleSamples.get(key);
  if (!state) {
    productionConsoleSamples.set(key, { lastEmittedAt: now, suppressed: 0 });
    return info;
  }

  if (now - state.lastEmittedAt < intervalMs) {
    state.suppressed += 1;
    return false;
  }

  if (state.suppressed > 0) {
    info.consoleSuppressedSinceLastEmit = state.suppressed;
  }
  state.lastEmittedAt = now;
  state.suppressed = 0;
  return info;
})();

// Reserved keys that should not appear in metadata output
const RESERVED_KEYS = ['timestamp', 'level', 'message', 'component', 'service', 'pid'];

const consoleFormat = winston.format.combine(
  productionConsoleNoiseFilter,
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, component, ...meta }) => {
    let msg = `${timestamp} ${level}`;
    if (component) msg += ` [${component}]`;
    msg += `: ${message}`;
    
    const metaKeys = Object.keys(meta).filter(k => !RESERVED_KEYS.includes(k));
    
    if (metaKeys.length > 0) {
      const metaObj: Record<string, any> = {};
      metaKeys.forEach(k => metaObj[k] = meta[k]);
      msg += ` ${JSON.stringify(metaObj)}`;
    }
    
    return msg;
  })
);

// Logger is transport-only. Process-level fatal/rejection ownership belongs to
// server/index.ts so one event follows one cleanup and termination path.
export const logger = winston.createLogger({
  level: getLogLevel(),
  format: fileFormat,
  defaultMeta: { 
    service: 'legalwhat',
    pid: process.pid,
  },
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: ERROR_LOG_MAX_SIZE,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: LOG_FILE_MAX_SIZE,
      maxFiles: 10,
    }),
  ],
});

logger.exitOnError = false;

export default logger;

export function createLogger(component: string) {
  return logger.child({ component });
}

/**
 * Starts a timer for performance measurement.
 * 
 * Usage example:
 * ```typescript
 * const timer = startTimer();
 * // ... perform operations ...
 * timer.done({ message: 'Operation completed', operation: 'database-query' });
 * ```
 * 
 * The timer will log the elapsed time along with the provided metadata.
 * 
 * @returns A timer object with a done() method to complete timing
 */
export function startTimer() {
  return logger.startTimer();
}
