import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
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

const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, component, ...meta }) => {
    let msg = `${timestamp} ${level}`;
    if (component) msg += ` [${component}]`;
    msg += `: ${message}`;
    
    const metaKeys = Object.keys(meta).filter(k => 
      k !== 'timestamp' && k !== 'level' && k !== 'message' && k !== 'component'
    );
    
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
    service: 'badblue',
    pid: process.pid,
  },
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760,
      maxFiles: 10,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'exceptions.log'),
      maxsize: 5242880,
      maxFiles: 3,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'rejections.log'),
      maxsize: 5242880,
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
