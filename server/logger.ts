import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

// Constants for log file sizes
const MB = 1024 * 1024;
const LOG_FILE_MAX_SIZE = 10 * MB; // 10MB for combined logs
const ERROR_LOG_MAX_SIZE = 5 * MB;  // 5MB for error logs
const EXCEPTION_LOG_MAX_SIZE = 5 * MB;
const REJECTION_LOG_MAX_SIZE = 5 * MB;

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

// Reserved keys that should not appear in metadata output
const RESERVED_KEYS = ['timestamp', 'level', 'message', 'component', 'service', 'pid'];

const consoleFormat = winston.format.combine(
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
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'exceptions.log'),
      maxsize: EXCEPTION_LOG_MAX_SIZE,
      maxFiles: 3,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'rejections.log'),
      maxsize: REJECTION_LOG_MAX_SIZE,
      maxFiles: 3,
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
