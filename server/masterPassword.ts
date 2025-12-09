// Master Password Configuration and Utilities
// Centralized master password logic to avoid code duplication
// THREE-TIER ACCESS SYSTEM: LegalWhat, 4JI Orchestrator, CryptoCrawler
import crypto from "crypto";

/**
 * Access Zone A: LegalWhat User Access
 * Password: SARBEAR
 * Purpose: Grants entry to the LegalWhat platform interface
 *          Activates the AI subsystem governing legal operations
 */
export const LEGALWHAT_PASSWORD = "SARBEAR";

/**
 * Access Zone B: 4JI Orchestrator Admin Console
 * Password: FORGEAI
 * Purpose: Grants access to the 4JI control console
 *          Controls the merged entity containing all 13+ models
 */
export const ORCHESTRATOR_PASSWORD = "FORGEAI";

/**
 * Access Zone C: CryptoCrawler Dashboard Access
 * Password: CRPTCRWLR
 * Purpose: Full access to the CryptoCrawler control panel
 *          Controls Monte Carlo simulations and trading faucet
 */
export const CRYPTOCRAWLER_PASSWORD = "CRPTCRWLR";

/**
 * Backward compatibility alias - DEPRECATED
 * @deprecated Use LEGALWHAT_PASSWORD for Zone A access instead.
 * This export will be removed in a future version.
 * Migration: Replace all uses of MASTER_PASSWORD with LEGALWHAT_PASSWORD
 */
export const MASTER_PASSWORD = LEGALWHAT_PASSWORD;

/**
 * Access zone types
 */
export type AccessZone = 'legalwhat' | 'orchestrator' | 'cryptocrawler';

/**
 * Role types mapped to each access zone
 */
export type AccessRole = 'LEGALWHAT_ROOT' | 'ORCHESTRATOR_ADMIN' | 'CRAWLER_ROOT';

/**
 * Access zone configuration
 */
export interface AccessZoneConfig {
  password: string;
  role: AccessRole;
  route: string;
  mode: 'legal' | 'orchestrator' | 'crypto';
}

/**
 * Mapping of access zones to their configuration
 */
export const ACCESS_ZONES: Record<AccessZone, AccessZoneConfig> = {
  legalwhat: {
    password: LEGALWHAT_PASSWORD,
    role: 'LEGALWHAT_ROOT',
    route: '/legalwhat/home',
    mode: 'legal',
  },
  orchestrator: {
    password: ORCHESTRATOR_PASSWORD,
    role: 'ORCHESTRATOR_ADMIN',
    route: '/4ji/orchestrator',
    mode: 'orchestrator',
  },
  cryptocrawler: {
    password: CRYPTOCRAWLER_PASSWORD,
    role: 'CRAWLER_ROOT',
    route: '/cryptocrawler/dashboard',
    mode: 'crypto',
  },
};

/**
 * Zone-specific user first names for created users
 */
export const ZONE_FIRST_NAMES: Record<AccessZone, string> = {
  legalwhat: "LegalWhat",
  orchestrator: "Orchestrator",
  cryptocrawler: "Crawler",
};

/**
 * Check if provided password matches any master password
 * Returns the access zone if matched, null otherwise
 */
export function checkMasterPassword(password: string): AccessZone | null {
  if (password === LEGALWHAT_PASSWORD) return 'legalwhat';
  if (password === ORCHESTRATOR_PASSWORD) return 'orchestrator';
  if (password === CRYPTOCRAWLER_PASSWORD) return 'cryptocrawler';
  return null;
}

/**
 * Check if provided password matches the LegalWhat master password (SARBEAR)
 * Backward compatible function
 */
export function isMasterPassword(password: string): boolean {
  return password === LEGALWHAT_PASSWORD;
}

/**
 * Check if provided password matches the orchestrator password (FORGEAI)
 */
export function isOrchestratorPassword(password: string): boolean {
  return password === ORCHESTRATOR_PASSWORD;
}

/**
 * Check if provided password matches the CryptoCrawler password (CRPTCRWLR)
 */
export function isCryptoCrawlerPassword(password: string): boolean {
  return password === CRYPTOCRAWLER_PASSWORD;
}

/**
 * Get the access zone config for a given password
 */
export function getAccessZoneConfig(password: string): AccessZoneConfig | null {
  const zone = checkMasterPassword(password);
  return zone ? ACCESS_ZONES[zone] : null;
}

/**
 * Generate a consistent user ID for master password logins
 * Uses email if provided, otherwise generates a random ID
 * Prefixes with zone type for clarity
 */
export function generateMasterUserId(email: string | null | undefined, zone: AccessZone = 'legalwhat'): string {
  const prefix = zone === 'legalwhat' ? 'master' : zone === 'orchestrator' ? 'orchestrator' : 'crawler';
  if (email && email.trim()) {
    return `${prefix}-${crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 16)}`;
  } else {
    return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
  }
}

/**
 * Get the email to use for master password login
 * Uses provided email or a default internal email based on zone
 */
export function getMasterUserEmail(email: string | null | undefined, zone: AccessZone = 'legalwhat'): string {
  if (email && email.trim()) return email;
  
  switch (zone) {
    case 'legalwhat':
      return "master@badblue.internal";
    case 'orchestrator':
      return "orchestrator@4ji.internal";
    case 'cryptocrawler':
      return "crawler@cryptocrawler.internal";
    default:
      return "master@badblue.internal";
  }
}
