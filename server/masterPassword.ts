// Master Password Configuration and Utilities
// Centralized master password logic to avoid code duplication
import crypto from "crypto";

/**
 * The master password that bypasses payment and authentication requirements
 * This password works with ANY email or without email
 */
export const MASTER_PASSWORD = "SARBEAR";

/**
 * Check if provided password matches the master password
 */
export function isMasterPassword(password: string): boolean {
  return password === MASTER_PASSWORD;
}

/**
 * Generate a consistent user ID for master password logins
 * Uses email if provided, otherwise generates a random ID
 */
export function generateMasterUserId(email: string | null | undefined): string {
  if (email && email.trim()) {
    return `master-${crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 16)}`;
  } else {
    return `master-${crypto.randomBytes(8).toString('hex')}`;
  }
}

/**
 * Get the email to use for master password login
 * Uses provided email or a default internal email
 */
export function getMasterUserEmail(email: string | null | undefined): string {
  return (email && email.trim()) ? email : "master@badblue.internal";
}
