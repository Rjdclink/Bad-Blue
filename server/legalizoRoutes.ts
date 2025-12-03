// Legalizo API Routes - Subscription-based legal platform
import type { Express, Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import { db } from "./db";
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

// Middleware to check active Legalizo subscription
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
        message: "Please subscribe to Legalizo to access this feature"
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
   * Register a new Legalizo user
   * POST /api/legalizo/auth/register
   */
  app.post("/api/legalizo/auth/register", async (req: Request, res: Response) => {
    try {
      const { firstName, lastName, email, password } = registerSchema.parse(req.body);

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
          hasPaidForAccess: false, // Legalizo requires subscription
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

      // Login the user via passport
      req.login({ id: user.id }, (err) => {
        if (err) {
          console.error("Login error:", err);
        }
      });

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
   * Login to Legalizo
   * POST /api/legalizo/auth/login
   */
  app.post("/api/legalizo/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = loginSchema.parse(req.body);

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

      // Login the user via passport
      req.login({ id: user.id }, (err) => {
        if (err) {
          console.error("Login error:", err);
        }
      });

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
      // TODO: Implement Square subscription checkout
      // Note: This requires setting up subscription plans in Square Dashboard first
      // For now, returning a placeholder
      
      res.json({
        message: "Square subscription integration pending - needs Square Dashboard setup",
        checkoutUrl: "/legalizo-welcome?payment=pending",
      });
    } catch (error: any) {
      console.error("Subscription creation error:", error);
      res.status(500).json({ 
        error: "Failed to create subscription",
        message: error.message 
      });
    }
  });

  /**
   * Square webhook handler for subscription events
   * POST /api/legalizo/subscription/webhook
   */
  app.post("/api/legalizo/subscription/webhook", async (req: Request, res: Response) => {
    try {
      // Verify Square webhook signature
      // Note: Implement signature verification in production
      
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

      // Start background job to generate report
      // For now, we'll simulate it with a placeholder
      setTimeout(async () => {
        try {
          // This would be replaced with actual OSINT scraping
          const mockReportData = {
            identitySummary: {
              name: searchQuery,
              verifiedStatus: "Partial match found",
            },
            contactInformation: [
              "Email addresses and phone numbers would be listed here from public sources",
            ],
            socialMediaPresence: [
              "Social media profiles would be aggregated here",
            ],
            publicRecords: [
              "Court records, property records, and other public data would be listed",
            ],
            summary: "This is a demonstration report. In production, this would contain comprehensive OSINT data aggregated from multiple public sources.",
            confidenceScore: 75,
          };

          await db
            .update(peopleSearchReports)
            .set({
              status: 'completed',
              reportData: mockReportData,
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
      }, 5000); // Simulate 5 second processing time

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

      // Generate PDF (simplified - would use a proper PDF library in production)
      const reportData = report[0].reportData as any;
      const pdfContent = `
Legalizo People Search Report
Generated: ${new Date().toLocaleDateString()}

Subject: ${report[0].subjectName || report[0].searchQuery}

${JSON.stringify(reportData, null, 2)}
      `;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="report-${reportId}.txt"`);
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
