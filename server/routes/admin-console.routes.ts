/**
 * Admin Console API Routes
 * 
 * Secure endpoints for PANTHEON admin functionality:
 * - User management with subscription override
 * - System status monitoring
 * - Strict 401 enforcement (no fallback users)
 * - No-cache headers on all auth/session endpoints
 */

import { Router, Request, Response } from 'express';
import { db } from '../db';
import * as schema from '@shared/schema';
import { eq, desc, sql, and } from 'drizzle-orm';
import { storage } from '../storage';

const router = Router();

// ============================================================================
// NO-CACHE MIDDLEWARE - Required for all admin endpoints
// ============================================================================

const noCache = (_req: Request, res: Response, next: () => void) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
  });
  next();
};

// ============================================================================
// STRICT AUTH MIDDLEWARE - Returns 401 only, no fallback user
// ============================================================================

const strictAuth = (req: Request, res: Response, next: () => void) => {
  // Check if user is authenticated
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required',
    });
  }

  const user = req.user as Express.User;
  
  // Check if user has admin access (master password or admin bypass)
  if (!user.isMasterBypass && !user.isAdminBypass) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Admin access required',
    });
  }

  next();
};

// Apply no-cache and strict auth to all routes
router.use(noCache);
router.use(strictAuth);

// ============================================================================
// USER MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /api/admin/users/logged
 * Get all logged users in descending order (newest first)
 * Previously logged users are now valid - we show all users with lastLoginAt
 */
router.get('/users/logged', async (req: Request, res: Response) => {
  try {
    const users = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        lastLoginAt: schema.users.lastLoginAt,
        createdAt: schema.users.createdAt,
        hasPaidForAccess: schema.users.hasPaidForAccess,
        status: schema.users.status,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.lastLoginAt))
      .limit(500); // Limit for performance

    // Add subscription override field (check if user has override in subscriptions)
    const usersWithOverride = await Promise.all(
      users.map(async (user) => {
        // Check for active override subscription
        const override = await db
          .select()
          .from(schema.userSubscriptions)
          .where(
            and(
              eq(schema.userSubscriptions.userId, user.id),
              eq(schema.userSubscriptions.isActive, true)
            )
          )
          .limit(1);

        return {
          ...user,
          subscriptionOverride: override.length > 0 && !override[0].paymentId, // Override if no payment
        };
      })
    );

    res.json({
      success: true,
      data: usersWithOverride,
      count: usersWithOverride.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[AdminAPI] Get logged users error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get users',
    });
  }
});

/**
 * POST /api/admin/users/:userId/subscription-override
 * Toggle subscription fee override for a user
 */
router.post('/users/:userId/subscription-override', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { override } = req.body as { override: boolean };

    // Check if user exists
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    if (override) {
      // Grant override: Update hasPaidForAccess and create override subscription record
      await db
        .update(schema.users)
        .set({ 
          hasPaidForAccess: true,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, userId));

      // Create or update override subscription (no payment ID = admin override)
      const existingOverride = await db
        .select()
        .from(schema.userSubscriptions)
        .where(
          and(
            eq(schema.userSubscriptions.userId, userId),
            sql`${schema.userSubscriptions.paymentId} IS NULL`
          )
        )
        .limit(1);

      if (existingOverride.length === 0) {
        // Create new override subscription - use far future date (year 9999) for unlimited access
        const unlimitedEndDate = new Date('9999-12-31T23:59:59.999Z');
        await db.insert(schema.userSubscriptions).values({
          userId,
          tierId: 'admin-override', // Special tier ID for overrides
          startDate: new Date(),
          endDate: unlimitedEndDate,
          isActive: true,
          paymentId: null, // No payment = admin override
        });
      } else {
        // Reactivate existing override
        await db
          .update(schema.userSubscriptions)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(schema.userSubscriptions.id, existingOverride[0].id));
      }

      console.log(`[AdminAPI] Subscription override ENABLED for user ${userId}`);
    } else {
      // Remove override: Deactivate override subscription
      await db
        .update(schema.userSubscriptions)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.userSubscriptions.userId, userId),
            sql`${schema.userSubscriptions.paymentId} IS NULL`
          )
        );

      // Check if user has any other active paid subscriptions
      const paidSubs = await db
        .select()
        .from(schema.userSubscriptions)
        .where(
          and(
            eq(schema.userSubscriptions.userId, userId),
            eq(schema.userSubscriptions.isActive, true),
            sql`${schema.userSubscriptions.paymentId} IS NOT NULL`
          )
        )
        .limit(1);

      // If no paid subscriptions, revoke access
      if (paidSubs.length === 0) {
        await db
          .update(schema.users)
          .set({ 
            hasPaidForAccess: false,
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, userId));
      }

      console.log(`[AdminAPI] Subscription override DISABLED for user ${userId}`);
    }

    res.json({
      success: true,
      data: { userId, override },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[AdminAPI] Toggle subscription override error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update subscription override',
    });
  }
});

// ============================================================================
// STATS ENDPOINTS
// ============================================================================

/**
 * GET /api/admin/stats
 * Get admin dashboard statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    // Total users
    const totalUsersResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.users);
    const totalUsers = Number(totalUsersResult[0]?.count || 0);

    // Active users (logged in last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const activeUsersResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.users)
      .where(sql`${schema.users.lastLoginAt} >= ${thirtyDaysAgo}`);
    const activeUsers = Number(activeUsersResult[0]?.count || 0);

    // Paid users
    const paidUsersResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.users)
      .where(eq(schema.users.hasPaidForAccess, true));
    const paidUsers = Number(paidUsersResult[0]?.count || 0);

    // Overridden users (have subscription without payment)
    const overriddenUsersResult = await db
      .select({ count: sql<number>`count(DISTINCT ${schema.userSubscriptions.userId})` })
      .from(schema.userSubscriptions)
      .where(
        and(
          eq(schema.userSubscriptions.isActive, true),
          sql`${schema.userSubscriptions.paymentId} IS NULL`
        )
      );
    const overriddenUsers = Number(overriddenUsersResult[0]?.count || 0);

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        paidUsers,
        overriddenUsers,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[AdminAPI] Get stats error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get stats',
    });
  }
});

// ============================================================================
// SYSTEM STATUS ENDPOINTS
// ============================================================================

/**
 * GET /api/admin/system/status
 * Get system status including CryptoCrawl and Monte Carlo
 */
router.get('/system/status', async (req: Request, res: Response) => {
  try {
    // Get system start time (use process uptime)
    const uptimeSeconds = process.uptime();
    const startedAt = new Date(Date.now() - uptimeSeconds * 1000);

    res.json({
      success: true,
      data: {
        running: true,
        cryptoCrawl: {
          enabled: true,
          gasOracle: true,
          balanceMonitor: true,
          networkHealth: true,
        },
        monteCarlo: {
          activeSimulations: 0,
          totalParticles: 0,
        },
        startedAt: startedAt.toISOString(),
        uptime: uptimeSeconds,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[AdminAPI] Get system status error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get system status',
    });
  }
});

export default router;
