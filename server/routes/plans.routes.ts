/**
 * Plans API routes
 * Part of Subscription Phase 3
 */
import express from 'express';
import db from '../lib/db';

const router = express.Router();

/**
 * GET /api/plans
 * Get all active subscription plans
 */
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, price, currency, interval, square_plan_id
       FROM plans
       WHERE is_active = true
       ORDER BY price ASC`
    );

    const plans = result.rows.map(plan => ({
      id: plan.id,
      name: plan.name,
      price: plan.price,
      priceFormatted: `$${(plan.price / 100).toFixed(2)}`,
      currency: plan.currency,
      interval: plan.interval,
      squarePlanId: plan.square_plan_id,
    }));

    res.json({ plans });
  } catch (error) {
    console.error('Plans fetch error:', error);
    res.status(500).json({ error: 'Failed to retrieve plans' });
  }
});

/**
 * GET /api/plans/:id
 * Get a specific plan by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT id, name, price, currency, interval, square_plan_id
       FROM plans
       WHERE id = $1 AND is_active = true`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const plan = result.rows[0];

    res.json({
      plan: {
        id: plan.id,
        name: plan.name,
        price: plan.price,
        priceFormatted: `$${(plan.price / 100).toFixed(2)}`,
        currency: plan.currency,
        interval: plan.interval,
        squarePlanId: plan.square_plan_id,
      },
    });
  } catch (error) {
    console.error('Plan fetch error:', error);
    res.status(500).json({ error: 'Failed to retrieve plan' });
  }
});

export function setupPlansRoutes(app: express.Application) {
  app.use('/api/plans', router);
}
