/**
 * Subscription/status routes that depend on an already-established identity.
 *
 * Authentication issuance is intentionally NOT defined here. Canonical login,
 * registration, session, and logout authority lives in server/auth.ts.
 */
import express from 'express';
import db from '../lib/db';
import { ensureAuthenticated } from '../middleware/auth';
import { getPlatformUserId } from '../authIdentity';

const router = express.Router();

/**
 * GET /api/auth/user/status
 * Get current user's status and subscription info.
 */
router.get('/user/status', ensureAuthenticated, async (req, res) => {
  try {
    const userId = getPlatformUserId(req.user);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await db.query(
      `SELECT id, email, first_name, last_name, status, square_customer_id
       FROM users
       WHERE id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    const subResult = await db.query(
      `SELECT s.id, s.status, s.square_subscription_id, s.start_date, s.renewal_date,
              p.name as plan_name, p.price, p.currency, p.interval
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [userId],
    );

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        status: user.status,
        square_customer_id: user.square_customer_id,
      },
      subscription: subResult.rows[0] || null,
    });
  } catch (error) {
    console.error('User status error:', error);
    return res.status(503).json({ error: 'Subscription status is temporarily unavailable' });
  }
});

export function setupAuthRoutes(app: express.Application) {
  app.use('/api/auth', router);
}
