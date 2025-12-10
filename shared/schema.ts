// BadBlue - Database Schema
// Following authentication and payment processing best practices

import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  index,
  uniqueIndex,
  unique,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================
// SESSIONS TABLE (Required for Authentication)
// ============================================
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// ============================================
// USERS TABLE (Authentication + Square Payments)
// ============================================
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),

  // User subscription status (active, inactive, suspended, pending_payment, past_due, canceled)
  status: varchar("status", { length: 50 }).notNull().default('active'),
  
  // Square customer tracking
  squareCustomerId: varchar("square_customer_id"),

  // Full access payment tracking (Free for signed-in users: LegalAI Consultation and Officer Search)
  hasPaidForAccess: boolean("has_paid_for_access").default(true).notNull(), // Default true since access is free for signed-in users
  accessPaymentId: varchar("access_payment_id"), // Stripe payment intent ID for access payment (kept for backwards compatibility)
  accessPaidAt: timestamp("access_paid_at"), // When user paid for access (kept for backwards compatibility)

  // Login tracking for admin panel
  lastLoginAt: timestamp("last_login_at"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_users_email").on(table.email),
  index("idx_users_status").on(table.status),
]);

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// ============================================
// AUTH ACCOUNTS TABLE (Username/Password Auth)
// ============================================
export const authAccounts = pgTable("auth_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  authType: varchar("auth_type", { length: 20 }).notNull(), // 'oauth' | 'local'
  username: varchar("username").unique(), // For local auth only
  passwordHash: text("password_hash"), // For local auth only
  passwordSalt: text("password_salt"), // For local auth only
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const authAccountsRelations = relations(authAccounts, ({ one }) => ({
  user: one(users, {
    fields: [authAccounts.userId],
    references: [users.id],
  }),
}));

export const insertAuthAccountSchema = createInsertSchema(authAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAuthAccount = z.infer<typeof insertAuthAccountSchema>;
export type AuthAccount = typeof authAccounts.$inferSelect;

// ============================================
// ADMIN ACCESS LOGS TABLE (Security Audit Trail)
// ============================================
export const adminAccessLogs = pgTable("admin_access_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminId: varchar("admin_id").notNull(), // The bypass ID used
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  sessionId: varchar("session_id"),
  accessedAt: timestamp("accessed_at").defaultNow(),
});

export const insertAdminAccessLogSchema = createInsertSchema(adminAccessLogs).omit({
  id: true,
  accessedAt: true,
});

export type InsertAdminAccessLog = z.infer<typeof insertAdminAccessLogSchema>;
export type AdminAccessLog = typeof adminAccessLogs.$inferSelect;

// ============================================
// AI SUB-AGENT LOGS TABLE
// ============================================
export const aiSubAgentLogs = pgTable("ai_subagent_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminId: varchar("admin_id").notNull(), // The admin who issued the command
  command: text("command").notNull(), // The command/instruction given
  category: varchar("category"), // code_analysis, debugging, data_ops, api_integration, etc.
  status: varchar("status").notNull().default('processing'), // processing, completed, failed
  response: text("response"), // AI response/result
  executionTimeMs: integer("execution_time_ms"), // How long it took
  errorMessage: text("error_message"), // If failed
  metadata: jsonb("metadata"), // Additional context (files analyzed, operations performed, etc.)
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertAiSubAgentLogSchema = createInsertSchema(aiSubAgentLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertAiSubAgentLog = z.infer<typeof insertAiSubAgentLogSchema>;
export type AiSubAgentLog = typeof aiSubAgentLogs.$inferSelect;

// ============================================
// TRIAL CONSULTATIONS TABLE (One-time Free Legal Consultation)
// ============================================
export const trialConsultations = pgTable("trial_consultations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ipAddress: varchar("ip_address").notNull(),
  deviceFingerprint: text("device_fingerprint"),
  userAgent: text("user_agent"),
  question: text("question").notNull(),
  response: text("response"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("trial_consultations_ip_idx").on(table.ipAddress),
  index("trial_consultations_fingerprint_idx").on(table.deviceFingerprint),
]);

export const insertTrialConsultationSchema = createInsertSchema(trialConsultations).omit({
  id: true,
  createdAt: true,
});

export type InsertTrialConsultation = z.infer<typeof insertTrialConsultationSchema>;
export type TrialConsultation = typeof trialConsultations.$inferSelect;

// ============================================
// DEVICE FINGERPRINTS TABLE (Sample Consultation Tracking)
// ============================================
export const deviceFingerprints = pgTable("device_fingerprints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: text("device_id").notNull().unique(), // Unique device fingerprint hash
  sampleUsedAt: timestamp("sample_used_at").notNull(), // When the sample was used
  ipAddress: varchar("ip_address"), // For additional tracking
  userAgent: text("user_agent"), // Browser information
  state: varchar("state", { length: 2 }), // State used in sample
  situation: text("situation"), // Sample situation (truncated for storage)
  response: text("response"), // Sample response provided
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("device_fingerprints_device_id_unique").on(table.deviceId),
  index("device_fingerprints_ip_idx").on(table.ipAddress),
]);

export const insertDeviceFingerprintSchema = createInsertSchema(deviceFingerprints).omit({
  id: true,
  createdAt: true,
});

export type InsertDeviceFingerprint = z.infer<typeof insertDeviceFingerprintSchema>;
export type DeviceFingerprint = typeof deviceFingerprints.$inferSelect;

// ============================================
// SAVED PROGRESS TABLE (Autosave System)
// ============================================
export const savedProgress = pgTable("saved_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  flowKey: varchar("flow_key", { length: 50 }).notNull(), // 'foia', 'complaint', 'petition', 'lawsuit_diy', 'lawsuit_full'
  stepIndex: integer("step_index").notNull().default(0), // Current step/page index
  formDataJson: jsonb("form_data_json").notNull().default(sql`'{}'::jsonb`), // All form data
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("saved_progress_user_flow_unique").on(table.userId, table.flowKey),
]);

export const savedProgressRelations = relations(savedProgress, ({ one }) => ({
  user: one(users, {
    fields: [savedProgress.userId],
    references: [users.id],
  }),
}));

export const insertSavedProgressSchema = createInsertSchema(savedProgress).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSavedProgress = z.infer<typeof insertSavedProgressSchema>;
export type SavedProgress = typeof savedProgress.$inferSelect;

// ============================================
// BADGE LOOKUPS TABLE
// ============================================
export const badgeLookups = pgTable("badge_lookups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Image data
  imageUrl: text("image_url"), // Stored image path or base64

  // AI extracted data
  badgeNumber: varchar("badge_number"),
  department: text("department"),

  // Officer information (from public records)
  officerName: text("officer_name"),
  officerRank: text("officer_rank"),
  officerYears: integer("officer_years"),
  departmentLocation: text("department_location"),
  jurisdiction: text("jurisdiction"),

  // AI analysis metadata
  analysisConfidence: text("analysis_confidence"),
  rawAiResponse: text("raw_ai_response"),

  createdAt: timestamp("created_at").defaultNow(),
});

export const badgeLookupsRelations = relations(badgeLookups, ({ one }) => ({
  user: one(users, {
    fields: [badgeLookups.userId],
    references: [users.id],
  }),
}));

export const insertBadgeLookupSchema = createInsertSchema(badgeLookups).omit({
  id: true,
  createdAt: true,
});

export type InsertBadgeLookup = z.infer<typeof insertBadgeLookupSchema>;
export type BadgeLookup = typeof badgeLookups.$inferSelect;

// ============================================
// OFFICER PROFILES TABLE (Compiled Public Data)
// ============================================
export const officerProfiles = pgTable("officer_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Basic officer information
  officerName: text("officer_name").notNull(),
  badgeNumber: varchar("badge_number"),
  department: text("department"),
  rank: text("rank"),
  location: text("location"), // City, State format
  
  // Comprehensive data (JSONB for flexible schema)
  careerData: jsonb("career_data"), // Career history, training, certifications
  incidents: jsonb("incidents"), // Disciplinary records, incidents, complaints
  courtCases: jsonb("court_cases"), // Lawsuits, court cases involving the officer
  newsMentions: jsonb("news_mentions"), // News articles, media coverage
  communityComplaints: jsonb("community_complaints"), // Community feedback, complaints
  
  // Source tracking
  sources: text("sources").array(), // URLs to source documents
  
  // Data quality and freshness
  dataQualityScore: integer("data_quality_score"), // 0-100 score based on source reliability
  lastUpdated: timestamp("last_updated").defaultNow(),
  
  // Search metadata
  searchCount: integer("search_count").default(0), // How many times this officer has been searched
  lastSearchedAt: timestamp("last_searched_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  nameIdx: index("officer_profiles_name_idx").on(table.officerName),
  badgeIdx: index("officer_profiles_badge_idx").on(table.badgeNumber),
  departmentIdx: index("officer_profiles_department_idx").on(table.department),
  locationIdx: index("officer_profiles_location_idx").on(table.location),
  // Unique constraint to prevent duplicate profiles (name + department combination)
  uniqueNameDept: unique("officer_profiles_unique_name_dept").on(table.officerName, table.department),
}));

export const insertOfficerProfileSchema = createInsertSchema(officerProfiles).omit({
  id: true,
  createdAt: true,
  searchCount: true,
  lastSearchedAt: true,
});

export type InsertOfficerProfile = z.infer<typeof insertOfficerProfileSchema>;
export type OfficerProfile = typeof officerProfiles.$inferSelect;

// ============================================
// COMPLAINTS TABLE
// ============================================
export const complaints = pgTable("complaints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  badgeLookupId: varchar("badge_lookup_id").references(() => badgeLookups.id, { onDelete: 'set null' }),

  // Officer information
  officerName: text("officer_name").notNull(),
  officerBadge: varchar("officer_badge"),
  officerDepartment: text("officer_department").notNull(),

  // Jurisdiction
  state: varchar("state", { length: 2 }).notNull(), // US state code (e.g., "IA", "CA")
  city: text("city").notNull(),

  // Complaint type
  complaintType: varchar("complaint_type").notNull(), // 'assault', 'negligence', 'harassment', 'excessive-force', 'misconduct', 'discrimination', 'other'

  // Incident details
  incidentDate: timestamp("incident_date").notNull(),
  incidentTime: varchar("incident_time"),
  description: text("description").notNull(),

  // Evidence
  evidenceUrls: text("evidence_urls").array(),

  // Submission routing (auto-determined)
  submissionVenue: varchar("submission_venue"), // 'internal_affairs', 'police_chief', 'sheriff', 'city_attorney'
  submissionEmail: text("submission_email"),
  submissionAddress: text("submission_address"),

  // Status tracking
  status: varchar("status").notNull().default('pending'), // 'pending', 'paid', 'submitted', 'under_review', 'resolved', 'closed'
  statusUpdatedAt: timestamp("status_updated_at").defaultNow(),
  submittedAt: timestamp("submitted_at"),

  // Payment tracking
  paymentId: varchar("payment_id"), // Stripe payment intent ID
  paymentStatus: varchar("payment_status").default('pending'), // 'pending', 'completed', 'failed'
  amountPaid: integer("amount_paid"), // Amount in cents

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const complaintsRelations = relations(complaints, ({ one }) => ({
  user: one(users, {
    fields: [complaints.userId],
    references: [users.id],
  }),
  badgeLookup: one(badgeLookups, {
    fields: [complaints.badgeLookupId],
    references: [badgeLookups.id],
  }),
}));

export const insertComplaintSchema = createInsertSchema(complaints).omit({
  id: true,
  userId: true, // Added by server from authenticated session
  badgeLookupId: true, // Optional, added by server if applicable
  createdAt: true,
  updatedAt: true,
  statusUpdatedAt: true,
  submittedAt: true,
  submissionVenue: true,
  submissionEmail: true,
  submissionAddress: true,
  paymentId: true,
  paymentStatus: true,
  amountPaid: true,
  status: true, // Has default value, no need to require in request
}).extend({
  incidentDate: z.string().or(z.date()), // Accept ISO string or Date
});

export type InsertComplaint = z.infer<typeof insertComplaintSchema>;
export type Complaint = typeof complaints.$inferSelect;

// ============================================
// PRICING (Per-feature pricing model)
// ============================================
// Free for signed-in users: LegalAI Consultation + Officer Search with comprehensive reports
// Then pay-per-use for complaints and lawsuits
export const APP_ACCESS_PRICING = 0;
export const APP_ACCESS_PRICING_CENTS = 0;

// Per-complaint filing fee (includes certified mail service and clerical services)
export const COMPLAINT_PRICING = 17.99;
export const COMPLAINT_PRICING_CENTS = 1799;

// Lawsuit pricing tiers
export const LAWSUIT_DIY_PRICING = 289.99; // User files - includes completed JS-44 civil cover sheet and informa pauperis form (non-completed)
export const LAWSUIT_DIY_PRICING_CENTS = 28999;

export const LAWSUIT_FULL_SERVICE_PRICING = 503.75; // BadBlue files ($98.75 + $405 filing fees) - includes clerical services, civil cover sheet, informa pauperis form (non-completed)
export const LAWSUIT_FULL_SERVICE_PRICING_CENTS = 50375;

// Petition pricing
export const PETITION_PRICING = 25.99;
export const PETITION_PRICING_CENTS = 2599;

// FOIA Request pricing
export const FOIA_REQUEST_PRICING = 19.99;
export const FOIA_REQUEST_PRICING_CENTS = 1999;

// Main pricing export (for backwards compatibility - refers to app access)
export const PRICING = APP_ACCESS_PRICING;
export const PRICING_CENTS = APP_ACCESS_PRICING_CENTS;

// Legacy names for backwards compatibility
export const FULL_ACCESS_PRICING = APP_ACCESS_PRICING;
export const FULL_ACCESS_PRICING_CENTS = APP_ACCESS_PRICING_CENTS;
export const LAWSUIT_PRICING = LAWSUIT_DIY_PRICING;
export const LAWSUIT_PRICING_CENTS = LAWSUIT_DIY_PRICING_CENTS;

export const COMPLAINT_TYPES = [
  'assault',
  'excessive-force',
  'harassment',
  'negligence',
  'misconduct',
  'discrimination',
  'other'
] as const;

export const LAWSUIT_TYPES = [
  { value: 'excessive-force', label: 'Excessive Force' },
  { value: 'false-arrest', label: 'False Arrest' },
  { value: 'civil-rights-violation', label: 'Civil Rights Violation' },
  { value: 'unlawful-search', label: 'Unlawful Search' },
  { value: 'wrongful-imprisonment', label: 'Wrongful Imprisonment' },
  { value: 'discrimination', label: 'Discrimination' },
  { value: 'assault-battery', label: 'Assault & Battery' },
  { value: 'other', label: 'Other' }
];

// ============================================
// LAWSUIT FILINGS TABLE
// ============================================
export const lawsuitFilings = pgTable("lawsuit_filings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  complaintId: varchar("complaint_id").references(() => complaints.id, { onDelete: 'set null' }),

  // Officer information
  officerName: text("officer_name").notNull(),
  officerBadge: varchar("officer_badge"),
  officerDepartment: text("officer_department").notNull(),

  // Jurisdiction
  state: varchar("state", { length: 2 }).notNull(), // US state code
  city: text("city").notNull(),
  county: text("county"),

  // Lawsuit type and details
  lawsuitType: varchar("lawsuit_type").notNull(), // 'assault', 'negligence', 'harassment', 'excessive-force', 'misconduct', 'discrimination', 'other'
  lawsuitTier: varchar("lawsuit_tier").notNull().default('diy'), // 'diy' or 'full-service'
  incidentDate: timestamp("incident_date").notNull(),
  incidentTime: varchar("incident_time"), // NEW: Time of incident (e.g., "2:30 PM")
  description: text("description").notNull(),

  // Plaintiff information
  plaintiffName: text("plaintiff_name"), // NEW: Full legal name of plaintiff
  plaintiffAddress: text("plaintiff_address"), // NEW: Mailing address of plaintiff
  returnMailingAddress: text("return_mailing_address"), // Physical mailing address for full-service lawsuit returns

  // Damages
  damagesRequested: integer("damages_requested"), // Amount in cents
  injuryDetails: text("injury_details"),
  subsequentEvents: text("subsequent_events"), // NEW: What happened after the incident
  medicalCosts: integer("medical_costs"), // Amount in cents

  // Evidence
  evidenceUrls: text("evidence_urls").array(),
  witnessNames: text("witness_names").array(),

  // Auto-generated legal document
  generatedDocument: text("generated_document"), // Full lawsuit template with state statutes
  stateStatutes: text("state_statutes").array(), // Relevant state codes/statutes

  // Filing information
  filingCourt: text("filing_court"), // Auto-determined court venue
  filingAddress: text("filing_address"),
  filingInstructions: text("filing_instructions"),
  filingFee: integer("filing_fee"), // State filing fee in cents
  eFilingPortalUrl: text("e_filing_portal_url"), // Clickable link to state's e-filing system
  eFilingPortalName: text("e_filing_portal_name"), // Display name for e-filing portal
  clerkOfCourtAddress: text("clerk_of_court_address"), // Physical address of clerk when e-filing unavailable

  // Tort claim notice (required in many states before suing government entities)
  tortNoticeRequired: boolean("tort_notice_required").default(false),
  tortNoticeSent: boolean("tort_notice_sent").default(false),
  tortNoticeAgency: text("tort_notice_agency"), // Agency the notice was sent to
  tortNoticeSentAt: timestamp("tort_notice_sent_at"),
  tortNoticeDocument: text("tort_notice_document"), // Generated tort claim notice

  // Legal precedents identified by AI
  relevantPrecedents: text("relevant_precedents").array(), // AI-identified case law

  // Status tracking
  status: varchar("status").notNull().default('pending'), // 'pending', 'paid', 'document_ready', 'filed', 'in_progress', 'settled', 'dismissed'
  statusUpdatedAt: timestamp("status_updated_at").defaultNow(),

  // Payment tracking
  paymentId: varchar("payment_id"), // Stripe payment intent ID
  paymentStatus: varchar("payment_status").default('pending'),
  amountPaid: integer("amount_paid"), // Amount in cents

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const lawsuitFilingsRelations = relations(lawsuitFilings, ({ one }) => ({
  user: one(users, {
    fields: [lawsuitFilings.userId],
    references: [users.id],
  }),
  complaint: one(complaints, {
    fields: [lawsuitFilings.complaintId],
    references: [complaints.id],
  }),
}));

export const insertLawsuitFilingSchema = createInsertSchema(lawsuitFilings).omit({
  id: true,
  userId: true, // Added by server from authenticated session
  complaintId: true, // Optional, added by server if applicable
  createdAt: true,
  updatedAt: true,
  statusUpdatedAt: true,
  generatedDocument: true,
  stateStatutes: true,
  filingCourt: true,
  filingAddress: true,
  filingInstructions: true,
  paymentId: true,
  paymentStatus: true,
  amountPaid: true,
  status: true, // Has default value, no need to require in request
}).extend({
  incidentDate: z.string().or(z.date()),
});

export type InsertLawsuitFiling = z.infer<typeof insertLawsuitFilingSchema>;
export type LawsuitFiling = typeof lawsuitFilings.$inferSelect;

// ============================================
// JURISDICTION DIRECTORY TABLE
// ============================================
export const jurisdictions = pgTable("jurisdictions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  // Geographic identifiers
  state: varchar("state", { length: 2 }).notNull(), // US state code (e.g., "IA", "CA")
  county: text("county"),
  city: text("city"),

  // Agency information
  agencyType: varchar("agency_type").notNull(), // 'police', 'sheriff', 'trooper'
  agencyName: text("agency_name").notNull(), // Full formatted name

  // Contact information
  contactEmail: text("contact_email"), // Internal affairs or complaint email
  contactPhone: text("contact_phone"),
  contactAddress: text("contact_address"),
  websiteUrl: text("website_url"),

  // Verification and confidence
  verified: boolean("verified").default(false), // Manually verified as accurate
  confidence: integer("confidence").default(50), // Confidence score 0-100
  verifiedAt: timestamp("verified_at"),

  // Metadata
  source: text("source"), // Where this information came from
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_jurisdiction_location").on(table.state, table.city, table.agencyType),
]);

export const insertJurisdictionSchema = createInsertSchema(jurisdictions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertJurisdiction = z.infer<typeof insertJurisdictionSchema>;
export type Jurisdiction = typeof jurisdictions.$inferSelect;

// ============================================
// CONTACT MESSAGES TABLE
// ============================================
export const contactMessages = pgTable("contact_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  // Contact type - support or general contact
  type: varchar("type").notNull(), // 'support', 'contact', 'report'

  // Sender information
  name: text("name").notNull(),
  email: text("email").notNull(),

  // Message details
  subject: text("subject").notNull(),
  message: text("message").notNull(),

  // Optional user reference (if logged in)
  userId: varchar("user_id").references(() => users.id, { onDelete: 'set null' }),

  // Status tracking
  status: varchar("status").notNull().default('new'), // 'new', 'read', 'responded', 'resolved'
  emailSent: boolean("email_sent").default(false),

  createdAt: timestamp("created_at").defaultNow(),
});

export const contactMessagesRelations = relations(contactMessages, ({ one }) => ({
  user: one(users, {
    fields: [contactMessages.userId],
    references: [users.id],
  }),
}));

export const insertContactMessageSchema = createInsertSchema(contactMessages).omit({
  id: true,
  userId: true, // Added by server if user is authenticated
  status: true,
  emailSent: true,
  createdAt: true,
});

export type InsertContactMessage = z.infer<typeof insertContactMessageSchema>;
export type ContactMessage = typeof contactMessages.$inferSelect;

// ============================================
// PETITIONS TABLE
// ============================================
export const petitions = pgTable('petitions', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Unique shareable link slug
  slug: varchar("slug").unique().notNull(),
  
  // Officer information
  officerName: text('officer_name').notNull(),
  department: text('department').notNull(),

  // Jurisdiction
  state: text("state").notNull(),
  city: text("city"),
  county: text("county"),

  // Offense details (original + AI redrafted)
  offenseDescriptionOriginal: text("offense_description_original").notNull(),
  offenseDescriptionRedrafted: text("offense_description_redrafted"),
  additionalText: text("additional_text"), // "Add To" section for admin

  // Configuration
  bottomLink: text("bottom_link"), // External link of admin's choice

  // Purchase tracking  
  submitterName: text("submitter_name").notNull(), // Admin-only visible purchaser name
  paymentId: varchar("payment_id"),

  // Analytics
  signatureCount: integer("signature_count").default(0),
  lastCompiledAt: timestamp("last_compiled_at"),

  // Share settings
  shareableUrl: text("shareable_url"), // Full shareable URL
  socialMediaShared: boolean("social_media_shared").default(false),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const petitionsRelations = relations(petitions, ({ one, many }) => ({
  user: one(users, {
    fields: [petitions.userId],
    references: [users.id],
  }),
  signatures: many(petitionSignatures),
}));

export const insertPetitionSchema = createInsertSchema(petitions).omit({
  id: true,
  slug: true, // Generated server-side
  createdAt: true,
  updatedAt: true,
  userId: true,
  signatureCount: true,
  shareableUrl: true,
  paymentId: true,
  lastCompiledAt: true,
  offenseDescriptionRedrafted: true, // Generated by AI
  socialMediaShared: true,
}).extend({
  offenseDescriptionOriginal: z.string().min(50, "Offense description must be at least 50 characters"),
});

export type InsertPetition = z.infer<typeof insertPetitionSchema>;
export type Petition = typeof petitions.$inferSelect;

// ============================================
// PETITION SIGNATURES TABLE
// ============================================
export const petitionSignatures = pgTable("petition_signatures", {
  id: text("id").primaryKey().notNull().default(sql`gen_random_uuid()`),
  petitionId: text("petition_id").notNull().references(() => petitions.id, { onDelete: 'cascade' }),
  
  // Signature data (required)
  fullName: text("full_name").notNull(),
  typedSignature: text("typed_signature").notNull(),
  
  // Drawn signature (optional) - stored as base64 data URL
  drawnSignature: text("drawn_signature"),
  
  // No emails, IP tracking, or user agent per requirements
  signedAt: timestamp("signed_at").notNull().defaultNow(),
});

// Corrupt Law Enforcement & Snitch Evidence Hub - community-shared evidence
export const publicEvidence = pgTable("public_evidence", {
  id: text("id").primaryKey().notNull().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().references(() => users.id),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(), // image/video/audio/document/archive
  // Evidence category: 'corruption' for law enforcement wrongdoing, 'informant' for snitch documents, 'misconduct' for general
  evidenceCategory: text("evidence_category").default('misconduct'), // corruption, informant, misconduct
  officerName: text("officer_name"), // Subject of evidence (officer or informant name)
  department: text("department"),
  location: text("location"),
  incidentDate: timestamp("incident_date"),
  description: text("description"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const petitionSignaturesRelations = relations(petitionSignatures, ({ one }) => ({
  petition: one(petitions, {
    fields: [petitionSignatures.petitionId],
    references: [petitions.id],
  }),
}));

export const insertPetitionSignatureSchema = createInsertSchema(petitionSignatures).omit({
  id: true,
  signedAt: true,
}).extend({
  fullName: z.string().min(2, "Full name is required"),
  typedSignature: z.string().min(2, "Typed signature is required"),
  drawnSignature: z.string().optional(),
});

export type InsertPetitionSignature = z.infer<typeof insertPetitionSignatureSchema>;
export type PetitionSignature = typeof petitionSignatures.$inferSelect;

// ============================================
// FOIA REQUESTS TABLE
// ============================================
export const foiaRequests = pgTable("foia_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // User contact information
  userFullName: text("user_full_name").notNull(),
  userEmail: text("user_email").notNull(),
  mailingAddress: text("mailing_address").notNull(), // Physical mailing address for certified mail return
  
  // Jurisdiction selection
  state: varchar("state", { length: 2 }).notNull(), // US state code
  agencyType: varchar("agency_type").notNull(), // 'state_police', 'county_sheriff', 'municipal_police', 'other'
  agencyName: text("agency_name"), // Manual entry if "other" selected
  departmentName: text("department_name").notNull(), // User-entered department name
  
  // AI-discovered department address
  departmentAddress: text("department_address"), // AI-searched and verified address
  
  // Incident details
  officerName: text("officer_name").notNull(),
  incidentDate: text("incident_date"), // Approximate date
  incidentTime: text("incident_time"), // Approximate time
  incidentLocation: text("incident_location"), // Approximate location
  
  // Records requested
  recordsDescription: text("records_description").notNull(), // Description of records being requested
  
  // Generated FOIA letter
  generatedLetter: text("generated_letter"), // Complete FOIA letter with state-specific statute compliance
  stateStatute: text("state_statute"), // State-specific open records statute citation
  statutoryDeadline: text("statutory_deadline"), // Response deadline per state statute
  
  // Authorization and payment
  authorizationAccepted: boolean("authorization_accepted").default(false), // User accepted authorization checkbox
  paymentId: varchar("payment_id"), // Stripe payment intent ID
  paymentStatus: varchar("payment_status").default('pending'),
  amountPaid: integer("amount_paid"), // Amount in cents (2465 = $24.65)
  
  // Status tracking
  status: varchar("status").notNull().default('draft'), // 'draft', 'pending_payment', 'paid', 'mailed', 'delivered'
  statusUpdatedAt: timestamp("status_updated_at").defaultNow(),
  
  // Admin tracking
  certifiedMailTrackingNumber: text("certified_mail_tracking_number"), // Admin adds manually
  mailedAt: timestamp("mailed_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const foiaRequestsRelations = relations(foiaRequests, ({ one }) => ({
  user: one(users, {
    fields: [foiaRequests.userId],
    references: [users.id],
  }),
}));

export const insertFoiaRequestSchema = createInsertSchema(foiaRequests).omit({
  id: true,
  userId: true, // Added by server from authenticated session
  createdAt: true,
  updatedAt: true,
  statusUpdatedAt: true,
  generatedLetter: true,
  stateStatute: true,
  statutoryDeadline: true,
  departmentAddress: true, // AI-generated
  paymentId: true,
  paymentStatus: true,
  amountPaid: true,
  status: true,
  certifiedMailTrackingNumber: true,
  mailedAt: true,
}).extend({
  mailingAddress: z.string().min(10, "Physical mailing address is required"),
  departmentName: z.string().min(2, "Department name is required"),
  officerName: z.string().min(2, "Officer name is required"),
  recordsDescription: z.string().min(20, "Please provide a detailed description of records requested"),
});

export type InsertFoiaRequest = z.infer<typeof insertFoiaRequestSchema>;
export type FoiaRequest = typeof foiaRequests.$inferSelect;

// ============================================
// FOIA STATE STATUTES TABLE
// ============================================
export const foiaStateStatutes = pgTable("foia_state_statutes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  state: varchar("state", { length: 2 }).notNull().unique(), // US state code
  
  // State-specific statute information
  statuteName: text("statute_name").notNull(), // e.g., "California Public Records Act"
  statuteCitation: text("statute_citation").notNull(), // e.g., "Cal. Gov't Code § 6250 et seq."
  statutoryDeadline: text("statutory_deadline").notNull(), // e.g., "10 business days"
  
  // Template information for letter generation
  letterTemplate: text("letter_template"), // State-specific FOIA letter template
  additionalRequirements: text("additional_requirements"), // Any state-specific requirements
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFoiaStateStatuteSchema = createInsertSchema(foiaStateStatutes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFoiaStateStatute = z.infer<typeof insertFoiaStateStatuteSchema>;
export type FoiaStateStatute = typeof foiaStateStatutes.$inferSelect;

// ============================================
// AI LEARNING SYSTEM TABLES
// ============================================

// Stores analyzed patterns from top law firm complaints
export const complaintPatterns = pgTable("complaint_patterns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Source information
  sourceFirm: text("source_firm"), // Name of law firm
  sourceCitation: text("source_citation"), // Case citation or reference
  sourceUrl: text("source_url"), // URL if from web search
  
  // Case characteristics
  jurisdiction: text("jurisdiction"), // State or federal district
  violationType: text("violation_type"), // e.g., "excessive force", "false arrest"
  claimTypes: text("claim_types").array(), // Array of claim types
  factPattern: text("fact_pattern"), // Brief description of facts
  
  // Format and structure analysis
  documentStructure: jsonb("document_structure"), // Section headings, organization
  writingStyle: jsonb("writing_style"), // Tone, language patterns, persuasive techniques
  legalArguments: jsonb("legal_arguments"), // Argument strategies used
  citationStyle: text("citation_style"), // How citations are formatted
  
  // Effectiveness metrics
  outcome: text("outcome"), // "won", "settled", "pending", "lost"
  settlementAmount: integer("settlement_amount"), // If applicable
  effectivenessScore: integer("effectiveness_score"), // 1-10 rating
  
  // Full text storage
  fullText: text("full_text"), // Complete document text for analysis
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Stores successful legal strategies
export const legalStrategies = pgTable("legal_strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Strategy identification
  strategyName: text("strategy_name").notNull(),
  strategyType: text("strategy_type"), // "argument", "framing", "evidence_presentation"
  applicableClaims: text("applicable_claims").array(),
  
  // Strategy details
  description: text("description"),
  implementation: text("implementation"), // How to apply this strategy
  exampleText: text("example_text"), // Example from successful case
  
  // Effectiveness
  successRate: integer("success_rate"), // Percentage
  usageCount: integer("usage_count").default(0),
  
  // Context
  jurisdiction: text("jurisdiction"),
  recommendedFor: text("recommended_for"), // When to use this strategy
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Stores case patterns for similarity matching
export const casePatterns = pgTable("case_patterns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Case identification
  caseId: varchar("case_id"), // Reference to actual lawsuit if from our system
  caseType: text("case_type"), // "complaint", "lawsuit", "petition"
  
  // Facts and claims
  factPattern: text("fact_pattern").notNull(),
  claimTypes: text("claim_types").array(),
  violationType: text("violation_type"),
  jurisdiction: text("jurisdiction"),
  
  // Key details
  officerConduct: text("officer_conduct"), // What the officer did
  plaintiffInjury: text("plaintiff_injury"), // What happened to plaintiff
  evidence: text("evidence").array(), // Types of evidence
  witnesses: boolean("witnesses"), // Whether witnesses present
  
  // Outcome and effectiveness
  outcome: text("outcome"),
  strengthRating: integer("strength_rating"), // AI-assessed case strength (1-10)
  weaknesses: text("weaknesses").array(), // Identified weaknesses
  strengths: text("strengths").array(), // Identified strengths
  
  // Document quality
  documentQuality: integer("document_quality"), // 1-10 rating
  formatApplied: text("format_applied"), // Which format/template was used
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Stores learned document formats and templates
export const documentFormats = pgTable("document_formats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Format identification
  formatName: text("format_name").notNull(),
  formatType: text("format_type"), // "complaint", "lawsuit", "petition"
  source: text("source"), // Where this format came from
  
  // Structure
  sections: jsonb("sections"), // Array of section definitions
  headingStyle: text("heading_style"),
  paragraphStyle: text("paragraph_style"),
  citationFormat: text("citation_format"),
  
  // Applicability
  jurisdiction: text("jurisdiction"),
  courtLevel: text("court_level"), // "federal_district", "state_trial", etc.
  claimTypes: text("claim_types").array(),
  
  // Template
  templateText: text("template_text"), // Full template with placeholders
  requiredFields: text("required_fields").array(), // Fields needed to fill template
  
  // Effectiveness
  usageCount: integer("usage_count").default(0),
  successRate: integer("success_rate"), // Percentage
  averageQualityScore: integer("average_quality_score"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================
// APP SETTINGS TABLE (Admin Configuration)
// ============================================
export const appSettings = pgTable("app_settings", {
  key: varchar("key").primaryKey(), // Setting key (e.g., "support_from_name", "support_from_email")
  value: text("value").notNull(), // Setting value
  updatedBy: varchar("updated_by"), // Admin ID who last updated
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAppSettingSchema = createInsertSchema(appSettings).omit({
  createdAt: true,
  updatedAt: true,
});

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = z.infer<typeof insertAppSettingSchema>;

// ============================================
// ADMIN SETTINGS AUDIT LOG (Track Changes)
// ============================================
export const adminSettingsAudit = pgTable("admin_settings_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  settingKey: varchar("setting_key").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value").notNull(),
  adminId: varchar("admin_id").notNull(),
  ipAddress: varchar("ip_address"),
  changedAt: timestamp("changed_at").defaultNow(),
});

export const insertAdminSettingsAuditSchema = createInsertSchema(adminSettingsAudit).omit({
  id: true,
  changedAt: true,
});

export type AdminSettingsAudit = typeof adminSettingsAudit.$inferSelect;
export type InsertAdminSettingsAudit = z.infer<typeof insertAdminSettingsAuditSchema>;

export type ComplaintPattern = typeof complaintPatterns.$inferSelect;
export type InsertComplaintPattern = typeof complaintPatterns.$inferInsert;

export type LegalStrategy = typeof legalStrategies.$inferSelect;
export type InsertLegalStrategy = typeof legalStrategies.$inferInsert;

export type CasePattern = typeof casePatterns.$inferSelect;
export type InsertCasePattern = typeof casePatterns.$inferInsert;

export type DocumentFormat = typeof documentFormats.$inferSelect;
export type InsertDocumentFormat = typeof documentFormats.$inferInsert;

// ============================================
// SUBSCRIPTION TIERS TABLE (Admin-Configurable)
// ============================================
export const subscriptionTiers = pgTable("subscription_tiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().unique(), // e.g., "Basic Access", "Premium", "Professional"
  description: text("description"), // What's included in this tier
  priceInCents: integer("price_in_cents").notNull(), // Price in cents
  durationDays: integer("duration_days").notNull(), // How many days of access
  stripePriceId: varchar("stripe_price_id"), // Stripe price ID for this tier
  stripeProductId: varchar("stripe_product_id"), // Stripe product ID
  features: text("features").array(), // List of features (JSON array of strings)
  isActive: boolean("is_active").notNull().default(true), // Can be toggled on/off
  isDefault: boolean("is_default").notNull().default(false), // Default tier for new users
  sortOrder: integer("sort_order").default(0), // Display order
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSubscriptionTierSchema = createInsertSchema(subscriptionTiers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SubscriptionTier = typeof subscriptionTiers.$inferSelect;
export type InsertSubscriptionTier = z.infer<typeof insertSubscriptionTierSchema>;

// ============================================
// USER SUBSCRIPTIONS TABLE (Links users to their active tier)
// ============================================
export const userSubscriptions = pgTable("user_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  tierId: varchar("tier_id").notNull().references(() => subscriptionTiers.id, { onDelete: 'cascade' }),
  startDate: timestamp("start_date").notNull().defaultNow(),
  endDate: timestamp("end_date").notNull(), // Calculated based on tier duration
  isActive: boolean("is_active").notNull().default(true),
  paymentId: varchar("payment_id"), // Stripe payment intent ID
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSubscriptionSchema = createInsertSchema(userSubscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UserSubscription = typeof userSubscriptions.$inferSelect;
export type InsertUserSubscription = z.infer<typeof insertUserSubscriptionSchema>;

// ============================================
// SUB-AGENT KNOWLEDGE SYSTEM TABLES
// ============================================

// Tracks capabilities the Sub-Agent has learned, with success/failure metrics
export const subAgentCapabilities = pgTable("subagent_capabilities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  capabilityName: varchar("capability_name").unique().notNull(), // Unique identifier for capability
  description: text("description").notNull(), // What this capability does
  successCount: integer("success_count").default(0).notNull(), // Times successfully executed
  failCount: integer("fail_count").default(0).notNull(), // Times failed
  avgExecutionTimeMs: integer("avg_execution_time_ms"), // Average execution time in milliseconds
  lastUsed: timestamp("last_used"), // Last time this capability was used
  learnedAt: timestamp("learned_at").defaultNow().notNull(), // When capability was first learned
  limitations: text("limitations").array(), // Known limitations
  improvements: text("improvements").array(), // Suggested improvements
  metadata: jsonb("metadata"), // Additional context about capability
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_capability_name").on(table.capabilityName),
  index("idx_last_used").on(table.lastUsed),
]);

export const insertSubAgentCapabilitySchema = createInsertSchema(subAgentCapabilities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SubAgentCapability = typeof subAgentCapabilities.$inferSelect;
export type InsertSubAgentCapability = z.infer<typeof insertSubAgentCapabilitySchema>;

// Stores patterns the Sub-Agent has learned from operations
export const subAgentLearningPatterns = pgTable("subagent_learning_patterns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  patternType: varchar("pattern_type").notNull(), // 'user_behavior', 'code_pattern', 'error_pattern', 'success_pattern'
  patternData: jsonb("pattern_data").notNull(), // Pattern details as JSON
  confidenceScore: integer("confidence_score").default(50).notNull(), // 0-100 confidence
  timesObserved: integer("times_observed").default(1).notNull(), // Frequency count
  lastObserved: timestamp("last_observed").defaultNow().notNull(), // Last observation time
  associatedCapabilities: text("associated_capabilities").array(), // Related capabilities
  impact: varchar("impact"), // 'low', 'medium', 'high', 'critical'
  metadata: jsonb("metadata"), // Additional context
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_pattern_type").on(table.patternType),
  index("idx_confidence_score").on(table.confidenceScore),
  index("idx_last_observed").on(table.lastObserved),
]);

export const insertSubAgentLearningPatternSchema = createInsertSchema(subAgentLearningPatterns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SubAgentLearningPattern = typeof subAgentLearningPatterns.$inferSelect;
export type InsertSubAgentLearningPattern = z.infer<typeof insertSubAgentLearningPatternSchema>;

// Tracks performance metrics over time to measure improvement
export const subAgentPerformanceMetrics = pgTable("subagent_performance_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  metricName: varchar("metric_name").notNull(), // e.g., 'analysis_depth', 'inference_accuracy', 'execution_success'
  metricValue: integer("metric_value").notNull(), // Numeric value (can be 0-100 for percentages)
  measuredAt: timestamp("measured_at").defaultNow().notNull(), // When metric was measured
  context: jsonb("context"), // Additional context about measurement
  taskId: varchar("task_id"), // Reference to specific task if applicable
  capabilityName: varchar("capability_name"), // Related capability if applicable
  metadata: jsonb("metadata"), // Additional details
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_metric_name").on(table.metricName),
  index("idx_measured_at").on(table.measuredAt),
  index("idx_metrics_capability_name").on(table.capabilityName),
]);

export const insertSubAgentPerformanceMetricSchema = createInsertSchema(subAgentPerformanceMetrics).omit({
  id: true,
  createdAt: true,
});

export type SubAgentPerformanceMetric = typeof subAgentPerformanceMetrics.$inferSelect;
export type InsertSubAgentPerformanceMetric = z.infer<typeof insertSubAgentPerformanceMetricSchema>;

// Logs self-improvement actions with before/after states and rollback capability
export const subAgentSelfImprovementActions = pgTable("subagent_self_improvement_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actionType: varchar("action_type").notNull(), // 'capability_update', 'pattern_learn', 'strategy_change', 'rollback'
  description: text("description").notNull(), // What was changed
  beforeState: jsonb("before_state"), // State before change
  afterState: jsonb("after_state"), // State after change
  successMetrics: jsonb("success_metrics"), // Metrics measuring success of change
  rollbackAvailable: boolean("rollback_available").default(true).notNull(), // Can this be rolled back?
  rolledBack: boolean("rolled_back").default(false).notNull(), // Has it been rolled back?
  rollbackReason: text("rollback_reason"), // Why it was rolled back
  impact: varchar("impact"), // 'positive', 'negative', 'neutral'
  capabilityAffected: varchar("capability_affected"), // Which capability was affected
  implementedAt: timestamp("implemented_at").defaultNow().notNull(), // When change was made
  evaluatedAt: timestamp("evaluated_at"), // When results were evaluated
  metadata: jsonb("metadata"), // Additional context
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_action_type").on(table.actionType),
  index("idx_implemented_at").on(table.implementedAt),
  index("idx_impact").on(table.impact),
  index("idx_rolled_back").on(table.rolledBack),
]);

export const insertSubAgentSelfImprovementActionSchema = createInsertSchema(subAgentSelfImprovementActions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SubAgentSelfImprovementAction = typeof subAgentSelfImprovementActions.$inferSelect;
export type InsertSubAgentSelfImprovementAction = z.infer<typeof insertSubAgentSelfImprovementActionSchema>;

// ============================================
// JURISDICTION POPULATIONS TABLE
// ============================================
// Track cities/jurisdictions with population data for prioritized searches
export const jurisdictionPopulations = pgTable("jurisdiction_populations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  city: varchar("city", { length: 100 }).notNull(),
  state: varchar("state", { length: 2 }).notNull(),
  population: integer("population").notNull(),
  region: text("region"), // e.g., "midwest", "northeast", "southeast", "southwest", "west"
  entityType: varchar("entity_type", { length: 30 }), // 'city', 'town', 'state_agency', 'government', 'corrections'
  priorityScore: integer("priority_score"), // computed from population + category weight
  searchStatus: varchar("search_status", { length: 20 }).default('pending').notNull(), // 'pending', 'in_progress', 'completed', 'failed'
  lastSearchedAt: timestamp("last_searched_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_jurisdiction_state").on(table.state),
  index("idx_jurisdiction_population").on(sql`${table.population} DESC`),
  index("idx_jurisdiction_entity_type").on(table.entityType),
  index("idx_jurisdiction_search_status").on(table.searchStatus),
  index("idx_jurisdiction_priority_score").on(sql`${table.priorityScore} DESC`),
]);

export const insertJurisdictionPopulationSchema = createInsertSchema(jurisdictionPopulations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type JurisdictionPopulation = typeof jurisdictionPopulations.$inferSelect;
export type InsertJurisdictionPopulation = z.infer<typeof insertJurisdictionPopulationSchema>;

// ============================================
// OFFICER CATEGORY PRIORITY TABLE
// ============================================
// Define category ordering and rate limits for officer searches
export const officerCategoryPriority = pgTable("officer_category_priority", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  categoryName: varchar("category_name", { length: 50 }).notNull().unique(), // 'municipal', 'town', 'state', 'government', 'corrections'
  priorityOrder: integer("priority_order").notNull(), // 1=highest priority
  searchIntervalMinutes: integer("search_interval_minutes").default(10).notNull(), // on interval duration
  restIntervalMinutes: integer("rest_interval_minutes").default(10).notNull(), // off interval duration
  dailyBudgetMinutes: integer("daily_budget_minutes").default(60).notNull(), // per category daily budget
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_category_priority_order").on(table.priorityOrder),
]);

export const insertOfficerCategoryPrioritySchema = createInsertSchema(officerCategoryPriority).omit({
  id: true,
  createdAt: true,
});

export type OfficerCategoryPriority = typeof officerCategoryPriority.$inferSelect;
export type InsertOfficerCategoryPriority = z.infer<typeof insertOfficerCategoryPrioritySchema>;

// ============================================
// SUBAGENT SEARCH QUEUE TABLE
// ============================================
// Priority queue for search targets
export const subagentSearchQueue = pgTable("subagent_search_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jurisdictionId: varchar("jurisdiction_id").references(() => jurisdictionPopulations.id, { onDelete: 'set null' }),
  entityType: varchar("entity_type", { length: 30 }).notNull(),
  priorityScore: integer("priority_score").notNull(),
  status: varchar("status", { length: 20 }).default('queued').notNull(), // 'queued', 'in_progress', 'completed', 'failed', 'deferred'
  attemptCount: integer("attempt_count").default(0).notNull(),
  lastAttemptAt: timestamp("last_attempt_at"),
  nextAttemptAt: timestamp("next_attempt_at"),
  errorMessage: text("error_message"),
  officersFound: integer("officers_found").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_search_queue_status").on(table.status),
  index("idx_search_queue_priority").on(sql`${table.priorityScore} DESC`),
  index("idx_search_queue_next_attempt").on(table.nextAttemptAt),
]);

export const subagentSearchQueueRelations = relations(subagentSearchQueue, ({ one }) => ({
  jurisdiction: one(jurisdictionPopulations, {
    fields: [subagentSearchQueue.jurisdictionId],
    references: [jurisdictionPopulations.id],
  }),
}));

export const insertSubagentSearchQueueSchema = createInsertSchema(subagentSearchQueue).omit({
  id: true,
  createdAt: true,
});

export type SubagentSearchQueue = typeof subagentSearchQueue.$inferSelect;
export type InsertSubagentSearchQueue = z.infer<typeof insertSubagentSearchQueueSchema>;

// ============================================
// SUBAGENT SEARCH SESSIONS TABLE
// ============================================
// Track daily session time budget
export const subagentSearchSessions = pgTable("subagent_search_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionDate: varchar("session_date", { length: 10 }).notNull().unique(), // 'YYYY-MM-DD' format
  totalBudgetMinutes: integer("total_budget_minutes").default(180).notNull(), // 3 hours
  minutesUsed: integer("minutes_used").default(0).notNull(),
  minutesRemaining: integer("minutes_remaining").default(180).notNull(), // computed: totalBudgetMinutes - minutesUsed
  intervalPlan: jsonb("interval_plan"), // stores on/off interval configuration
  searchesCompleted: integer("searches_completed").default(0).notNull(),
  officersFound: integer("officers_found").default(0).notNull(),
  status: varchar("status", { length: 20 }).default('active').notNull(), // 'active', 'paused', 'exhausted', 'completed'
  pausedAt: timestamp("paused_at"),
  resumedAt: timestamp("resumed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_search_session_date").on(table.sessionDate),
]);

export const insertSubagentSearchSessionSchema = createInsertSchema(subagentSearchSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SubagentSearchSession = typeof subagentSearchSessions.$inferSelect;
export type InsertSubagentSearchSession = z.infer<typeof insertSubagentSearchSessionSchema>;

// ============================================
// SUB-AGENT SEARCH CYCLES TABLE
// ============================================
// Tracks autonomous data collection cycles for officer and department URL searches
export const subAgentSearchCycles = pgTable("sub_agent_search_cycles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  currentCycle: varchar("current_cycle").notNull().default('officer'), // 'officer' | 'department'
  lastCycleStart: timestamp("last_cycle_start"),
  nextCycleStart: timestamp("next_cycle_start"),
  searchState: varchar("search_state").notNull().default('not_running'), // 'not_running' | 'searching_officers' | 'searching_departments' | 'paused'
  isPaused: boolean("is_paused").default(false).notNull(),
  pauseContext: jsonb("pause_context"), // Stores: pausedTask, timeRemaining, progress, pausedAt
  cycleCount: integer("cycle_count").default(0).notNull(), // Total cycles completed
  lastOfficerSearchCount: integer("last_officer_search_count"), // Officers found in last search
  lastDepartmentSearchCount: integer("last_department_search_count"), // URLs found in last search
  metadata: jsonb("metadata"), // Additional tracking data
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSubAgentSearchCycleSchema = createInsertSchema(subAgentSearchCycles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SubAgentSearchCycle = typeof subAgentSearchCycles.$inferSelect;
export type InsertSubAgentSearchCycle = z.infer<typeof insertSubAgentSearchCycleSchema>;

// ============================================
// DEPARTMENT URLS TABLE
// ============================================
// Stores discovered law enforcement department websites for future reference
export const departmentUrls = pgTable("department_urls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  departmentName: text("department_name").notNull(),
  url: text("url").notNull(),
  location: text("location").notNull(), // City, State or County, State
  state: varchar("state", { length: 2 }).notNull(), // Two-letter state code
  departmentType: varchar("department_type").notNull(), // 'police' | 'sheriff' | 'state_patrol' | 'other'
  verified: boolean("verified").default(false).notNull(), // Whether URL has been verified as working
  lastVerified: timestamp("last_verified"), // Last time URL was checked
  contactEmail: text("contact_email"), // Contact email if found
  phone: varchar("phone"), // Contact phone if found
  jurisdiction: text("jurisdiction"), // Jurisdiction details (city, county, etc.)
  servesPopulation: integer("serves_population"), // Estimated population served
  sources: text("sources").array(), // URLs where this was found
  discoveredAt: timestamp("discovered_at").defaultNow().notNull(),
  metadata: jsonb("metadata"), // Additional data
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_department_state").on(table.state),
  index("idx_department_type").on(table.departmentType),
  index("idx_discovered_at").on(table.discoveredAt),
]);

export const insertDepartmentUrlSchema = createInsertSchema(departmentUrls).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type DepartmentUrl = typeof departmentUrls.$inferSelect;
export type InsertDepartmentUrl = z.infer<typeof insertDepartmentUrlSchema>;

// ============================================
// WORKER ALERTS TABLE
// ============================================
// Stores alerts from BadBlue Worker for monitoring critical systems
export const workerAlerts = pgTable("worker_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  alertType: varchar("alert_type").notNull(), // 'rate_limit_pause', 'rate_limit_resume', 'database_failure', 'stripe_failure', 'email_failure'
  severity: integer("severity").notNull(), // Maps to Severity enum (1=NOTICE, 2=WARNING, 3=MODERATE, 4=SERIOUS, 5=CRITICAL)
  title: varchar("title").notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata"), // Additional context (API stats, system state, etc.)
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => [
  index("idx_alert_type_resolved").on(table.alertType, table.resolved),
  index("idx_worker_alerts_timestamp").on(table.timestamp),
]);

export const insertWorkerAlertSchema = createInsertSchema(workerAlerts).omit({
  id: true,
  timestamp: true,
});

export type WorkerAlert = typeof workerAlerts.$inferSelect;
export type InsertWorkerAlert = z.infer<typeof insertWorkerAlertSchema>;

// ============================================
// WORKER FAILURE LOGS TABLE (Migration-Ready)
// ============================================
// Replaces data/system_failures.log for platform-independent deployment
export const workerFailureLogs = pgTable("worker_failure_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  functionAffected: varchar("function_affected", { length: 255 }).notNull(),
  cause: text("cause").notNull(),
  systemState: varchar("system_state", { length: 20 }).notNull(), // 'working' | 'not_working'
  severity: integer("severity").notNull(), // 1-5 (NOTICE to CRITICAL) - CHECK constraint added
  priority: integer("priority"), // 1-4 (LOW to CRITICAL) - CHECK constraint added
  category: varchar("category", { length: 50 }), // 'infrastructure', 'application_code', etc.
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolved_at"),
  metadata: jsonb("metadata"), // resourceProfile, dependencies, parallelSafe, etc.
}, (table) => [
  index("idx_failure_timestamp").on(table.timestamp),
  index("idx_failure_category_severity").on(table.category, sql`${table.severity} DESC`, sql`${table.timestamp} DESC`),
  // Partial index for unresolved failures (common query)
  index("idx_failure_unresolved").on(table.resolved).where(sql`${table.resolved} = false`),
]);

export const insertWorkerFailureLogSchema = createInsertSchema(workerFailureLogs).omit({
  id: true,
  timestamp: true,
});

export type WorkerFailureLog = typeof workerFailureLogs.$inferSelect;
export type InsertWorkerFailureLog = z.infer<typeof insertWorkerFailureLogSchema>;

// ============================================
// WORKER FUNCTION ERRORS TABLE
// ============================================
// Replaces data/worker_function_error.log - preserves diagnostic fidelity
export const workerFunctionErrors = pgTable("worker_function_errors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  functionTested: varchar("function_tested", { length: 255 }).notNull(),
  expectedBehavior: text("expected_behavior").notNull(),
  observedBehavior: text("observed_behavior").notNull(),
  severity: integer("severity").notNull(), // 1-5
  status: varchar("status", { length: 20 }).notNull().default('pending'), // 'fixed' | 'pending'
  notes: text("notes"),
}, (table) => [
  index("idx_func_error_timestamp").on(table.timestamp),
  index("idx_func_error_status_severity").on(table.status, sql`${table.severity} DESC`),
]);

export const insertWorkerFunctionErrorSchema = createInsertSchema(workerFunctionErrors).omit({
  id: true,
  timestamp: true,
});

export type WorkerFunctionError = typeof workerFunctionErrors.$inferSelect;
export type InsertWorkerFunctionError = z.infer<typeof insertWorkerFunctionErrorSchema>;

// ============================================
// AI USAGE METRICS TABLE (Migration-Ready)
// ============================================
// Replaces data/ai_usage_metrics.json - critical for quota governance
export const aiUsageMetrics = pgTable("ai_usage_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  taskName: varchar("task_name", { length: 100 }).notNull(),
  provider: varchar("provider", { length: 20 }).notNull(), // 'gemini' | 'groq'
  tokensUsed: integer("tokens_used").notNull(),
  latencyMs: integer("latency_ms"), // Nullable for failed fast aborts
  success: boolean("success").notNull(),
  verbosity: varchar("verbosity", { length: 20 }).notNull(), // 'concise' | 'standard' | 'detailed'
  priority: integer("priority").notNull(),
  errorMessage: text("error_message"),
  source: varchar("source", { length: 20 }).notNull().default('user'), // 'user' | 'worker' - tracks quota allocation
}, (table) => [
  index("idx_ai_usage_provider_timestamp").on(table.provider, sql`${table.timestamp} DESC`),
  index("idx_ai_usage_task").on(table.taskName),
  index("idx_ai_usage_source").on(table.source),
  index("idx_ai_usage_source_timestamp").on(table.source, sql`${table.timestamp} DESC`),
]);

export const insertAiUsageMetricSchema = createInsertSchema(aiUsageMetrics).omit({
  id: true,
  timestamp: true,
});

export type AiUsageMetric = typeof aiUsageMetrics.$inferSelect;
export type InsertAiUsageMetric = z.infer<typeof insertAiUsageMetricSchema>;

// ============================================
// AI CACHE ENTRIES TABLE (Migration-Ready)
// ============================================
// Replaces data/ai_cache/*.json - enables persistent caching across deployments
export const aiCacheEntries = pgTable("ai_cache_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cacheKey: varchar("cache_key", { length: 255 }).notNull().unique(),
  taskName: varchar("task_name", { length: 100 }).notNull(),
  taskSignature: text("task_signature"), // Hash of inputs for invalidation
  value: jsonb("value").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  index("idx_cache_key").on(table.cacheKey),
  index("idx_cache_task").on(table.taskName),
  // Partial index for cleanup queries
  index("idx_cache_expired").on(table.expiresAt).where(sql`${table.expiresAt} < now()`),
]);

export const insertAiCacheEntrySchema = createInsertSchema(aiCacheEntries).omit({
  id: true,
  createdAt: true,
});

export type AiCacheEntry = typeof aiCacheEntries.$inferSelect;
export type InsertAiCacheEntry = z.infer<typeof insertAiCacheEntrySchema>;

// ============================================
// WORKER REPAIR METRICS TABLE
// ============================================
// Replaces data/repair_metrics.json - tracks Worker repair performance
export const workerRepairMetrics = pgTable("worker_repair_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  totalRepairs: integer("total_repairs").notNull(),
  successfulRepairs: integer("successful_repairs").notNull(),
  repairSuccessRate: integer("repair_success_rate").notNull(), // Percentage (0-100)
  meanResolutionTimeMs: integer("mean_resolution_time_ms"),
  concurrentTaskCount: integer("concurrent_task_count"),
  metadata: jsonb("metadata"), // queueLatency, resourceUtilization, etc.
}, (table) => [
  index("idx_repair_metrics_timestamp").on(table.timestamp),
]);

export const insertWorkerRepairMetricSchema = createInsertSchema(workerRepairMetrics).omit({
  id: true,
  timestamp: true,
});

export type WorkerRepairMetric = typeof workerRepairMetrics.$inferSelect;
export type InsertWorkerRepairMetric = z.infer<typeof insertWorkerRepairMetricSchema>;

// ============================================
// WORKER HEALTH METRICS TABLE
// ============================================
// Replaces data/worker_health_metrics.json - comprehensive health tracking
export const workerHealthMetrics = pgTable("worker_health_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  checkType: varchar("check_type", { length: 100 }).notNull(), // 'database_heartbeat', 'diagnostic_cycle', etc.
  status: varchar("status", { length: 20 }).notNull(), // 'success', 'failed', 'restored'
  consecutiveFailures: integer("consecutive_failures").default(0),
  repairAttempts: integer("repair_attempts").default(0),
  latencyMs: integer("latency_ms"), // Nullable
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"),
}, (table) => [
  index("idx_health_timestamp").on(table.timestamp),
  index("idx_health_check_type").on(table.checkType),
  index("idx_health_status").on(table.status),
]);

export const insertWorkerHealthMetricSchema = createInsertSchema(workerHealthMetrics).omit({
  id: true,
  timestamp: true,
});

export type WorkerHealthMetric = typeof workerHealthMetrics.$inferSelect;
export type InsertWorkerHealthMetric = z.infer<typeof insertWorkerHealthMetricSchema>;

// ============================================
// OFFICER SEARCH DEVICE LIMITS TABLE
// ============================================
// Tracks officer search attempts per device (IP + user agent) to enforce rate limits
// Limit: 2 searches per device per day
export const officerSearchDeviceLimits = pgTable("officer_search_device_limits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceFingerprint: varchar("device_fingerprint", { length: 64 }).notNull(), // SHA-256 hash of IP + user agent
  searchedAt: timestamp("searched_at").defaultNow().notNull(),
  ipAddress: varchar("ip_address", { length: 45 }), // For debugging (IPv6 max length)
  userAgent: text("user_agent"), // For debugging
  userId: varchar("user_id"), // Optional - if user is logged in
  officerName: varchar("officer_name"), // Officer searched (for admin review)
}, (table) => [
  index("idx_device_fingerprint_date").on(table.deviceFingerprint, table.searchedAt),
  index("idx_searched_at").on(table.searchedAt), // For cleanup of old records
]);

export const insertOfficerSearchDeviceLimitSchema = createInsertSchema(officerSearchDeviceLimits).omit({
  id: true,
  searchedAt: true,
});

export type OfficerSearchDeviceLimit = typeof officerSearchDeviceLimits.$inferSelect;
export type InsertOfficerSearchDeviceLimit = z.infer<typeof insertOfficerSearchDeviceLimitSchema>;

// ============================================
// WORKER DEFERRED JOBS TABLE
// ============================================
// Stores worker operations deferred due to budget exhaustion
export const workerDeferredJobs = pgTable("worker_deferred_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  scheduledFor: timestamp("scheduled_for").notNull(), // When to retry (usually next UTC midnight)
  operationName: varchar("operation_name", { length: 100 }).notNull(),
  estimatedTokens: integer("estimated_tokens").notNull(),
  metadata: jsonb("metadata"), // Operation-specific data
  status: varchar("status", { length: 20 }).notNull().default('pending'), // 'pending' | 'completed' | 'failed'
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
}, (table) => [
  index("idx_deferred_scheduled").on(table.scheduledFor, table.status),
  index("idx_deferred_operation").on(table.operationName),
]);

export const insertWorkerDeferredJobSchema = createInsertSchema(workerDeferredJobs).omit({
  id: true,
  createdAt: true,
});

export type WorkerDeferredJob = typeof workerDeferredJobs.$inferSelect;
export type InsertWorkerDeferredJob = z.infer<typeof insertWorkerDeferredJobSchema>;

// ============================================
// PETITION WORKFLOWS TABLE
// ============================================
// Main table tracking petition creation workflows
export const petitionWorkflows = pgTable("petition_workflows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'set null' }),
  
  // Core petition information
  city: varchar("city", { length: 100 }).notNull(),
  state: varchar("state", { length: 2 }).notNull(),
  cityPopulation: integer("city_population"),
  requiredSignatures: integer("required_signatures").notNull(),
  
  // Officer and misconduct details
  officerName: text("officer_name").notNull(),
  officerBadge: varchar("officer_badge"),
  officerDepartment: text("officer_department"),
  misconductSummary: text("misconduct_summary").notNull(),
  requestedAction: text("requested_action").notNull(),
  
  // Petitioner information
  petitionerName: text("petitioner_name").notNull(),
  petitionerEmail: varchar("petitioner_email"),
  petitionerAddress: text("petitioner_address"),
  
  // Workflow status
  status: varchar("status", { length: 30 }).notNull().default('collecting_input'),
  // Status values: 'collecting_input', 'gathering_residents', 'generating_content', 
  // 'ready_to_submit', 'submitted', 'failed', 'cancelled'
  
  // Generated content
  petitionContent: text("petition_content"),
  petitionContentGeneratedAt: timestamp("petition_content_generated_at"),
  
  // Submission channel information
  submissionChannel: varchar("submission_channel", { length: 50 }), // 'portal', 'email', 'clerk'
  submissionTarget: text("submission_target"), // URL, email address, or address
  
  // Resident collection progress
  residentsCollected: integer("residents_collected").default(0),
  lastHarvestAt: timestamp("last_harvest_at"),
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  submittedAt: timestamp("submitted_at"),
}, (table) => [
  index("idx_petition_user").on(table.userId),
  index("idx_petition_status").on(table.status),
  index("idx_petition_city_state").on(table.city, table.state),
]);

export const petitionWorkflowsRelations = relations(petitionWorkflows, ({ one, many }) => ({
  user: one(users, {
    fields: [petitionWorkflows.userId],
    references: [users.id],
  }),
  sources: many(petitionSources),
  signers: many(petitionSigners),
  submissions: many(petitionSubmissions),
}));

export const insertPetitionWorkflowSchema = createInsertSchema(petitionWorkflows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PetitionWorkflow = typeof petitionWorkflows.$inferSelect;
export type InsertPetitionWorkflow = z.infer<typeof insertPetitionWorkflowSchema>;

// ============================================
// PETITION SOURCES TABLE
// ============================================
// Data sources used for resident collection
export const petitionSources = pgTable("petition_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowId: varchar("workflow_id").notNull().references(() => petitionWorkflows.id, { onDelete: 'cascade' }),
  
  // Source information
  sourceType: varchar("source_type", { length: 30 }).notNull(), 
  // 'property_tax', 'gis_parcel', 'voter_registration'
  sourceUrl: text("source_url"),
  sourceName: text("source_name"), // E.g., "Maricopa County Assessor"
  
  // Harvesting status
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  // 'pending', 'harvesting', 'completed', 'failed'
  
  // Results
  residentsFound: integer("residents_found").default(0),
  errorMessage: text("error_message"),
  
  // Timestamps
  harvestedAt: timestamp("harvested_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_source_workflow").on(table.workflowId),
  index("idx_source_type").on(table.sourceType),
]);

export const petitionSourcesRelations = relations(petitionSources, ({ one }) => ({
  workflow: one(petitionWorkflows, {
    fields: [petitionSources.workflowId],
    references: [petitionWorkflows.id],
  }),
}));

export const insertPetitionSourceSchema = createInsertSchema(petitionSources).omit({
  id: true,
  createdAt: true,
});

export type PetitionSource = typeof petitionSources.$inferSelect;
export type InsertPetitionSource = z.infer<typeof insertPetitionSourceSchema>;

// ============================================
// PETITION SIGNERS TABLE
// ============================================
// Residents collected from public sources for petition
export const petitionSigners = pgTable("petition_signers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowId: varchar("workflow_id").notNull().references(() => petitionWorkflows.id, { onDelete: 'cascade' }),
  sourceId: varchar("source_id").references(() => petitionSources.id, { onDelete: 'set null' }),
  
  // Signer information (from public records)
  fullName: text("full_name").notNull(),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),
  zipCode: varchar("zip_code", { length: 10 }),
  
  // Deduplication key (hash of normalized name + address)
  dedupeKey: varchar("dedupe_key", { length: 64 }),
  
  // Source metadata
  sourceType: varchar("source_type", { length: 30 }), // Where this record came from
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_signer_workflow").on(table.workflowId),
  index("idx_signer_dedupe").on(table.dedupeKey),
  unique("unique_signer_per_workflow").on(table.workflowId, table.dedupeKey),
]);

export const petitionSignersRelations = relations(petitionSigners, ({ one }) => ({
  workflow: one(petitionWorkflows, {
    fields: [petitionSigners.workflowId],
    references: [petitionWorkflows.id],
  }),
  source: one(petitionSources, {
    fields: [petitionSigners.sourceId],
    references: [petitionSources.id],
  }),
}));

export const insertPetitionSignerSchema = createInsertSchema(petitionSigners).omit({
  id: true,
  createdAt: true,
});

export type PetitionSigner = typeof petitionSigners.$inferSelect;
export type InsertPetitionSigner = z.infer<typeof insertPetitionSignerSchema>;

// ============================================
// PETITION SUBMISSIONS TABLE
// ============================================
// Tracks submission attempts to city council
export const petitionSubmissions = pgTable("petition_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowId: varchar("workflow_id").notNull().references(() => petitionWorkflows.id, { onDelete: 'cascade' }),
  
  // Submission details
  submissionMethod: varchar("submission_method", { length: 30 }).notNull(),
  // 'portal', 'email', 'clerk', 'manual'
  targetAddress: text("target_address").notNull(), // URL, email, or physical address
  
  // Status
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  // 'pending', 'sent', 'delivered', 'failed', 'confirmed'
  
  // Response tracking
  responseReceived: boolean("response_received").default(false),
  responseContent: text("response_content"),
  confirmationNumber: varchar("confirmation_number"),
  
  // Error handling
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0),
  
  // Timestamps
  attemptedAt: timestamp("attempted_at"),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_submission_workflow").on(table.workflowId),
  index("idx_submission_status").on(table.status),
]);

export const petitionSubmissionsRelations = relations(petitionSubmissions, ({ one }) => ({
  workflow: one(petitionWorkflows, {
    fields: [petitionSubmissions.workflowId],
    references: [petitionWorkflows.id],
  }),
}));

export const insertPetitionSubmissionSchema = createInsertSchema(petitionSubmissions).omit({
  id: true,
  createdAt: true,
});

export type PetitionSubmission = typeof petitionSubmissions.$inferSelect;
export type InsertPetitionSubmission = z.infer<typeof insertPetitionSubmissionSchema>;

// ============================================
// CITY COUNCIL CHANNELS TABLE
// ============================================
// Cached submission channels for cities
export const cityCouncilChannels = pgTable("city_council_channels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // City identification
  city: varchar("city", { length: 100 }).notNull(),
  state: varchar("state", { length: 2 }).notNull(),
  
  // Submission channels (in priority order)
  portalUrl: text("portal_url"), // Public comment form or complaint portal
  emailAddresses: text("email_addresses"), // Comma-separated council emails
  clerkEmail: text("clerk_email"),
  clerkAddress: text("clerk_address"),
  
  // Metadata
  lastVerifiedAt: timestamp("last_verified_at"),
  verificationStatus: varchar("verification_status", { length: 20 }).default('unverified'),
  notes: text("notes"),
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_city_state_unique").on(table.city, table.state),
  index("idx_channel_verification").on(table.verificationStatus),
]);

export const insertCityCouncilChannelSchema = createInsertSchema(cityCouncilChannels).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CityCouncilChannel = typeof cityCouncilChannels.$inferSelect;
export type InsertCityCouncilChannel = z.infer<typeof insertCityCouncilChannelSchema>;

// ============================================
// AUTHORITY CONTACTS CACHE TABLE
// ============================================
// Cached internal affairs, oversight, and command staff contacts
export const authorityContactsCache = pgTable("authority_contacts_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Department identification
  departmentName: text("department_name").notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  county: varchar("county", { length: 100 }),
  state: varchar("state", { length: 2 }).notNull(),
  
  // Contact information
  contactName: text("contact_name"),
  contactTitle: text("contact_title"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  contactAddress: text("contact_address"),
  
  // Contact type and confidence
  contactType: varchar("contact_type", { length: 30 }).notNull(), // 'internal_affairs', 'oversight', 'command_staff', 'professional_standards', 'civilian_review'
  confidence: varchar("confidence", { length: 10 }).notNull().default('medium'), // 'high', 'medium', 'low'
  
  // Source information
  sourceUrl: text("source_url"),
  sourceType: varchar("source_type", { length: 30 }), // 'official_website', 'web_search', 'manual_entry'
  
  // Verification
  lastVerifiedAt: timestamp("last_verified_at"),
  verificationStatus: varchar("verification_status", { length: 20 }).default('unverified'),
  isActive: boolean("is_active").default(true),
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_authority_dept_city_state").on(table.departmentName, table.city, table.state),
  index("idx_authority_contact_type").on(table.contactType),
  index("idx_authority_active").on(table.isActive),
]);

export const insertAuthorityContactsCacheSchema = createInsertSchema(authorityContactsCache).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AuthorityContactsCache = typeof authorityContactsCache.$inferSelect;
export type InsertAuthorityContactsCache = z.infer<typeof insertAuthorityContactsCacheSchema>;

// ============================================
// COMPLAINT ROUTING HISTORY TABLE
// ============================================
// Track complaint routing attempts and results
export const complaintRoutingHistory = pgTable("complaint_routing_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Reference to complaint
  complaintId: varchar("complaint_id").references(() => complaints.id, { onDelete: 'cascade' }),
  
  // Routing attempt details
  attemptNumber: integer("attempt_number").notNull().default(1),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  recipientType: varchar("recipient_type", { length: 30 }), // 'internal_affairs', 'oversight', 'command_staff', 'admin_fallback'
  
  // Status
  status: varchar("status", { length: 20 }).notNull().default('pending'), // 'pending', 'sent', 'delivered', 'failed', 'bounced'
  statusMessage: text("status_message"),
  
  // Email details
  emailSubject: text("email_subject"),
  emailMessageId: varchar("email_message_id"), // From email provider
  
  // Fallback tracking
  isFallback: boolean("is_fallback").default(false),
  fallbackReason: text("fallback_reason"),
  
  // Timestamps
  attemptedAt: timestamp("attempted_at").defaultNow(),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_routing_complaint").on(table.complaintId),
  index("idx_routing_status").on(table.status),
  index("idx_routing_fallback").on(table.isFallback),
]);

export const complaintRoutingHistoryRelations = relations(complaintRoutingHistory, ({ one }) => ({
  complaint: one(complaints, {
    fields: [complaintRoutingHistory.complaintId],
    references: [complaints.id],
  }),
}));

export const insertComplaintRoutingHistorySchema = createInsertSchema(complaintRoutingHistory).omit({
  id: true,
  createdAt: true,
  attemptedAt: true,
});

export type ComplaintRoutingHistory = typeof complaintRoutingHistory.$inferSelect;
export type InsertComplaintRoutingHistory = z.infer<typeof insertComplaintRoutingHistorySchema>;

// ============================================
// SECTION 1983 LAWSUIT FILINGS TABLE
// ============================================
// Enhanced tracking for §1983 federal civil rights lawsuits
export const section1983Filings = pgTable("section_1983_filings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // Link to original complaint or lawsuit if applicable
  complaintId: varchar("complaint_id").references(() => complaints.id, { onDelete: 'set null' }),
  lawsuitFilingId: varchar("lawsuit_filing_id").references(() => lawsuitFilings.id, { onDelete: 'set null' }),
  
  // Plaintiff information
  plaintiffName: text("plaintiff_name").notNull(),
  plaintiffAddress: text("plaintiff_address").notNull(),
  plaintiffCity: varchar("plaintiff_city", { length: 100 }).notNull(),
  plaintiffState: varchar("plaintiff_state", { length: 2 }).notNull(),
  plaintiffZip: varchar("plaintiff_zip", { length: 10 }),
  plaintiffPhone: varchar("plaintiff_phone"),
  plaintiffEmail: varchar("plaintiff_email"),
  isProSe: boolean("is_pro_se").default(true),
  
  // Attorney information (if not pro se)
  attorneyName: text("attorney_name"),
  attorneyBarNumber: varchar("attorney_bar_number"),
  attorneyFirm: text("attorney_firm"),
  attorneyAddress: text("attorney_address"),
  attorneyPhone: varchar("attorney_phone"),
  attorneyEmail: varchar("attorney_email"),
  
  // Defendant information (JSON array of defendants)
  defendants: jsonb("defendants").notNull(), // Array of DefendantInfo objects
  
  // Incident information
  incidentDate: timestamp("incident_date").notNull(),
  incidentTime: varchar("incident_time"),
  incidentLocation: text("incident_location").notNull(),
  incidentCity: varchar("incident_city", { length: 100 }).notNull(),
  incidentCounty: varchar("incident_county", { length: 100 }),
  incidentState: varchar("incident_state", { length: 2 }).notNull(),
  incidentDescription: text("incident_description").notNull(),
  
  // Claims (JSON array of claims)
  claims: jsonb("claims").notNull(), // Array of ClaimInfo objects
  
  // Damages
  damagesCompensatory: jsonb("damages_compensatory"), // CompensatoryDamages object
  damagesPunitive: boolean("damages_punitive").default(false),
  damagesPunitiveDescription: text("damages_punitive_description"),
  damagesInjunctive: text("damages_injunctive"),
  damagesDeclaratory: text("damages_declaratory"),
  damagesAttorneysFees: boolean("damages_attorneys_fees").default(true),
  
  // Jurisdiction
  districtCourt: text("district_court").notNull(),
  courtDivision: varchar("court_division", { length: 100 }),
  venueReason: text("venue_reason").notNull(),
  
  // Generated document
  generatedDocument: text("generated_document"),
  localRulesApplied: jsonb("local_rules_applied"), // LocalRules object
  
  // Filing information
  filingFee: integer("filing_fee").default(40200), // $402.00 in cents
  serviceDeadline: timestamp("service_deadline"),
  
  // Status
  status: varchar("status", { length: 30 }).notNull().default('draft'), // 'draft', 'generated', 'downloaded', 'filed', 'served'
  
  // Payment
  paymentId: varchar("payment_id"),
  paymentStatus: varchar("payment_status").default('pending'),
  amountPaid: integer("amount_paid"),
  
  // Timestamps
  generatedAt: timestamp("generated_at"),
  downloadedAt: timestamp("downloaded_at"),
  filedAt: timestamp("filed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_1983_user").on(table.userId),
  index("idx_1983_status").on(table.status),
  index("idx_1983_district").on(table.districtCourt),
  index("idx_1983_incident_date").on(table.incidentDate),
]);

export const section1983FilingsRelations = relations(section1983Filings, ({ one }) => ({
  user: one(users, {
    fields: [section1983Filings.userId],
    references: [users.id],
  }),
  complaint: one(complaints, {
    fields: [section1983Filings.complaintId],
    references: [complaints.id],
  }),
  lawsuitFiling: one(lawsuitFilings, {
    fields: [section1983Filings.lawsuitFilingId],
    references: [lawsuitFilings.id],
  }),
}));

export const insertSection1983FilingSchema = createInsertSchema(section1983Filings).omit({
  id: true,
  userId: true,
  generatedDocument: true,
  localRulesApplied: true,
  serviceDeadline: true,
  paymentId: true,
  paymentStatus: true,
  amountPaid: true,
  generatedAt: true,
  downloadedAt: true,
  filedAt: true,
  createdAt: true,
  updatedAt: true,
  status: true,
}).extend({
  incidentDate: z.string().or(z.date()),
  defendants: z.array(z.object({
    name: z.string(),
    title: z.string().optional(),
    badgeNumber: z.string().optional(),
    department: z.string(),
    address: z.string().optional(),
    capacity: z.enum(['individual', 'official', 'both']),
    role: z.string(),
  })),
  claims: z.array(z.object({
    claimNumber: z.number(),
    constitutionalProvision: z.string(),
    statute: z.string(),
    description: z.string(),
    defendantsInvolved: z.array(z.string()),
    factualBasis: z.string(),
  })),
});

export type Section1983Filing = typeof section1983Filings.$inferSelect;
export type InsertSection1983Filing = z.infer<typeof insertSection1983FilingSchema>;

// ============================================
// FOIA ROUTING HISTORY TABLE
// ============================================
// Tracks FOIA request routing attempts and outcomes
export const foiaRoutingHistory = pgTable("foia_routing_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  foiaId: varchar("foia_id").references(() => foiaRequests.id, { onDelete: 'set null' }),
  agencyName: varchar("agency_name").notNull(),
  state: varchar("state", { length: 2 }).notNull(),
  city: varchar("city"),
  routingMethod: varchar("routing_method", { length: 50 }).notNull(), // 'direct_email', 'portal_link', 'admin_fallback'
  success: boolean("success").notNull().default(false),
  recipientEmail: varchar("recipient_email"),
  recipientType: varchar("recipient_type", { length: 50 }), // 'foia_officer', 'records_custodian', 'transparency_office', 'admin_fallback'
  notes: text("notes"),
  errorMessage: text("error_message"),
  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_foia_routing_agency").on(table.agencyName, table.state),
  index("idx_foia_routing_foia_id").on(table.foiaId),
  index("idx_foia_routing_success").on(table.success),
  index("idx_foia_routing_attempted").on(table.attemptedAt),
]);

export const foiaRoutingHistoryRelations = relations(foiaRoutingHistory, ({ one }) => ({
  foiaRequest: one(foiaRequests, {
    fields: [foiaRoutingHistory.foiaId],
    references: [foiaRequests.id],
  }),
}));

export const insertFoiaRoutingHistorySchema = createInsertSchema(foiaRoutingHistory).omit({
  id: true,
  createdAt: true,
});

export type FoiaRoutingHistory = typeof foiaRoutingHistory.$inferSelect;

// ============================================
// DOCUMENT CREATOR SESSIONS TABLE
// ============================================
export const documentCreatorSessions = pgTable("document_creator_sessions", {
  id: text("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  conversationState: text("conversation_state").notNull().default('[]'),
  conversationPhase: text("conversation_phase").notNull().default('initial'),
  documentType: text("document_type"),
  jurisdictionData: text("jurisdiction_data"),
  generatedDocument: text("generated_document"),
  paymentStatus: text("payment_status").default('pending'),
  paymentId: varchar("payment_id"), // Payment processor reference (Square)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const documentCreatorSessionsRelations = relations(documentCreatorSessions, ({ one }) => ({
  user: one(users, {
    fields: [documentCreatorSessions.userId],
    references: [users.id],
  }),
}));

export const insertDocumentCreatorSessionSchema = createInsertSchema(documentCreatorSessions).omit({
  createdAt: true,
});

export type DocumentCreatorSession = typeof documentCreatorSessions.$inferSelect;
export type InsertDocumentCreatorSession = z.infer<typeof insertDocumentCreatorSessionSchema>;

// Document Creator pricing
export const DOCUMENT_CREATOR_PRICING = 3.99;
export const DOCUMENT_CREATOR_PRICING_CENTS = 399; // $3.99 in cents
export type InsertFoiaRoutingHistory = z.infer<typeof insertFoiaRoutingHistorySchema>;

// ============================================
// LEGALIZO SUBSCRIPTIONS TABLE
// ============================================
export const legalizoSubscriptions = pgTable("legalizo_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  squareSubscriptionId: varchar("square_subscription_id").unique(),
  status: varchar("status", { length: 50 }).notNull().default('pending'), // pending, active, canceled, past_due, paused
  planAmount: integer("plan_amount").notNull().default(2599), // $25.99 in cents - matches LEGALIZO_SUBSCRIPTION_PRICING_CENTS
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  canceledAt: timestamp("canceled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_legalizo_sub_user").on(table.userId),
  index("idx_legalizo_sub_status").on(table.status),
]);

export const legalizoSubscriptionsRelations = relations(legalizoSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [legalizoSubscriptions.userId],
    references: [users.id],
  }),
}));

export const insertLegalizoSubscriptionSchema = createInsertSchema(legalizoSubscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type LegalizoSubscription = typeof legalizoSubscriptions.$inferSelect;
export type InsertLegalizoSubscription = z.infer<typeof insertLegalizoSubscriptionSchema>;

// LegalWhat subscription pricing
export const LEGALIZO_SUBSCRIPTION_PRICING = 25.99;
export const LEGALIZO_SUBSCRIPTION_PRICING_CENTS = 2599; // $25.99 in cents

// ============================================
// LAW TYPES ENUMERATION
// ============================================
export const LAW_TYPES = [
  'Family Law',
  'Criminal Law',
  'Civil Litigation',
  'Employment Law',
  'Corporate Law',
  'Intellectual Property',
  'Real Estate Law',
  'Bankruptcy Law',
  'Immigration Law',
  'Personal Injury',
  'Tax Law',
  'Environmental Law',
  'Consumer Protection',
  'Contract Law',
  'Elder Law',
  'Education Law',
  'Healthcare Law',
  'Insurance Law',
  'Maritime Law',
  'Constitutional Law',
  'Administrative Law',
  'Entertainment Law',
  'Sports Law',
  'Technology Law',
  'International Law',
  'Human Rights Law',
  'Probate and Estate Law',
  'Housing and Landlord-Tenant Law',
  'Securities Law',
  'Transportation Law',
  'Animal Law',
  'Aviation Law',
  'Military Law',
  'Election Law',
  'Energy Law',
  'Insurance Defense',
  'Workers Compensation',
  'Social Security Law',
  'Disability Law',
  'Antitrust Law',
] as const;

export type LawType = typeof LAW_TYPES[number];

// ============================================
// LEGALIZO CONSULTATION SESSIONS TABLE
// ============================================
export const legalizoConsultationSessions = pgTable("legalizo_consultation_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  lawType: varchar("law_type", { length: 100 }).notNull(),
  conversationState: jsonb("conversation_state").notNull().default('[]'),
  consultationData: jsonb("consultation_data"),
  documentData: jsonb("document_data"),
  status: varchar("status", { length: 50 }).notNull().default('in_progress'), // in_progress, completed, abandoned
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_legalizo_consult_user").on(table.userId),
  index("idx_legalizo_consult_law_type").on(table.lawType),
  index("idx_legalizo_consult_status").on(table.status),
]);

export const legalizoConsultationSessionsRelations = relations(legalizoConsultationSessions, ({ one }) => ({
  user: one(users, {
    fields: [legalizoConsultationSessions.userId],
    references: [users.id],
  }),
}));

export const insertLegalizoConsultationSessionSchema = createInsertSchema(legalizoConsultationSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type LegalizoConsultationSession = typeof legalizoConsultationSessions.$inferSelect;
export type InsertLegalizoConsultationSession = z.infer<typeof insertLegalizoConsultationSessionSchema>;

// ============================================
// PEOPLE SEARCH REPORTS TABLE
// ============================================
export const peopleSearchReports = pgTable("people_search_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  searchQuery: text("search_query").notNull(),
  subjectName: varchar("subject_name", { length: 255 }),
  reportData: jsonb("report_data").notNull(),
  status: varchar("status", { length: 50 }).notNull().default('processing'), // processing, completed, failed
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_people_search_user").on(table.userId),
  index("idx_people_search_status").on(table.status),
  index("idx_people_search_created").on(table.createdAt),
]);

export const peopleSearchReportsRelations = relations(peopleSearchReports, ({ one }) => ({
  user: one(users, {
    fields: [peopleSearchReports.userId],
    references: [users.id],
  }),
}));

export const insertPeopleSearchReportSchema = createInsertSchema(peopleSearchReports).omit({
  id: true,
  createdAt: true,
});

export type PeopleSearchReport = typeof peopleSearchReports.$inferSelect;

// ============================================
// EVIDENCE FILES TABLE - F.M.I. (Forensic Media Intelligence)
// ============================================
export const evidenceFiles = pgTable("evidence_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  storagePath: text("storage_path").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  lawType: text("law_type"), // References law types from shared/lawTypes.ts
  associatedWith: varchar("associated_with", { length: 20 }), // 'consultation' | 'document' | null
  
  // F.M.I. - Forensic Media Intelligence metadata
  fmiAnalysisStatus: varchar("fmi_analysis_status", { length: 20 }).default('pending'), // 'pending' | 'processing' | 'completed' | 'failed'
  fmiAnalyzedAt: timestamp("fmi_analyzed_at"),
  
  // OCR and text extraction
  extractedText: text("extracted_text"), // OCR results from documents/images
  extractedMetadata: jsonb("extracted_metadata"), // Technical metadata (EXIF, timestamps, etc.)
  
  // Content classification and legal relevance
  contentClassification: jsonb("content_classification"), // Document type, evidence category, etc.
  legalRelevanceTags: text("legal_relevance_tags").array(), // Tags for legal significance
  legalIssuesIdentified: text("legal_issues_identified").array(), // Identified legal claims/defenses
  
  // Intelligence analysis results
  contradictions: jsonb("contradictions"), // Detected contradictions with other evidence
  corroboration: jsonb("corroboration"), // Corroboration with other evidence
  caseLinkages: jsonb("case_linkages"), // Links to people, dates, locations, events
  
  // Evidence assessment
  evidenceStrength: varchar("evidence_strength", { length: 20 }), // 'compelling' | 'strong' | 'moderate' | 'weak'
  admissibilityAssessment: varchar("admissibility_assessment", { length: 30 }), // 'admissible' | 'likely-admissible' | 'questionable'
  keyFindings: text("key_findings").array(), // Key extracted insights
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_evidence_user").on(table.userId),
  index("idx_evidence_law_type").on(table.lawType),
  index("idx_fmi_analysis_status").on(table.fmiAnalysisStatus),
]);

export const evidenceFilesRelations = relations(evidenceFiles, ({ one }) => ({
  user: one(users, {
    fields: [evidenceFiles.userId],
    references: [users.id],
  }),
}));

export const insertEvidenceFileSchema = createInsertSchema(evidenceFiles).omit({
  id: true,
  createdAt: true,
  uploadedAt: true,
  fmiAnalysisStatus: true,
  fmiAnalyzedAt: true,
  extractedText: true,
  extractedMetadata: true,
  contentClassification: true,
  legalRelevanceTags: true,
  legalIssuesIdentified: true,
  contradictions: true,
  corroboration: true,
  caseLinkages: true,
  evidenceStrength: true,
  admissibilityAssessment: true,
  keyFindings: true,
});

export type InsertEvidenceFile = z.infer<typeof insertEvidenceFileSchema>;
export type EvidenceFile = typeof evidenceFiles.$inferSelect;

// ============================================
// PLANS TABLE (Subscription Plans)
// ============================================
export const plans = pgTable("plans", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  price: integer("price").notNull(), // Price in cents
  currency: varchar("currency", { length: 8 }).notNull().default('USD'),
  interval: varchar("interval", { length: 16 }).notNull().default('monthly'),
  squarePlanId: text("square_plan_id").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Plan = typeof plans.$inferSelect;
export type InsertPlan = typeof plans.$inferInsert;

// ============================================
// SUBSCRIPTIONS TABLE (User Subscriptions)
// ============================================
export const subscriptions = pgTable("subscriptions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  planId: integer("plan_id").notNull().references(() => plans.id, { onDelete: 'restrict' }),
  status: varchar("status", { length: 32 }).notNull(),
  squareSubscriptionId: text("square_subscription_id"),
  startDate: timestamp("start_date", { mode: 'date' }),
  renewalDate: timestamp("renewal_date", { mode: 'date' }),
  canceledAt: timestamp("canceled_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_subscriptions_user_id").on(table.userId),
  index("idx_subscriptions_status").on(table.status),
]);

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, {
    fields: [subscriptions.userId],
    references: [users.id],
  }),
  plan: one(plans, {
    fields: [subscriptions.planId],
    references: [plans.id],
  }),
}));

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

// ============================================
// TRANSACTIONS TABLE (Payment Transactions)
// ============================================
export const transactions = pgTable("transactions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  subscriptionId: integer("subscription_id").references(() => subscriptions.id, { onDelete: 'set null' }),
  squarePaymentId: text("square_payment_id"),
  amount: integer("amount").notNull(), // Amount in cents
  currency: varchar("currency", { length: 8 }).notNull().default('USD'),
  status: varchar("status", { length: 32 }).notNull(),
  eventType: text("event_type"),
  createdAt: timestamp("created_at").defaultNow(),
  rawPayload: jsonb("raw_payload"),
}, (table) => [
  index("idx_transactions_user_id").on(table.userId),
  index("idx_transactions_subscription_id").on(table.subscriptionId),
]);

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, {
    fields: [transactions.userId],
    references: [users.id],
  }),
  subscription: one(subscriptions, {
    fields: [transactions.subscriptionId],
    references: [subscriptions.id],
  }),
}));

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;

// ============================================
// RECONCILIATION_JOBS TABLE (Platform-aware job processing)
// ============================================
export const reconciliationJobs = pgTable("reconciliation_jobs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  platform: text("platform").notNull().default('square'), // 'square' or 'newplatform'
  idempotencyKey: text("idempotency_key"), // UUID for deduplication
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`), // Job-specific data
  status: text("status").notNull().default('pending'), // pending, processing, done, failed, manual_review
  attempts: integer("attempts").notNull().default(0), // Retry counter
  lastError: text("last_error"), // Most recent error message
  startedAt: timestamp("started_at", { withTimezone: true }), // When processing started
  worker: text("worker"), // Worker hostname/ID
  completedAt: timestamp("completed_at", { withTimezone: true }), // When completed
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_reconciliation_platform_status").on(table.platform, table.status),
  index("idx_reconciliation_status_created").on(table.status, table.createdAt),
  uniqueIndex("ux_reconciliation_platform_idempotency").on(table.platform, table.idempotencyKey).where(sql`idempotency_key IS NOT NULL`),
  index("idx_reconciliation_worker").on(table.worker).where(sql`worker IS NOT NULL`),
]);

export type ReconciliationJob = typeof reconciliationJobs.$inferSelect;
export type InsertReconciliationJob = typeof reconciliationJobs.$inferInsert;

// ============================================
// USER_CONSENTS TABLE (Legal acknowledgment tracking)
// ============================================
export const userConsents = pgTable("user_consents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  paymentId: text("payment_id").notNull(), // Square payment ID or subscription ID
  planId: text("plan_id"), // Subscription plan ID at time of consent
  consentVersion: text("consent_version").notNull(), // Version format: v1.0, v1.1, etc.
  consentText: text("consent_text").notNull(), // Full legal acknowledgment text
  ipAddress: text("ip_address"), // User IP at time of consent
  userAgent: text("user_agent"), // Browser user agent
  signature: text("signature"), // HMAC-SHA256 signature for verification
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("ux_user_payment_consent").on(table.userId, table.paymentId, table.consentVersion),
  index("idx_user_consents_user_id").on(table.userId),
  index("idx_user_consents_payment_id").on(table.paymentId),
  index("idx_user_consents_created_at").on(table.createdAt),
]);

export const userConsentsRelations = relations(userConsents, ({ one }) => ({
  user: one(users, {
    fields: [userConsents.userId],
    references: [users.id],
  }),
}));

export type UserConsent = typeof userConsents.$inferSelect;
export type InsertUserConsent = typeof userConsents.$inferInsert;
export type InsertPeopleSearchReport = z.infer<typeof insertPeopleSearchReportSchema>;

// ============================================
// LEGAL COUNSEL SESSIONS TABLE
// ============================================
// Tracks Legal Counsel conversation sessions with context
export const legalCounselSessions = pgTable("legal_counsel_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  lawType: varchar("law_type", { length: 100 }).notNull(),
  state: varchar("state", { length: 2 }).notNull(),
  context: jsonb("context").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_legal_counsel_sessions_user").on(table.userId),
  index("idx_legal_counsel_sessions_law_type").on(table.lawType),
  index("idx_legal_counsel_sessions_created").on(table.createdAt),
]);

export const legalCounselSessionsRelations = relations(legalCounselSessions, ({ one, many }) => ({
  user: one(users, {
    fields: [legalCounselSessions.userId],
    references: [users.id],
  }),
  messages: many(legalCounselMessages),
  suggestions: many(legalCounselSuggestions),
}));

export const insertLegalCounselSessionSchema = createInsertSchema(legalCounselSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type LegalCounselSession = typeof legalCounselSessions.$inferSelect;
export type InsertLegalCounselSession = z.infer<typeof insertLegalCounselSessionSchema>;

// ============================================
// LEGAL COUNSEL MESSAGES TABLE
// ============================================
// Stores messages with verification and citations
export const legalCounselMessages = pgTable("legal_counsel_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => legalCounselSessions.id, { onDelete: 'cascade' }),
  role: varchar("role", { length: 20 }).notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  verified: boolean("verified").default(false).notNull(),
  verificationScore: integer("verification_score"), // 0-100 scale
  citations: jsonb("citations").default(sql`'[]'::jsonb`), // Array of Citation objects
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("idx_legal_counsel_messages_session").on(table.sessionId),
  index("idx_legal_counsel_messages_timestamp").on(table.timestamp),
]);

export const legalCounselMessagesRelations = relations(legalCounselMessages, ({ one }) => ({
  session: one(legalCounselSessions, {
    fields: [legalCounselMessages.sessionId],
    references: [legalCounselSessions.id],
  }),
}));

export const insertLegalCounselMessageSchema = createInsertSchema(legalCounselMessages).omit({
  id: true,
  timestamp: true,
});

export type LegalCounselMessage = typeof legalCounselMessages.$inferSelect;
export type InsertLegalCounselMessage = z.infer<typeof insertLegalCounselMessageSchema>;

// ============================================
// LEGAL COUNSEL SUGGESTIONS TABLE
// ============================================
// Tool suggestions generated during consultation
export const legalCounselSuggestions = pgTable("legal_counsel_suggestions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => legalCounselSessions.id, { onDelete: 'cascade' }),
  type: varchar("type", { length: 30 }).notNull(), // 'document' | 'people-search' | 'evidence-upload' | 'next-step'
  priority: varchar("priority", { length: 10 }).notNull(), // 'high' | 'medium' | 'low'
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  status: varchar("status", { length: 20 }).notNull().default('pending'), // 'pending' | 'accepted' | 'dismissed'
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_legal_counsel_suggestions_session").on(table.sessionId),
  index("idx_legal_counsel_suggestions_status").on(table.status),
  index("idx_legal_counsel_suggestions_priority").on(table.priority),
]);

export const legalCounselSuggestionsRelations = relations(legalCounselSuggestions, ({ one }) => ({
  session: one(legalCounselSessions, {
    fields: [legalCounselSuggestions.sessionId],
    references: [legalCounselSessions.id],
  }),
}));

export const insertLegalCounselSuggestionSchema = createInsertSchema(legalCounselSuggestions).omit({
  id: true,
  createdAt: true,
});

export type LegalCounselSuggestion = typeof legalCounselSuggestions.$inferSelect;
export type InsertLegalCounselSuggestion = z.infer<typeof insertLegalCounselSuggestionSchema>;

// ============================================
// CRYPTO WALLETS TABLE
// ============================================
export const cryptoWallets = pgTable("crypto_wallets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  address: varchar("address", { length: 42 }).notNull().unique(),
  encryptedKey: text("encrypted_key").notNull(),
  mnemonic: text("mnemonic"),
  chains: jsonb("chains").default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_crypto_wallets_address").on(table.address),
]);

export const insertCryptoWalletSchema = createInsertSchema(cryptoWallets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CryptoWallet = typeof cryptoWallets.$inferSelect;
export type InsertCryptoWallet = z.infer<typeof insertCryptoWalletSchema>;

// ============================================
// CRYPTO TRANSACTIONS TABLE
// ============================================
export const cryptoTransactions = pgTable("crypto_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletId: varchar("wallet_id").notNull().references(() => cryptoWallets.id, { onDelete: 'cascade' }),
  chain: varchar("chain", { length: 20 }).notNull(),
  txHash: varchar("tx_hash", { length: 66 }).notNull().unique(),
  fromAddress: varchar("from_address", { length: 42 }).notNull(),
  toAddress: varchar("to_address", { length: 42 }).notNull(),
  amount: varchar("amount").notNull(),
  asset: varchar("asset", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).default('pending'),
  agentId: varchar("agent_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_crypto_transactions_wallet").on(table.walletId),
  index("idx_crypto_transactions_chain").on(table.chain),
  index("idx_crypto_transactions_hash").on(table.txHash),
  index("idx_crypto_transactions_agent").on(table.agentId),
]);

export const cryptoTransactionsRelations = relations(cryptoTransactions, ({ one }) => ({
  wallet: one(cryptoWallets, {
    fields: [cryptoTransactions.walletId],
    references: [cryptoWallets.id],
  }),
}));

export const insertCryptoTransactionSchema = createInsertSchema(cryptoTransactions).omit({
  id: true,
  createdAt: true,
});

export type CryptoTransaction = typeof cryptoTransactions.$inferSelect;
export type InsertCryptoTransaction = z.infer<typeof insertCryptoTransactionSchema>;

// ============================================
// DUAL-MODULE AI SYSTEM TABLES (4JI-GENIE)
// ============================================

// System Rules Table - Immutable rules for domain separation
export const systemRules = pgTable("system_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ruleId: varchar("rule_id", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").notNull(),
  category: varchar("category", { length: 50 }).notNull(), // domain-isolation, compute-control, etc.
  severity: varchar("severity", { length: 20 }).notNull().default('critical'),
  enabled: boolean("enabled").notNull().default(true),
  enforcement: varchar("enforcement", { length: 20 }).notNull().default('block'), // block, warn, log
  violationCount: integer("violation_count").notNull().default(0),
  lastViolation: timestamp("last_violation"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_system_rules_category").on(table.category),
  index("idx_system_rules_severity").on(table.severity),
]);

export type SystemRule = typeof systemRules.$inferSelect;
export type InsertSystemRule = typeof systemRules.$inferInsert;

// Domain Violations Table - Track cross-domain access attempts
export const domainViolations = pgTable("domain_violations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceDomain: varchar("source_domain", { length: 20 }).notNull(), // 'legal' or 'crypto'
  targetDomain: varchar("target_domain", { length: 20 }).notNull(),
  query: text("query"),
  userId: varchar("user_id"),
  blocked: boolean("blocked").notNull().default(true),
  ruleId: varchar("rule_id").references(() => systemRules.id, { onDelete: 'set null' }),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("idx_domain_violations_source").on(table.sourceDomain),
  index("idx_domain_violations_timestamp").on(table.timestamp),
]);

export type DomainViolation = typeof domainViolations.$inferSelect;
export type InsertDomainViolation = typeof domainViolations.$inferInsert;

// Module Status Table - Track ALEXARA/CRYPTARA/4JI-GENIE status
export const moduleStatus = pgTable("module_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  moduleName: varchar("module_name", { length: 50 }).notNull().unique(), // ALEXARA, CRYPTARA, 4JI-GENIE
  isRunning: boolean("is_running").notNull().default(false),
  lastStarted: timestamp("last_started"),
  lastStopped: timestamp("last_stopped"),
  totalRequests: integer("total_requests").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  uptime: integer("uptime").notNull().default(0), // in seconds
  lastHealthCheck: timestamp("last_health_check"),
  healthStatus: varchar("health_status", { length: 20 }).notNull().default('unknown'), // healthy, degraded, error, offline
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_module_status_name").on(table.moduleName),
  index("idx_module_status_running").on(table.isRunning),
]);

export type ModuleStatus = typeof moduleStatus.$inferSelect;
export type InsertModuleStatus = typeof moduleStatus.$inferInsert;

// Permissions Matrix Table - Track approved permissions
export const permissionsMatrix = pgTable("permissions_matrix", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  permissionId: varchar("permission_id", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(), // crawler, faucet, install, update, upgrade, package
  description: text("description"),
  approved: boolean("approved").notNull().default(false),
  approvedBy: varchar("approved_by"),
  approvedAt: timestamp("approved_at"),
  scheduledWeekday: varchar("scheduled_weekday", { length: 10 }), // sunday, monday, etc.
  scheduledTime: varchar("scheduled_time", { length: 5 }), // HH:MM format
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_permissions_matrix_category").on(table.category),
  index("idx_permissions_matrix_approved").on(table.approved),
]);

export type PermissionMatrixEntry = typeof permissionsMatrix.$inferSelect;
export type InsertPermissionMatrixEntry = typeof permissionsMatrix.$inferInsert;

// Install Requests Table - Track package installation approvals
export const installRequests = pgTable("install_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  packageName: varchar("package_name", { length: 255 }).notNull(),
  version: varchar("version", { length: 50 }),
  packageType: varchar("package_type", { length: 20 }).notNull(), // npm, pip, system, custom
  reason: text("reason").notNull(),
  requestedBy: varchar("requested_by").notNull(),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  status: varchar("status", { length: 20 }).notNull().default('pending'), // pending, approved, rejected, installed
  approvedBy: varchar("approved_by"),
  approvedAt: timestamp("approved_at"),
  scheduledWeekday: varchar("scheduled_weekday", { length: 10 }),
  scheduledTime: varchar("scheduled_time", { length: 5 }),
  installedAt: timestamp("installed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_install_requests_status").on(table.status),
  index("idx_install_requests_requested").on(table.requestedAt),
]);

export type InstallRequest = typeof installRequests.$inferSelect;
export type InsertInstallRequest = typeof installRequests.$inferInsert;

// Scheduled Tasks Table - Track weekly update tasks
export const scheduledTasks = pgTable("scheduled_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskType: varchar("task_type", { length: 50 }).notNull(), // upgrade, optimization, modification, enhancement
  description: text("description").notNull(),
  scheduledFor: timestamp("scheduled_for").notNull(),
  status: varchar("status", { length: 20 }).notNull().default('pending'), // pending, running, completed, failed
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  result: text("result"),
  errorMessage: text("error_message"),
  createdBy: varchar("created_by"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_scheduled_tasks_status").on(table.status),
  index("idx_scheduled_tasks_scheduled").on(table.scheduledFor),
]);

export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type InsertScheduledTask = typeof scheduledTasks.$inferInsert;

// Database Shadow Sync Table - Track local/supabase sync status
export const databaseShadowSync = pgTable("database_shadow_sync", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tableName: varchar("table_name", { length: 100 }).notNull(),
  lastSyncedAt: timestamp("last_synced_at"),
  syncStatus: varchar("sync_status", { length: 20 }).notNull().default('pending'), // synced, syncing, out-of-sync, error
  pendingChanges: integer("pending_changes").notNull().default(0),
  lastChangeAt: timestamp("last_change_at"),
  errorMessage: text("error_message"),
  checksumLocal: varchar("checksum_local", { length: 64 }),
  checksumRemote: varchar("checksum_remote", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_shadow_sync_table").on(table.tableName),
  index("idx_shadow_sync_status").on(table.syncStatus),
]);

export type DatabaseShadowSync = typeof databaseShadowSync.$inferSelect;
export type InsertDatabaseShadowSync = typeof databaseShadowSync.$inferInsert;

// Admin Identity Binding Table - Secure admin authentication
export const adminIdentityBinding = pgTable("admin_identity_binding", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  identityLabel: varchar("identity_label", { length: 50 }).notNull().unique(), // "Daddy"
  passwordHash: text("password_hash").notNull(), // Hashed SARBEAR
  lastAuthenticated: timestamp("last_authenticated"),
  authenticationCount: integer("authentication_count").notNull().default(0),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lastFailedAt: timestamp("last_failed_at"),
  isLocked: boolean("is_locked").notNull().default(false),
  lockedUntil: timestamp("locked_until"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type AdminIdentityBinding = typeof adminIdentityBinding.$inferSelect;
export type InsertAdminIdentityBinding = typeof adminIdentityBinding.$inferInsert;

// ALEXARA Research Log Table - Track legal research activity
export const alexaraResearchLog = pgTable("alexara_research_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  query: text("query").notNull(),
  jurisdiction: varchar("jurisdiction", { length: 50 }),
  lawType: varchar("law_type", { length: 100 }),
  userId: varchar("user_id"),
  sessionId: varchar("session_id"),
  findings: text("findings"),
  citations: text("citations").array(),
  statutes: text("statutes").array(),
  precedents: text("precedents").array(),
  confidence: integer("confidence"), // 0-100
  processingTimeMs: integer("processing_time_ms"),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_alexara_log_user").on(table.userId),
  index("idx_alexara_log_created").on(table.createdAt),
  index("idx_alexara_log_law_type").on(table.lawType),
]);

export type AlexaraResearchLog = typeof alexaraResearchLog.$inferSelect;
export type InsertAlexaraResearchLog = typeof alexaraResearchLog.$inferInsert;

// CRYPTARA Surveillance Log Table - Track crypto surveillance activity
export const cryptaraSurveillanceLog = pgTable("cryptara_surveillance_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chain: varchar("chain", { length: 50 }).notNull(),
  activityType: varchar("activity_type", { length: 50 }).notNull(), // surveillance, simulation, prediction
  patternsDetected: integer("patterns_detected").notNull().default(0),
  predictionsGenerated: integer("predictions_generated").notNull().default(0),
  sentimentScore: integer("sentiment_score"), // -100 to 100
  riskLevel: varchar("risk_level", { length: 20 }), // low, medium, high, critical
  simulationIterations: integer("simulation_iterations"),
  learnings: text("learnings").array(),
  processingTimeMs: integer("processing_time_ms"),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_cryptara_log_chain").on(table.chain),
  index("idx_cryptara_log_activity").on(table.activityType),
  index("idx_cryptara_log_created").on(table.createdAt),
]);

export type CryptaraSurveillanceLog = typeof cryptaraSurveillanceLog.$inferSelect;
export type InsertCryptaraSurveillanceLog = typeof cryptaraSurveillanceLog.$inferInsert;

// Crawler Activity Log Table - Track crawler runs (ALEXARA and CRYPTARA)
export const crawlerActivityLog = pgTable("crawler_activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crawlerType: varchar("crawler_type", { length: 20 }).notNull(), // 'alexara' or 'cryptara'
  triggeredBy: varchar("triggered_by", { length: 50 }).notNull(), // '4ji-genie', 'schedule', 'user', 'faucet'
  sourcesProcessed: integer("sources_processed").notNull().default(0),
  itemsCrawled: integer("items_crawled").notNull().default(0),
  updatesApplied: integer("updates_applied").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  durationMs: integer("duration_ms"),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  status: varchar("status", { length: 20 }).notNull().default('running'), // running, completed, failed
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_crawler_activity_type").on(table.crawlerType),
  index("idx_crawler_activity_triggered").on(table.triggeredBy),
  index("idx_crawler_activity_started").on(table.startedAt),
]);

export type CrawlerActivityLog = typeof crawlerActivityLog.$inferSelect;
export type InsertCrawlerActivityLog = typeof crawlerActivityLog.$inferInsert;