/**
 * Compatibility subscription/status route.
 *
 * Canonical authentication issuance and durable access state live in server/auth.ts.
 * This route deliberately delegates to that authority and performs no independent
 * database/session/subscription decision.
 */
import express from 'express';
import { isIdentityAuthenticated, refreshRequestUser } from '../auth';

const router = express.Router();

/**
 * GET /api/auth/user/status
 * Legacy-compatible status shape backed by the canonical durable auth authority.
 */
router.get('/user/status', isIdentityAuthenticated, async (req, res) => {
  try {
    const fresh = await refreshRequestUser(req, res);
    if (!fresh) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const status = String(fresh.status || 'pending_payment');
    const hasPaidForAccess = fresh.hasPaidForAccess === true;

    return res.json({
      user: {
        id: fresh.id,
        email: fresh.email,
        first_name: fresh.firstName ?? null,
        last_name: fresh.lastName ?? null,
        status,
        square_customer_id: null,
        has_paid_for_access: hasPaidForAccess,
      },
      subscription: {
        status,
        active: hasPaidForAccess,
      },
      authority: 'canonical-local-auth',
    });
  } catch (error) {
    console.error('User status error:', error);
    return res.status(503).json({ error: 'Subscription status is temporarily unavailable' });
  }
});

export function setupAuthRoutes(app: express.Application) {
  app.use('/api/auth', router);
}
