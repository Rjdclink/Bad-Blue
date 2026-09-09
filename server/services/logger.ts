// Compatibility re-export for deeply nested service modules that resolve ../../../logger.js to server/services/logger.js.
// This creates no logger instance or runtime authority; the canonical logger remains server/logger.ts.
export { default } from '../logger.js';
