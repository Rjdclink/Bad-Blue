import * as fs from 'fs';
import * as path from 'path';

// Define the maximum log file size in bytes
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Define the log file path and name
// Use process.cwd() to ensure it's relative to workspace root if __dirname is tricky in ESM/TS
const LOG_FILE_PATH = path.join(process.cwd(), 'application.log');

// Function to check and rotate logs
function checkAndRotateLogs(): void {
  try {
    if (fs.existsSync(LOG_FILE_PATH)) {
      const logFileSize = fs.statSync(LOG_FILE_PATH).size;
      if (logFileSize > MAX_LOG_FILE_SIZE) {
        rotateLog();
      }
    }
  } catch (err) {
    // Ignore rotation errors to avoid crashing
    console.error('Log rotation failed:', err);
  }
}

// Function to rotate the log file
function rotateLog(): void {
  try {
    const BACKUP_LOG_FILE_PATH = `${LOG_FILE_PATH}.backup`;
    if (fs.existsSync(BACKUP_LOG_FILE_PATH)) {
      fs.unlinkSync(BACKUP_LOG_FILE_PATH);
    }
    fs.renameSync(LOG_FILE_PATH, BACKUP_LOG_FILE_PATH);
  } catch (err) {
    console.error('Log rotation failed:', err);
  }
}

function writeLog(level: string, message: string, meta?: any): void {
  checkAndRotateLogs();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  const logMessage = `${new Date().toISOString()} [${level.toUpperCase()}] - ${message}${metaStr}\n`;
  
  // Also print to console for visibility
  if (level === 'error') console.error(logMessage.trim());
  else if (level === 'warn') console.warn(logMessage.trim());
  else console.log(logMessage.trim());

  try {
    fs.appendFileSync(LOG_FILE_PATH, logMessage);
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

export const logger = {
  log: (message: string) => writeLog('info', message),
  info: (message: string, meta?: any) => writeLog('info', message, meta),
  warn: (message: string, meta?: any) => writeLog('warn', message, meta),
  error: (message: string, meta?: any) => writeLog('error', message, meta),
  debug: (message: string, meta?: any) => writeLog('debug', message, meta),
};

export default logger;
