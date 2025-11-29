/**
 * Runtime version verification for Node.js
 * Production target: Node 20 LTS
 * Supported range: >=20 <25
 */

const MIN_VERSION = 20;
const MAX_VERSION = 25;

/**
 * Parses the Node.js version string and returns major, minor, patch numbers
 */
function parseNodeVersion(): { major: number; minor: number; patch: number; full: string } {
  const version = process.version.replace('v', '');
  const parts = version.split('.').map(Number);
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;
  return { major, minor, patch, full: process.version };
}

/**
 * Verifies that the current Node.js runtime is within the supported version range.
 * Logs a warning if outside the supported range (< 20 or >= 25), or a success message otherwise.
 * 
 * Should be called early in the application startup, before database verification.
 */
export function verifyNodeRuntime(): void {
  const { major, full } = parseNodeVersion();
  
  if (major < MIN_VERSION) {
    console.warn(`[RUNTIME] ⚠️ Node ${full} is below the minimum supported version (>=${MIN_VERSION}). Please upgrade to Node ${MIN_VERSION} or higher.`);
    return;
  }
  
  if (major >= MAX_VERSION) {
    console.warn(`[RUNTIME] ⚠️ Node ${full} is above the maximum supported version (<${MAX_VERSION}). This version may have compatibility issues.`);
    return;
  }
  
  console.log(`[RUNTIME] ✓ Node ${full} within supported range (>=${MIN_VERSION} <${MAX_VERSION}).`);
}
