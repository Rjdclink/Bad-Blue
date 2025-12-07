import * as fs from 'fs';
import * as path from 'path';

// Define the maximum log file size in bytes
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Define the log file path and name
const LOG_FILE_PATH = path.join(__dirname, 'application.log');

// Function to check and rotate logs
function checkAndRotateLogs(): void {
  // Check if the log file exists
  if (fs.existsSync(LOG_FILE_PATH)) {
    // Get the current log file size
    const logFileSize = fs.statSync(LOG_FILE_PATH).size;

    // Check if the log file size exceeds the maximum allowed size
    if (logFileSize > MAX_LOG_FILE_SIZE) {
      // Rotate the log file
      rotateLog();
    }
  }
}

// Function to rotate the log file
function rotateLog(): void {
  // Define the backup log file path and name
  const BACKUP_LOG_FILE_PATH = `${LOG_FILE_PATH}.backup`;

  // Check if a backup log file already exists
  if (fs.existsSync(BACKUP_LOG_FILE_PATH)) {
    // Remove the existing backup log file
    fs.unlinkSync(BACKUP_LOG_FILE_PATH);
  }

  // Rename the current log file to the backup log file
  fs.renameSync(LOG_FILE_PATH, BACKUP_LOG_FILE_PATH);
}

// Function to log messages
export function log(message: string): void {
  // Check and rotate logs before writing a new log message
  checkAndRotateLogs();

  // Write the log message to the log file
  fs.appendFileSync(LOG_FILE_PATH, `${new Date().toISOString()} - ${message}\n`);
}

// Export for use in other modules
export default { log };