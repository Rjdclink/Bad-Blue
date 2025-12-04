/**
 * Square Webhook Handler
 * Handles webhook events from Square for subscription status changes
 * Part of Subscription Phase 2 - Square Integration
 */
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import db from '../lib/db';

const router = express.Router();

/**
 * Verify Square webhook signature
 * Must be called BEFORE any body parsing middleware
 * See: https://developer.squareup.com/docs/webhooks/step3validate
 */
function verifySquareSignature(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;

  if (!signatureKey) {
    console.error('SQUARE_WEBHOOK_SIGNATURE_KEY not configured');
    return res.status(500).json({ error: 'Webhook configuration error' });
  }

  if (!notificationUrl) {
    console.warn('SQUARE_WEBHOOK_NOTIFICATION_URL not configured - signature verification may fail');
  }

  // Get signature from header
  const signatureHeader = req.headers['x-square-hmacsha256-signature'];
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    console.error('Missing or invalid signature header');
    return res.status(401).json({ error: 'Missing signature' });
  }

  // Trim any whitespace/newlines from signature
  const signature = signatureHeader.trim();

  // Get raw body (must be string or buffer, not parsed JSON)
  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    console.error('Raw body not available - ensure webhook route is before body parser');
    return res.status(500).json({ error: 'Webhook configuration error' });
  }

  // Construct string to sign: notification_url + raw_body
  // Note: No separators between URL and body
  const stringToSign = (notificationUrl || '') + rawBody;

  // Compute HMAC-SHA256
  const hmac = crypto.createHmac('sha256', signatureKey);
  hmac.update(stringToSign, 'utf8');
  const computedSignature = hmac.digest('base64');

  // Compare signatures using timing-safe comparison
  try {
    const signatureBuffer = Buffer.from(signature, 'base64');
    const computedBuffer = Buffer.from(computedSignature, 'base64');

    if (signatureBuffer.length !== computedBuffer.length) {
      console.error('Signature length mismatch');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    if (!crypto.timingSafeEqual(signatureBuffer, computedBuffer)) {
      console.error('Signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Signature valid
    next();
  } catch (error) {
    console.error('Signature comparison error:', error);
    return res.status(401).json({ error: 'Invalid signature' });
  }
}

/**
 * POST /api/square/webhook
 * Handle Square webhook events
 */
router.post('/webhook', verifySquareSignature, async (req: Request, res: Response) => {
  try {
    const event = req.body;

    console.log('Square webhook received:', {
      type: event.type,
      merchant_id: event.merchant_id,
      location_id: event.location_id,
      event_id: event.event_id,
    });

    // Extract event data
    const eventType = event.type;
    const data = event.data?.object;

    if (!data) {
      console.warn('Webhook event has no data object');
      return res.status(200).json({ received: true });
    }

    // Handle subscription events
    if (eventType === 'subscription.created' || eventType === 'subscription.updated') {
      await handleSubscriptionEvent(event, data);
    } 
    else if (eventType === 'payment.created' || eventType === 'payment.updated') {
      await handlePaymentEvent(event, data);
    }
    else if (eventType === 'customer.created' || eventType === 'customer.updated') {
      await handleCustomerEvent(event, data);
    }
    else {
      console.log(`Unhandled event type: ${eventType}`);
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook processing error:', error);
    // Still return 200 to prevent retries for processing errors
    res.status(200).json({ received: true, error: 'Processing failed' });
  }
});

/**
 * Handle subscription lifecycle events
 */
async function handleSubscriptionEvent(event: any, subscription: any) {
  const squareSubscriptionId = subscription.id;
  const customerId = subscription.customer_id;
  const status = subscription.status; // ACTIVE, CANCELED, PAUSED, etc.

  console.log('Processing subscription event:', {
    subscription_id: squareSubscriptionId,
    customer_id: customerId,
    status,
  });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Find user by square_customer_id
    const userResult = await client.query(
      'SELECT id FROM users WHERE square_customer_id = $1',
      [customerId]
    );

    if (userResult.rows.length === 0) {
      console.warn(`No user found with square_customer_id: ${customerId}`);
      await client.query('ROLLBACK');
      return;
    }

    const userId = userResult.rows[0].id;

    // Map Square status to our status
    const userStatus = mapSquareStatusToUserStatus(status);

    // Update user status
    await client.query(
      'UPDATE users SET status = $1 WHERE id = $2',
      [userStatus, userId]
    );

    // Update or insert subscription record
    await client.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, square_subscription_id, start_date, renewal_date, updated_at)
       VALUES ($1, (SELECT id FROM plans WHERE square_plan_id IS NOT NULL LIMIT 1), $2, $3, NOW(), NOW() + INTERVAL '1 month', NOW())
       ON CONFLICT (user_id) 
       DO UPDATE SET status = $2, square_subscription_id = $3, renewal_date = NOW() + INTERVAL '1 month', updated_at = NOW()`,
      [userId, status, squareSubscriptionId]
    );

    // Log transaction
    await client.query(
      `INSERT INTO transactions (user_id, subscription_id, amount, currency, status, event_type, raw_payload, created_at)
       VALUES ($1, (SELECT id FROM subscriptions WHERE user_id = $1), 0, 'USD', $2, $3, $4, NOW())`,
      [userId, status, event.type, JSON.stringify(event)]
    );

    await client.query('COMMIT');
    console.log(`Updated user ${userId} status to ${userStatus}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Database error handling subscription event:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Handle payment events
 */
async function handlePaymentEvent(event: any, payment: any) {
  const paymentId = payment.id;
  const amount = payment.amount_money?.amount || 0;
  const currency = payment.amount_money?.currency || 'USD';
  const status = payment.status;
  const customerId = payment.customer_id;

  console.log('Processing payment event:', {
    payment_id: paymentId,
    amount,
    currency,
    status,
    customer_id: customerId,
  });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Find user by square_customer_id
    const userResult = await client.query(
      'SELECT id FROM users WHERE square_customer_id = $1',
      [customerId]
    );

    if (userResult.rows.length === 0) {
      console.warn(`No user found with square_customer_id: ${customerId}`);
      await client.query('ROLLBACK');
      return;
    }

    const userId = userResult.rows[0].id;

    // Log transaction
    await client.query(
      `INSERT INTO transactions (user_id, subscription_id, square_payment_id, amount, currency, status, event_type, raw_payload, created_at)
       VALUES ($1, (SELECT id FROM subscriptions WHERE user_id = $1), $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, paymentId, amount, currency, status, event.type, JSON.stringify(event)]
    );

    // If payment completed, ensure user is active
    if (status === 'COMPLETED') {
      await client.query(
        'UPDATE users SET status = $1 WHERE id = $2 AND status = $3',
        ['active', userId, 'pending_payment']
      );
    }

    await client.query('COMMIT');
    console.log(`Logged payment for user ${userId}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Database error handling payment event:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Handle customer events
 */
async function handleCustomerEvent(event: any, customer: any) {
  const customerId = customer.id;
  const email = customer.email_address;

  console.log('Processing customer event:', {
    customer_id: customerId,
    email,
    event_type: event.type,
  });

  // Customer events are informational, we don't need to update anything
  // Square customer is created during subscription flow
}

/**
 * Map Square subscription status to our user status
 */
function mapSquareStatusToUserStatus(squareStatus: string): string {
  const statusMap: Record<string, string> = {
    'PENDING': 'pending_payment',
    'ACTIVE': 'active',
    'CANCELED': 'canceled',
    'PAUSED': 'past_due',
    'DEACTIVATED': 'expired',
  };

  return statusMap[squareStatus] || 'expired';
}

export function setupSquareRoutes(app: express.Express) {
  app.use('/api/square', router);
}
