/**
 * Runtime Version Check
 * Validates Node.js runtime version on startup
 * Supports Node 20+ with local development on 24
 */

const MIN_VERSION = 20;
const MAX_VERSION = 25; // Exclusive

/**
 * Parse Node.js version string into major version number
 */
function parseNodeVersion(version: string): number {
  const match = version.match(/^v?(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Check if current Node.js version is within supported range
 * @throws Error if version is outside supported range
 */
export function checkRuntimeVersion(): void {
  const currentVersion = parseNodeVersion(process.version);
  
  if (currentVersion < MIN_VERSION) {
    console.warn(
      `⚠️  WARNING: Node.js ${process.version} is below minimum supported version (${MIN_VERSION}).`,
      `\n   Please upgrade to Node.js ${MIN_VERSION}+ for production deployments.`
    );
  }
  
  if (currentVersion >= MAX_VERSION) {
    console.warn(
      `⚠️  WARNING: Node.js ${process.version} may not be fully tested.`,
      `\n   Supported range: Node.js ${MIN_VERSION}.x - ${MAX_VERSION - 1}.x`
    );
  }
  
  console.log(`[Runtime] Node.js ${process.version} detected (supported: ${MIN_VERSION}.x - ${MAX_VERSION - 1}.x)`);
}

/**
 * Get runtime information for diagnostics
 */
export function getRuntimeInfo(): {
  nodeVersion: string;
  majorVersion: number;
  supported: boolean;
  uptime: number;
} {
  const majorVersion = parseNodeVersion(process.version);
  return {
    nodeVersion: process.version,
    majorVersion,
    supported: majorVersion >= MIN_VERSION && majorVersion < MAX_VERSION,
    uptime: process.uptime(),
  };
}
