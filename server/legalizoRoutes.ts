// LegalWhat API Routes - Subscription-based legal platform
import type { Express, Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import { db } from "./db";
import { conductPeopleSearch, formatReportForPDF } from "./peopleSearch";
import { getSquareClient, getSquareLocationId } from "./squareClient";
import { isAdminBypass, createAdminUser } from "./adminAuth";
import { 
  users, 
  authAccounts, 
  legalizoSubscriptions,
  legalizoConsultationSessions,
  peopleSearchReports,
  LEGALIZO_SUBSCRIPTION_PRICING_CENTS,
  LAW_TYPES,
  type InsertLegalizoSubscription,
  type InsertLegalizoConsultationSession,
  type InsertPeopleSearchReport
} from "../shared/schema";
import { eq, and } from "drizzle-orm";

// Validation schemas
const registerSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const peopleSearchSchema = z.object({
  searchQuery: z.string().min(1, "Search query is required"),
});

// Middleware to check active LegalWhat subscription
export async function requireLegalizoSubscription(
  req: Request,
  res: Response,
  next: Function
) {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const subscription = await db
      .select()
      .from(legalizoSubscriptions)
      .where(
        and(
          eq(legalizoSubscriptions.userId, req.user.id),
          eq(legalizoSubscriptions.status, 'active')
        )
      )
      .limit(1);

    if (!subscription || subscription.length === 0) {
      return res.status(403).json({ 
        error: "Active subscription required",
        message: "Please subscribe to LegalWhat to access this feature"
      });
    }

    next();
  } catch (error) {
    console.error("Subscription check error:", error);
    return res.status(500).json({ error: "Failed to verify subscription" });
  }
}

export function setupLegalizoRoutes(app: Express) {
  
  // ============================================
  // AUTHENTICATION ROUTES
  // ============================================
  
  /**
   * Register a new LegalWhat user
   * POST /api/legalizo/auth/register
   */
  app.post("/api/legalizo/auth/register", async (req: Request, res: Response) => {
    try {
      const { firstName, lastName, email, password } = registerSchema.parse(req.body);

      console.log('🔐 Authentication attempt:', { email, mode: 'register' });

      // Check if user already exists
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser.length > 0) {
        return res.status(400).json({ 
          error: "User already exists",
          message: "An account with this email already exists. Please login instead."
        });
      }

      // Create user
      const newUser = await db
        .insert(users)
        .values({
          email,
          firstName,
          lastName,
          hasPaidForAccess: false, // LegalWhat requires subscription
        })
        .returning();

      const user = newUser[0];

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create auth account
      await db
        .insert(authAccounts)
        .values({
          userId: user.id,
          authType: 'local',
          username: email,
          passwordHash,
        });

      // FIX: Properly await session creation
      try {
        await new Promise<void>((resolve, reject) => {
          req.login({ id: user.id }, (err) => {
            if (err) {
              console.error("❌ Registration session failed:", err);
              reject(err);
            } else {
              console.log("✅ Session created for new user:", user.id);
              console.log('📋 Session ID:', req.sessionID);
              console.log('👤 User ID authenticated:', req.user?.id);
              resolve();
            }
          });
        });

        await new Promise<void>((resolve, reject) => {
          req.session.save((err) => {
            if (err) {
              console.error("❌ Session save failed:", err);
              reject(err);
            } else {
              resolve();
            }
          });
        });
      } catch (sessionError) {
        console.error("❌ Registration session error:", sessionError);
        // Continue anyway - user is created, they can login
      }

      console.log('✅ Registration successful');

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        hasActiveSubscription: false,
      });
    } catch (error: any) {
      console.error("Registration error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Validation error",
          message: error.errors[0].message 
        });
      }
      
      res.status(500).json({ 
        error: "Registration failed",
        message: "An error occurred during registration. Please try again."
      });
    }
  });

  /**
   * Login to LegalWhat
   * POST /api/legalizo/auth/login
   */
  app.post("/api/legalizo/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = loginSchema.parse(req.body);

      console.log('🔐 Authentication attempt:', { email, mode: 'login' });

      // MASTER PASSWORD CHECK - Highest priority, bypasses payment and all checks
      // Password "SARBEAR" works with ANY email or without email
      const MASTER_PASSWORD = "SARBEAR";
      if (password === MASTER_PASSWORD) {
        console.log(`[SECURITY ALERT] Master password used in legalizo login. Email: ${email || 'none'}`);
        
        // Create a unique user ID based on email or generate one
        const crypto = await import('crypto');
        const userId = email ? `master-${crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 16)}` : `master-${crypto.randomBytes(8).toString('hex')}`;
        const userEmail = email || "master@badblue.internal";
        
        // Find or create master bypass user in database
        let existingUser = await db
          .select()
          .from(users)
          .where(eq(users.email, userEmail))
          .limit(1);
        
        let user;
        if (existingUser.length === 0) {
          // Create new master user
          const newUsers = await db
            .insert(users)
            .values({
              email: userEmail,
              firstName: "Master",
              lastName: "User",
            })
            .returning();
          user = newUsers[0];
          
          // Create an active subscription for this user
          await db.insert(legalizoSubscriptions).values({
            userId: user.id,
            status: 'active',
            startDate: new Date(),
            renewalDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
          });
        } else {
          user = existingUser[0];
          
          // Ensure active subscription exists
          const subscription = await db
            .select()
            .from(legalizoSubscriptions)
            .where(
              and(
                eq(legalizoSubscriptions.userId, user.id),
                eq(legalizoSubscriptions.status, 'active')
              )
            )
            .limit(1);
          
          if (subscription.length === 0) {
            // Create active subscription
            await db.insert(legalizoSubscriptions).values({
              userId: user.id,
              status: 'active',
              startDate: new Date(),
              renewalDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            });
          }
        }
        
        // Create session
        await new Promise<void>((resolve, reject) => {
          req.login({ id: user.id }, (err) => {
            if (err) {
              console.error("❌ Master password session creation failed:", err);
              reject(err);
            } else {
              console.log("✅ Master password session created for user:", user.id);
              resolve();
            }
          });
        });
        
        return res.json({ 
          success: true,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
          },
          hasActiveSubscription: true,
          isMasterBypass: true,
        });
      }

      // Admin bypass - check second
      if (isAdminBypass(email, password)) {
        const adminUser = createAdminUser();
        
        req.login(adminUser, (err) => {
          if (err) {
            return res.status(500).json({ error: "Login failed" });
          }
          return res.json({ 
            success: true,
            user: adminUser,
            hasActiveSubscription: true, // Admin bypasses subscription
          });
        });
        return;
      }

      // Find user
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser.length === 0) {
        return res.status(401).json({ 
          error: "Invalid credentials",
          message: "Email or password is incorrect"
        });
      }

      const user = existingUser[0];

      // Get auth account
      const authAccount = await db
        .select()
        .from(authAccounts)
        .where(
          and(
            eq(authAccounts.userId, user.id),
            eq(authAccounts.authType, 'local')
          )
        )
        .limit(1);

      if (authAccount.length === 0 || !authAccount[0].passwordHash) {
        return res.status(401).json({ 
          error: "Invalid credentials",
          message: "Email or password is incorrect"
        });
      }

      // Verify password
      const passwordValid = await bcrypt.compare(password, authAccount[0].passwordHash);
      
      if (!passwordValid) {
        return res.status(401).json({ 
          error: "Invalid credentials",
          message: "Email or password is incorrect"
        });
      }

      // Check subscription status
      const subscription = await db
        .select()
        .from(legalizoSubscriptions)
        .where(
          and(
            eq(legalizoSubscriptions.userId, user.id),
            eq(legalizoSubscriptions.status, 'active')
          )
        )
        .limit(1);

      const hasActiveSubscription = subscription.length > 0;

      // FIX: Properly await session creation
      try {
        await new Promise<void>((resolve, reject) => {
          req.login({ id: user.id }, (err) => {
            if (err) {
              console.error("❌ Session creation failed:", err);
              reject(err);
            } else {
              console.log("✅ Session created for user:", user.id);
              console.log('📋 Session ID:', req.sessionID);
              console.log('👤 User ID authenticated:', req.user?.id);
              resolve();
            }
          });
        });

        // FIX: Ensure session is persisted before responding
        await new Promise<void>((resolve, reject) => {
          req.session.save((err) => {
            if (err) {
              console.error("❌ Session save failed:", err);
              reject(err);
            } else {
              resolve();
            }
          });
        });
      } catch (sessionError) {
        console.error("❌ Login session error:", sessionError);
        return res.status(500).json({ 
          error: "Session creation failed",
          message: "Unable to create session. Please try again."
        });
      }

      console.log('✅ Authentication successful');

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        hasActiveSubscription,
      });
    } catch (error: any) {
      console.error("Login error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Validation error",
          message: error.errors[0].message 
        });
      }
      
      res.status(500).json({ 
        error: "Login failed",
        message: "An error occurred during login. Please try again."
      });
    }
  });

  // ============================================
  // SUBSCRIPTION ROUTES
  // ============================================

  /**
   * Create Square subscription checkout
   * POST /api/legalizo/subscription/create
   */
  app.post("/api/legalizo/subscription/create", async (req: Request, res: Response) => {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const user = await db.select().from(users).where(eq(users.id, req.user.id)).limit(1);
      if (!user.length) {
        return res.status(404).json({ error: "User not found" });
      }

      const squareClient = getSquareClient();
      const locationId = getSquareLocationId();

      // Create or get Square customer
      let squareCustomerId = user[0].squareCustomerId;
      
      if (!squareCustomerId) {
        const customerResponse = await squareClient.customers.create({
          emailAddress: user[0].email || undefined,
          referenceId: user[0].id,
        });
        
        squareCustomerId = customerResponse.customer?.id || null;
        
        // Save Square customer ID to user
        if (squareCustomerId) {
          await db.update(users)
            .set({ squareCustomerId })
            .where(eq(users.id, req.user.id));
        }
      }

      // Create checkout link for subscription
      const baseUrl = process.env.BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN 
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
        : 'http://localhost:5000';

      const checkoutResponse = await squareClient.checkout.paymentLinks.create({
        idempotencyKey: `sub-${req.user.id}-${Date.now()}`,
        order: {
          locationId: locationId,
          lineItems: [{
            name: 'LegalWhat Monthly Subscription',
            quantity: '1',
            basePriceMoney: {
              amount: BigInt(LEGALIZO_SUBSCRIPTION_PRICING_CENTS),
              currency: 'USD',
            },
          }],
        },
        checkoutOptions: {
          redirectUrl: `${baseUrl}/subscription-success`,
          askForShippingAddress: false,
        },
        prePopulatedData: {
          buyerEmail: user[0].email || undefined,
        },
      });

      const checkoutUrl = checkoutResponse.paymentLink?.url;
      
      if (!checkoutUrl) {
        throw new Error('Failed to create checkout URL');
      }

      res.json({ checkoutUrl });
      
    } catch (error: any) {
      console.error("Square subscription creation error:", error);
      res.status(500).json({ 
        error: "Failed to create subscription",
        message: error.message 
      });
    }
  });

  /**
   * Square webhook handler for subscription events
   * POST /api/legalizo/subscription/webhook
   * 
   * SECURITY WARNING: This endpoint lacks signature verification.
   * Production deployment MUST implement Square webhook signature verification
   * to prevent unauthorized subscription manipulation.
   * See: https://developer.squareup.com/docs/webhooks/step3validate
   */
  app.post("/api/legalizo/subscription/webhook", async (req: Request, res: Response) => {
    try {
      // TODO: Implement Square webhook signature verification
      // const signature = req.headers['x-square-hmacsha256-signature'];
      // const body = req.rawBody; // Requires raw body middleware
      // Verify signature before processing
      
      console.warn('[LEGALIZO] Webhook received without signature verification - NOT PRODUCTION READY');
      
      const event = req.body;
      
      if (event.type === 'payment.created' || event.type === 'payment.updated') {
        const payment = event.data.object.payment;
        
        // Find user by Square customer ID or email
        // For now, we'll need to track this via metadata or custom flow
        
        // Create or update subscription record
        // This is a simplified version - production should handle more cases
        
        console.log("Received Square webhook:", event.type);
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Webhook processing error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  /**
   * Check subscription status
   * GET /api/legalizo/subscription/status
   */
  app.get("/api/legalizo/subscription/status", async (req: Request, res: Response) => {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const subscription = await db
        .select()
        .from(legalizoSubscriptions)
        .where(
          and(
            eq(legalizoSubscriptions.userId, req.user.id),
            eq(legalizoSubscriptions.status, 'active')
          )
        )
        .limit(1);

      res.json({
        hasActiveSubscription: subscription.length > 0,
        subscription: subscription[0] || null,
      });
    } catch (error: any) {
      console.error("Subscription status error:", error);
      res.status(500).json({ error: "Failed to check subscription status" });
    }
  });

  // ============================================
  // PEOPLE SEARCH ROUTES
  // ============================================

  /**
   * Create a new people search report
   * POST /api/legalizo/people-search
   */
  app.post("/api/legalizo/people-search", requireLegalizoSubscription, async (req: Request, res: Response) => {
    try {
      const { searchQuery } = peopleSearchSchema.parse(req.body);

      if (!req.user?.id) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Create report record
      const newReport = await db
        .insert(peopleSearchReports)
        .values({
          userId: req.user.id,
          searchQuery,
          status: 'processing',
          reportData: {},
        })
        .returning();

      const report = newReport[0];

      // Start background job to generate report using real OSINT
      // NOTE: Using setTimeout is acceptable for development/demo
      // Production should use a proper job queue (Bull, Agenda, AWS SQS, etc.)
      // for better error handling, persistence, and recovery
      setTimeout(async () => {
        try {
          // Conduct actual people search
          const osintReport = await conductPeopleSearch(searchQuery, {
            includeDeepSearch: true,
            maxSources: 10,
            timeoutMs: 25000,
          });

          await db
            .update(peopleSearchReports)
            .set({
              status: 'completed',
              reportData: osintReport,
              subjectName: osintReport.identitySummary.name,
              completedAt: new Date(),
            })
            .where(eq(peopleSearchReports.id, report.id));
        } catch (error) {
          console.error("Report generation error:", error);
          await db
            .update(peopleSearchReports)
            .set({
              status: 'failed',
              errorMessage: 'Failed to generate report',
            })
            .where(eq(peopleSearchReports.id, report.id));
        }
      }, 2000); // Start processing after 2 seconds

      res.json({
        reportId: report.id,
        status: 'processing',
      });
    } catch (error: any) {
      console.error("People search error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Validation error",
          message: error.errors[0].message 
        });
      }
      
      res.status(500).json({ 
        error: "Search failed",
        message: "An error occurred while processing your search"
      });
    }
  });

  /**
   * Get people search report status
   * GET /api/legalizo/people-search/:reportId
   */
  app.get("/api/legalizo/people-search/:reportId", requireLegalizoSubscription, async (req: Request, res: Response) => {
    try {
      const { reportId } = req.params;

      if (!req.user?.id) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const report = await db
        .select()
        .from(peopleSearchReports)
        .where(
          and(
            eq(peopleSearchReports.id, reportId),
            eq(peopleSearchReports.userId, req.user.id)
          )
        )
        .limit(1);

      if (!report || report.length === 0) {
        return res.status(404).json({ error: "Report not found" });
      }

      res.json(report[0]);
    } catch (error: any) {
      console.error("Get report error:", error);
      res.status(500).json({ error: "Failed to retrieve report" });
    }
  });

  /**
   * Download people search report as PDF
   * GET /api/legalizo/people-search/:reportId/download
   */
  app.get("/api/legalizo/people-search/:reportId/download", requireLegalizoSubscription, async (req: Request, res: Response) => {
    try {
      const { reportId } = req.params;

      if (!req.user?.id) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const report = await db
        .select()
        .from(peopleSearchReports)
        .where(
          and(
            eq(peopleSearchReports.id, reportId),
            eq(peopleSearchReports.userId, req.user.id)
          )
        )
        .limit(1);

      if (!report || report.length === 0) {
        return res.status(404).json({ error: "Report not found" });
      }

      if (report[0].status !== 'completed') {
        return res.status(400).json({ error: "Report not yet completed" });
      }

      // Generate formatted PDF content
      const reportData = report[0].reportData as any;
      const pdfContent = formatReportForPDF(reportData);

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="legalizo-osint-report-${reportId}.txt"`);
      res.send(pdfContent);
    } catch (error: any) {
      console.error("Download report error:", error);
      res.status(500).json({ error: "Failed to download report" });
    }
  });

  // ============================================
  // CONSULTATION SESSION ROUTES
  // ============================================

  /**
   * Create or get consultation session
   * POST /api/legalizo/consultation/session
   */
  app.post("/api/legalizo/consultation/session", requireLegalizoSubscription, async (req: Request, res: Response) => {
    try {
      const { lawType } = req.body;

      if (!req.user?.id) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!LAW_TYPES.includes(lawType as any)) {
        return res.status(400).json({ error: "Invalid law type" });
      }

      // Create new session
      const newSession = await db
        .insert(legalizoConsultationSessions)
        .values({
          userId: req.user.id,
          lawType,
          conversationState: [],
          status: 'in_progress',
        })
        .returning();

      res.json(newSession[0]);
    } catch (error: any) {
      console.error("Create session error:", error);
      res.status(500).json({ error: "Failed to create consultation session" });
    }
  });

  /**
   * Update consultation session
   * PUT /api/legalizo/consultation/session/:sessionId
   */
  app.put("/api/legalizo/consultation/session/:sessionId", requireLegalizoSubscription, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { consultationData, documentData, status } = req.body;

      if (!req.user?.id) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Update session
      const updated = await db
        .update(legalizoConsultationSessions)
        .set({
          consultationData: consultationData || undefined,
          documentData: documentData || undefined,
          status: status || undefined,
          updatedAt: new Date(),
          completedAt: status === 'completed' ? new Date() : undefined,
        })
        .where(
          and(
            eq(legalizoConsultationSessions.id, sessionId),
            eq(legalizoConsultationSessions.userId, req.user.id)
          )
        )
        .returning();

      if (!updated || updated.length === 0) {
        return res.status(404).json({ error: "Session not found" });
      }

      res.json(updated[0]);
    } catch (error: any) {
      console.error("Update session error:", error);
      res.status(500).json({ error: "Failed to update consultation session" });
    }
  });
}
