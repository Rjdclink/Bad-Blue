/**
 * Authentication Middleware for Subscription System
 * Extends existing authentication to include subscription status checking
 */
import { Request, Response, NextFunction } from 'express';
import db from '../lib/db';
import { getPlatformUserId } from '../authIdentity';

// Extend Express session types
declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}

function getAuthenticatedUserId(req: Request): string | undefined {
  if (!req.isAuthenticated?.()) return undefined;
  return getPlatformUserId(req.user);
}

/**
 * Ensure user is authenticated
 * Checks if userId exists in session
 */
export async function ensureAuthenticated(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!getAuthenticatedUserId(req)) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/**
 * Ensure user has active subscription
 * Checks both authentication and subscription status
 * Required for accessing welcome page and legal tools
 */
export async function ensureActiveSubscription(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // First check authentication
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Check user subscription status
    const result = await db.query(
      'SELECT status FROM users WHERE id = $1',
      [userId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userStatus = result.rows[0].status;

    // Allow access only if status is 'active'
    if (userStatus !== 'active') {
      return res.status(403).json({ 
        error: 'Active subscription required',
        status: userStatus,
        message: userStatus === 'pending_payment' 
          ? 'Please complete your subscription payment'
          : userStatus === 'past_due'
          ? 'Your subscription payment is past due'
          : userStatus === 'canceled'
          ? 'Your subscription has been canceled'
          : 'Your subscription is not active'
      });
    }

    // User has active subscription - continue
    next();
  } catch (error) {
    console.error('Subscription check error:', error);
    return res.status(500).json({ error: 'Failed to verify subscription status' });
  }
}

/**
 * Optional: Check if user has any subscription record
 * Useful for determining if user needs to go through signup vs just needs payment
 */
export async function hasSubscription(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const result = await db.query(
      'SELECT id FROM subscriptions WHERE user_id = $1 LIMIT 1',
      [userId]
    );

    // Attach hasSubscription flag to request object for use in routes
    (req as any).hasSubscription = result.rows.length > 0;
    next();
  } catch (error) {
    console.error('Subscription lookup error:', error);
    return res.status(500).json({ error: 'Failed to check subscription' });
  }
}

export default {
  ensureAuthenticated,
  ensureActiveSubscription,
  hasSubscription
};
