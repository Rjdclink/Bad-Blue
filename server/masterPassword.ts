// Master Password Configuration and Utilities
// SINGLE MASTER PASSWORD SYSTEM - Admin Console Access
import crypto from "crypto";

/**
 * SINGLE MASTER PASSWORD
 * Password: SARBEAR
 * Required Email: rjdclink@outlook.com
 * Grants access to PANTHEON Admin Console
 * 
 * ALL OTHER MASTER PASSWORDS ARE PERMANENTLY DISCARDED
 */
export const MASTER_PASSWORD = "SARBEAR";
export const MASTER_EMAIL = "rjdclink@outlook.com";

/**
 * DEPRECATED - All zone passwords removed
 * Only MASTER_PASSWORD with MASTER_EMAIL is valid
 */
export const LEGALWHAT_PASSWORD = "PERMANENTLY_DISCARDED";
export const ORCHESTRATOR_PASSWORD = "PERMANENTLY_DISCARDED";
export const CRYPTOCRAWLER_PASSWORD = "PERMANENTLY_DISCARDED";

/**
 * Access zone types - Single admin zone
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
    route: '/administrator',
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
 * Check if provided password and email match the master credentials
 * Returns 'admin' if matched, null otherwise
 * STRICT: Both password AND email must match
 */
export function checkMasterPassword(password: string, email?: string): AccessZone | null {
  // STRICT: Password must be SARBEAR AND email must be rjdclink@outlook.com
  if (password === MASTER_PASSWORD && email?.toLowerCase() === MASTER_EMAIL.toLowerCase()) {
    return 'admin';
  }
  return null;
}

/**
 * Check if provided password is the master password
 * NOTE: This alone is NOT sufficient for auth - email must also match
 */
export function isMasterPassword(password: string): boolean {
  return password === MASTER_PASSWORD;
}

/**
 * @deprecated - Permanently discarded
 */
export function isOrchestratorPassword(_password: string): boolean {
  return false;
}

/**
 * @deprecated - Permanently discarded
 */
export function isCryptoCrawlerPassword(_password: string): boolean {
  return false;
}

/**
 * Get the access zone config if credentials match
 */
export function getAccessZoneConfig(password: string, email?: string): AccessZoneConfig | null {
  const zone = checkMasterPassword(password, email);
  return zone ? ACCESS_ZONES[zone] : null;
}

/**
 * Generate a consistent user ID for master password logins
 * Uses the master email hash
 */
export function generateMasterUserId(_email: string | null | undefined, _zone: AccessZone = 'admin'): string {
  // Always use the canonical master email for ID generation
  return `admin-${crypto.createHash('sha256').update(MASTER_EMAIL.toLowerCase()).digest('hex').slice(0, 16)}`;
}

/**
 * Get the email to use for master password login
 * Always returns the canonical master email
 */
export function getMasterUserEmail(_email: string | null | undefined, _zone: AccessZone = 'admin'): string {
  return MASTER_EMAIL;
}
