// Master Password Configuration and Utilities
// SINGLE MASTER PASSWORD SYSTEM - Renders to admin console
import crypto from "crypto";

/**
 * SINGLE MASTER PASSWORD
 * Grants access to PANTHEON Admin Console
 * All other zone-specific passwords are DEPRECATED
 */
export const MASTER_PASSWORD = "PANTHEON";

/**
 * DEPRECATED Zone Passwords - Kept for backward compatibility
 * @deprecated Use MASTER_PASSWORD for all admin access
 */
export const LEGALWHAT_PASSWORD = MASTER_PASSWORD;
export const ORCHESTRATOR_PASSWORD = MASTER_PASSWORD;
export const CRYPTOCRAWLER_PASSWORD = MASTER_PASSWORD;

/**
 * Access zone types - All map to admin
 */
export type AccessZone = 'admin';

/**
 * Role types - Single admin role
 */
export type AccessRole = 'ADMIN_ROOT';

/**
 * Access zone configuration
 */
export interface AccessZoneConfig {
  password: string;
  role: AccessRole;
  route: string;
  mode: 'admin';
}

/**
 * Single admin zone configuration
 */
export const ACCESS_ZONES: Record<AccessZone, AccessZoneConfig> = {
  admin: {
    password: MASTER_PASSWORD,
    role: 'ADMIN_ROOT',
    route: '/admin-console',
    mode: 'admin',
  },
};

/**
 * Admin user first name
 */
export const ZONE_FIRST_NAMES: Record<AccessZone, string> = {
  admin: "PANTHEON",
};

/**
 * Check if provided password matches the master password
 * Returns 'admin' if matched, null otherwise
 */
export function checkMasterPassword(password: string): AccessZone | null {
  if (password === MASTER_PASSWORD) return 'admin';
  return null;
}

/**
 * Check if provided password is the master password
 */
export function isMasterPassword(password: string): boolean {
  return password === MASTER_PASSWORD;
}

/**
 * @deprecated Use checkMasterPassword instead
 */
export function isOrchestratorPassword(password: string): boolean {
  return password === MASTER_PASSWORD;
}

/**
 * @deprecated Use checkMasterPassword instead
 */
export function isCryptoCrawlerPassword(password: string): boolean {
  return password === MASTER_PASSWORD;
}

/**
 * Get the access zone config for the master password
 */
export function getAccessZoneConfig(password: string): AccessZoneConfig | null {
  const zone = checkMasterPassword(password);
  return zone ? ACCESS_ZONES[zone] : null;
}

/**
 * Generate a consistent user ID for master password logins
 * Uses email if provided, otherwise generates a random ID
 */
export function generateMasterUserId(email: string | null | undefined, _zone: AccessZone = 'admin'): string {
  if (email && email.trim()) {
    return `admin-${crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16)}`;
  } else {
    return `admin-${crypto.randomBytes(8).toString('hex')}`;
  }
}

/**
 * Get the email to use for master password login
 * Uses provided email or a default internal email
 */
export function getMasterUserEmail(email: string | null | undefined, _zone: AccessZone = 'admin'): string {
  if (email && email.trim()) return email;
  return "admin@pantheon.internal";
}
