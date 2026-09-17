// Master Password Configuration and Utilities
// SINGLE MASTER PASSWORD SYSTEM - password-only administrator access
import crypto from "crypto";

/**
 * The master password is intentionally stored only as a SHA-256 digest in source.
 * This preserves the requested fixed password without exposing the plaintext in
 * browser code or deployment configuration. Master authentication never depends
 * on an email address.
 */
const MASTER_PASSWORD_SHA256 = "f885c6ded699d8c970055152f35d09fca76c14e76fcb22532e84934c8b5c1908";
const MASTER_INTERNAL_EMAIL = "master@legalwhat.internal";
const MASTER_USER_ID = "admin-master-root";

function digest(value: string): string {
  return crypto.createHash("sha256").update(value || "").digest("hex");
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
 * Single admin zone configuration.
 * Master access starts on the LegalWhat welcome surface; the persistent master
 * navigator then cycles through every registered master panel.
 */
export const ACCESS_ZONES: Record<AccessZone, AccessZoneConfig> = {
  admin: {
    role: 'ADMIN_ROOT',
    route: '/welcome',
    mode: 'admin',
  },
};

export const ZONE_FIRST_NAMES: Record<AccessZone, string> = {
  admin: "PANTHEON",
};

/**
 * Password-only master credential check. The email argument is retained for
 * backwards-compatible callers but is deliberately ignored.
 */
export function checkMasterPassword(password: string, _email?: string): AccessZone | null {
  return safeEquals(digest(password), MASTER_PASSWORD_SHA256) ? 'admin' : null;
}

export function isMasterPassword(password: string): boolean {
  return checkMasterPassword(password) === 'admin';
}

/** @deprecated - Permanently discarded */
export function isOrchestratorPassword(_password: string): boolean {
  return false;
}

/** @deprecated - Permanently discarded */
export function isCryptoCrawlerPassword(_password: string): boolean {
  return false;
}

export function getAccessZoneConfig(password: string, email?: string): AccessZoneConfig | null {
  const zone = checkMasterPassword(password, email);
  return zone ? ACCESS_ZONES[zone] : null;
}

/**
 * Stable synthetic identity for the master session. It is not a login credential.
 */
export function generateMasterUserId(_email: string | null | undefined, _zone: AccessZone = 'admin'): string {
  return MASTER_USER_ID;
}

/**
 * Internal persistence email only. The user never has to enter it.
 */
export function getMasterUserEmail(_email: string | null | undefined, _zone: AccessZone = 'admin'): string {
  return MASTER_INTERNAL_EMAIL;
}
