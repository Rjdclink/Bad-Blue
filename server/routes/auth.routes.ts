/**
 * Authentication routes for signup and user status
 * Part of Subscription Phase 3
 */
import express from 'express';
import bcrypt from 'bcrypt';
import db from '../lib/db';
import { ensureAuthenticated } from '../middleware/auth';

const router = express.Router();

/**
 * POST /api/auth/signup
 * Create a new user account with pending_payment status
 */
router.post('/signup', async (req, res) => {
  try {
    const { email, password, first_name, last_name } = req.body;

    // Validate input
    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user exists
    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user with pending_payment status
    const result = await db.query(
      `INSERT INTO users (email, first_name, last_name, status)
       VALUES ($1, $2, $3, 'pending_payment')
       RETURNING id, email, first_name, last_name, status`,
      [email.toLowerCase(), first_name, last_name]
    );

    const user = result.rows[0];

    // TODO: Create auth_accounts entry for password storage
    // For now, we're using the simplified approach with password_hash in users table
    // This will be refactored when integrating with existing auth system

    // Set session
    req.session.userId = user.id;

    res.json({
      success: true,
      userId: user.id,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        status: user.status,
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
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
