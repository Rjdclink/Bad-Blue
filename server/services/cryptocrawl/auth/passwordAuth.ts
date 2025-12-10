/**
 * CryptoCrawl Authentication System
 * 
 * Password-only authentication for the CryptoCrawler platform
 * NO email required - just the master password
 */

import crypto from 'crypto';

// Master password hash (pre-computed)
// Password: crptcrwlr
const MASTER_PASSWORD_HASH = crypto.createHash('sha256')
  .update('crptcrwlr')
  .digest('hex');

export interface AuthResult {
  success: boolean;
  token?: string;
  expiresAt?: number;
  error?: string;
}

// Active sessions stored in memory (in production, use Redis or similar)
const activeSessions: Map<string, { createdAt: number; expiresAt: number }> = new Map();

// Session duration: 24 hours
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Authenticate with master password
 * Returns a session token on success
 */
export function authenticateWithPassword(password: string): AuthResult {
  // Hash the provided password
  const providedHash = crypto.createHash('sha256')
    .update(password)
    .digest('hex');
  
  // Compare with stored hash
  if (providedHash !== MASTER_PASSWORD_HASH) {
    return {
      success: false,
      error: 'Invalid password'
    };
  }
  
  // Generate session token
  const token = generateSessionToken();
  const now = Date.now();
  const expiresAt = now + SESSION_DURATION_MS;
  
  // Store session
  activeSessions.set(token, {
    createdAt: now,
    expiresAt
  });
  
  // Clean up expired sessions
  cleanupExpiredSessions();
  
  return {
    success: true,
    token,
    expiresAt
  };
}

/**
 * Validate a session token
 */
export function validateSessionToken(token: string): boolean {
  const session = activeSessions.get(token);
  
  if (!session) {
    return false;
  }
  
  // Check if session has expired
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return false;
  }
  
  return true;
}

/**
 * Revoke a session token
 */
export function revokeSession(token: string): boolean {
  return activeSessions.delete(token);
}

/**
 * Get session info
 */
export function getSessionInfo(token: string): { valid: boolean; expiresIn?: number } {
  const session = activeSessions.get(token);
  
  if (!session) {
    return { valid: false };
  }
  
  const expiresIn = session.expiresAt - Date.now();
  
  if (expiresIn <= 0) {
    activeSessions.delete(token);
    return { valid: false };
  }
  
  return {
    valid: true,
    expiresIn: Math.floor(expiresIn / 1000) // seconds
  };
}

/**
 * Generate a cryptographically secure session token
 */
function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Clean up expired sessions
 */
function cleanupExpiredSessions(): void {
  const now = Date.now();
  
  for (const [token, session] of activeSessions.entries()) {
    if (now > session.expiresAt) {
      activeSessions.delete(token);
    }
  }
}

/**
 * Middleware for Express routes that require authentication
 */
export function requireCryptoCrawlAuth(req: any, res: any, next: any): void {
  const authHeader = req.headers.authorization;
  
  // Check for Bearer token
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    if (validateSessionToken(token)) {
      next();
      return;
    }
  }
  
  res.status(401).json({
    success: false,
    error: 'Unauthorized. Please authenticate with the master password.',
    authEndpoint: '/api/cryptocrawl/auth'
  });
}

/**
 * Check if password is correct (for validation without creating session)
 */
export function checkPassword(password: string): boolean {
  const providedHash = crypto.createHash('sha256')
    .update(password)
    .digest('hex');
  
  return providedHash === MASTER_PASSWORD_HASH;
}

export default {
  authenticateWithPassword,
  validateSessionToken,
  revokeSession,
  getSessionInfo,
  requireCryptoCrawlAuth,
  checkPassword
};
