// Master Password Configuration and Utilities
// SINGLE MASTER PASSWORD SYSTEM - Admin Console Access
import crypto from "crypto";

/**
 * SINGLE MASTER PASSWORD
 * Grants access to PANTHEON Admin Console
 */
function getMasterEmail(): string {
  return process.env.MASTER_ADMIN_EMAIL?.trim().toLowerCase() || '';
}

function getMasterPassword(): string {
  return process.env.MASTER_ADMIN_PASSWORD || '';
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && leftBuffer.length > 0 && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

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
  role: AccessRole;
  route: string;
  mode: 'admin';
}

/**
 * Single admin zone configuration
 */
export const ACCESS_ZONES: Record<AccessZone, AccessZoneConfig> = {
  admin: {
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
  const masterEmail = getMasterEmail();
  const masterPassword = getMasterPassword();
  if (safeEquals(password, masterPassword) && safeEquals(email?.trim().toLowerCase() || '', masterEmail)) {
    return 'admin';
  }
  return null;
}

/**
 * Check if provided password is the master password
 * NOTE: This alone is NOT sufficient for auth - email must also match
 */
export function isMasterPassword(password: string): boolean {
  return safeEquals(password, getMasterPassword());
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
  const masterEmail = getMasterEmail();
  if (!masterEmail) throw new Error('MASTER_ADMIN_EMAIL is not configured');
  return `admin-${crypto.createHash('sha256').update(masterEmail).digest('hex').slice(0, 16)}`;
}

/**
 * Get the email to use for master password login
 * Always returns the canonical master email
 */
export function getMasterUserEmail(_email: string | null | undefined, _zone: AccessZone = 'admin'): string {
  const masterEmail = getMasterEmail();
  if (!masterEmail) throw new Error('MASTER_ADMIN_EMAIL is not configured');
  return masterEmail;
}
