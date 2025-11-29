/**
 * Runtime Check Utility
 * Verifies Node.js version meets minimum requirements at startup
 */

const MINIMUM_NODE_VERSION = 20;
const MAXIMUM_NODE_VERSION = 25;

/**
 * Check if the current Node.js version meets requirements
 * Logs a warning if version is too old, throws if critically unsupported
 */
export function checkNodeVersion(): void {
  const currentVersion = process.version;
  const majorVersion = parseInt(currentVersion.slice(1).split('.')[0], 10);
  
  console.log(`[Runtime Check] Node.js version: ${currentVersion}`);
  
  if (isNaN(majorVersion)) {
    console.warn(`[Runtime Check] ⚠️ Unable to parse Node.js version: ${currentVersion}`);
    return;
  }
  
  if (majorVersion < MINIMUM_NODE_VERSION) {
    console.warn(`[Runtime Check] ⚠️ Node.js ${majorVersion} is below minimum version ${MINIMUM_NODE_VERSION}`);
    console.warn(`[Runtime Check] ⚠️ Please upgrade to Node.js ${MINIMUM_NODE_VERSION}+ for full compatibility`);
    console.warn(`[Runtime Check] ⚠️ Some features may not work correctly`);
    return;
  }
  
  if (majorVersion >= MAXIMUM_NODE_VERSION) {
    console.warn(`[Runtime Check] ⚠️ Node.js ${majorVersion} is above tested maximum version ${MAXIMUM_NODE_VERSION - 1}`);
    console.warn(`[Runtime Check] ⚠️ This version is untested and may have compatibility issues`);
    return;
  }
  
  console.log(`[Runtime Check] ✓ Node.js version ${majorVersion} meets requirements (${MINIMUM_NODE_VERSION}-${MAXIMUM_NODE_VERSION - 1})`);
}

/**
 * Get runtime information for health checks
 */
export function getRuntimeInfo(): {
  nodeVersion: string;
  majorVersion: number;
  meetsRequirements: boolean;
  platform: string;
  arch: string;
} {
  const currentVersion = process.version;
  const majorVersion = parseInt(currentVersion.slice(1).split('.')[0], 10);
  const meetsRequirements = majorVersion >= MINIMUM_NODE_VERSION && majorVersion < MAXIMUM_NODE_VERSION;
  
  return {
    nodeVersion: currentVersion,
    majorVersion,
    meetsRequirements,
    platform: process.platform,
    arch: process.arch,
  };
}
