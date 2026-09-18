/**
 * Legacy compatibility exports.
 *
 * Canonical authentication and paid-access authority lives in server/auth.ts.
 * Do not add independent database/session subscription checks here.
 */
import { type Request, type Response, type NextFunction } from 'express';
import {
  hasPaidServiceAccess,
  isAuthenticated as canonicalPaidAccess,
  isIdentityAuthenticated as canonicalIdentity,
  refreshRequestUser,
} from '../auth';

export const ensureAuthenticated = canonicalIdentity;
export const ensureActiveSubscription = canonicalPaidAccess;

/**
 * Compatibility helper for older callers that only need to know whether the
 * canonical identity currently has any durable subscription/access state.
 */
export async function hasSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const user = await refreshRequestUser(req, res);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    (req as any).hasSubscription = hasPaidServiceAccess(user);
    return next();
  } catch (error) {
    console.error('Subscription lookup error:', error);
    return res.status(503).json({ error: 'Failed to check subscription' });
  }
}

export default {
  ensureAuthenticated,
  ensureActiveSubscription,
  hasSubscription,
};
