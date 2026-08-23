/**
 * Authentication routes for signup and user status
 * Part of Subscription Phase 3
 */
import express from 'express';
import db from '../lib/db';
import { ensureAuthenticated } from '../middleware/auth';
import { registerLocalUser } from '../localAuth';

const router = express.Router();

/**
 * POST /api/auth/signup
 * Create a new user account with pending_payment status
 */
router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    const firstName = req.body.firstName || req.body.first_name;
    const lastName = req.body.lastName || req.body.last_name;

    // Validate input
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const { user } = await registerLocalUser(email, password, firstName, lastName);

    res.json({
      success: true,
      userId: user.id,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        status: user.status,
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    if (error instanceof Error && (error.message === 'Email already registered' || error.message.includes('required') || error.message.includes('Password'))) {
      return res.status(error.message === 'Email already registered' ? 409 : 400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

/**
 * GET /api/auth/user/status
 * Get current user's status and subscription info
 */
router.get('/user/status', ensureAuthenticated, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, first_name, last_name, status, square_customer_id
       FROM users 
       WHERE id = $1`,
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Get subscription info if exists
    const subResult = await db.query(
      `SELECT s.id, s.status, s.square_subscription_id, s.start_date, s.renewal_date,
              p.name as plan_name, p.price, p.currency, p.interval
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [req.session.userId]
    );

    const subscription = subResult.rows[0] || null;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        status: user.status,
        square_customer_id: user.square_customer_id,
      },
      subscription,
    });
  } catch (error) {
    console.error('User status error:', error);
    res.status(500).json({ error: 'Failed to retrieve user status' });
  }
});

/**
 * GET /api/auth/logout
 * Logout current user
 */
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

export function setupAuthRoutes(app: express.Application) {
  app.use('/api/auth', router);
}
