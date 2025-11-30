// Database Storage - Platform-agnostic database operations
import {
  users,
  badgeLookups,
  complaints,
  lawsuitFilings,
  contactMessages,
  jurisdictions,
  authAccounts,
  adminAccessLogs,
  publicEvidence,
  petitions,
  complaintPatterns,
  legalStrategies,
  casePatterns,
  documentFormats,
  subAgentCapabilities,
  subAgentLearningPatterns,
  subAgentPerformanceMetrics,
  subAgentSelfImprovementActions,
  subAgentSearchCycles,
  departmentUrls,
  officerProfiles,
  type User,
  type UpsertUser,
  type BadgeLookup,
  type InsertBadgeLookup,
  type Complaint,
  type InsertComplaint,
  type LawsuitFiling,
  type InsertLawsuitFiling,
  type ContactMessage,
  type InsertContactMessage,
  type Jurisdiction,
  type InsertJurisdiction,
  type AuthAccount,
  type InsertAuthAccount,
  type AdminAccessLog,
  type InsertAdminAccessLog,
  type ComplaintPattern,
  type InsertComplaintPattern,
  type LegalStrategy,
  type InsertLegalStrategy,
  type CasePattern,
  type InsertCasePattern,
  type DocumentFormat,
  type InsertDocumentFormat,
  type SubAgentCapability,
  type InsertSubAgentCapability,
  type SubAgentLearningPattern,
  type InsertSubAgentLearningPattern,
  type SubAgentPerformanceMetric,
  type InsertSubAgentPerformanceMetric,
  type SubAgentSelfImprovementAction,
  type InsertSubAgentSelfImprovementAction,
  type SubAgentSearchCycle,
  type InsertSubAgentSearchCycle,
  type DepartmentUrl,
  type InsertDepartmentUrl,
  type OfficerProfile,
  type InsertOfficerProfile,
  deviceFingerprints,
  type DeviceFingerprint,
  type InsertDeviceFingerprint,
} from "@shared/schema";

// Define types for PublicEvidence
type PublicEvidence = {
  id: string;
  userId: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  officerName: string | null;
  department: string | null;
  location: string | null;
  incidentDate: Date | null;
  description: string | null;
  uploadedAt: Date;
};

type InsertPublicEvidence = {
  userId: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  officerName?: string | null;
  department?: string | null;
  location?: string | null;
  incidentDate?: Date | null;
  description?: string | null;
};
import { db } from "./db";
import { eq, desc, and, gte, sql } from "drizzle-orm";

// Validate database connection on module load
if (!db) {
  throw new Error("Database connection not initialized");
}

// Interface for storage operations
export interface IStorage {
  // User operations (required for Authentication)
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserStripeCustomerId(userId: string, stripeCustomerId: string): Promise<User>;
  updateUserAccess(userId: string, paymentId: string, amountPaid: number): Promise<User>;
  updateUserLastLogin(userId: string): Promise<User>;

  // Auth account operations (Username/Password Auth)
  createAuthAccount(authAccount: InsertAuthAccount): Promise<AuthAccount>;
  getAuthAccountByUsername(username: string): Promise<AuthAccount | undefined>;
  getAuthAccountByUserId(userId: string): Promise<AuthAccount | undefined>;
  updateAuthAccountLastLogin(id: string): Promise<AuthAccount>;

  // Admin access log operations (Security Audit)
  createAdminAccessLog(log: InsertAdminAccessLog): Promise<AdminAccessLog>;
  getAdminAccessLogs(limit?: number): Promise<AdminAccessLog[]>;

  // Badge lookup operations
  createBadgeLookup(lookup: InsertBadgeLookup): Promise<BadgeLookup>;
  getBadgeLookup(id: string): Promise<BadgeLookup | undefined>;
  getUserBadgeLookups(userId: string): Promise<BadgeLookup[]>;

  // Complaint operations
  createComplaint(complaint: InsertComplaint): Promise<Complaint>;
  getComplaint(id: string): Promise<Complaint | undefined>;
  getUserComplaints(userId: string): Promise<Complaint[]>;
  updateComplaintStatus(id: string, status: string): Promise<Complaint>;
  updateComplaintPayment(id: string, paymentId: string, paymentStatus: string, amountPaid: number): Promise<Complaint>;
  updateComplaintStatusAndVenue(id: string, status: string, submissionVenue: string, submissionEmail: string, submissionAddress: string): Promise<Complaint>;

  // Lawsuit filing operations
  createLawsuitFiling(filing: InsertLawsuitFiling): Promise<LawsuitFiling>;
  getLawsuitFiling(id: string): Promise<LawsuitFiling | undefined>;
  getUserLawsuitFilings(userId: string): Promise<LawsuitFiling[]>;
  updateLawsuitDocument(id: string, document: string, statutes: string[]): Promise<LawsuitFiling>;
  updateLawsuitPayment(id: string, paymentId: string, paymentStatus: string, amountPaid: number): Promise<LawsuitFiling>;
  updateLawsuitStatus(id: string, status: string): Promise<LawsuitFiling>;
  updateLawsuitFilingInfo(id: string, filingFee: number, eFilingPortalUrl: string, eFilingPortalName: string, filingInstructions: string, clerkOfCourtAddress: string): Promise<LawsuitFiling>;
  updateLawsuitTortNotice(id: string, tortNoticeRequired: boolean, tortNoticeSent: boolean, tortNoticeAgency: string | null, tortNoticeDocument: string | null): Promise<LawsuitFiling>;
  updateLawsuitPrecedents(id: string, precedents: string[]): Promise<LawsuitFiling>;

  // Contact message operations
  createContactMessage(message: InsertContactMessage): Promise<ContactMessage>;
  getContactMessage(id: string): Promise<ContactMessage | undefined>;
  updateContactMessageStatus(id: string, status: string, emailSent: boolean): Promise<ContactMessage>;

  // Jurisdiction operations
  createJurisdiction(jurisdiction: InsertJurisdiction): Promise<Jurisdiction>;
  findJurisdictionByLocation(city: string | null, county: string | null, state: string, agencyType: 'police' | 'sheriff' | 'trooper'): Promise<Jurisdiction | undefined>;
  findVerifiedJurisdiction(city: string | null, county: string | null, state: string, agencyType: 'police' | 'sheriff' | 'trooper'): Promise<Jurisdiction | undefined>;
  getAllJurisdictions(): Promise<Jurisdiction[]>;

  // Public evidence operations
  getPublicEvidence(fileType?: string | null): Promise<PublicEvidence[]>;
  sharePublicEvidence(data: InsertPublicEvidence): Promise<PublicEvidence>;

  // AI Learning System operations
  storeComplaintPattern(pattern: InsertComplaintPattern): Promise<ComplaintPattern | undefined>;
  storeLegalStrategy(strategy: InsertLegalStrategy): Promise<LegalStrategy | undefined>;
  storeCasePattern(pattern: InsertCasePattern): Promise<CasePattern | undefined>;
  storeDocumentFormat(format: InsertDocumentFormat): Promise<DocumentFormat | undefined>;
  getCasePatterns(): Promise<CasePattern[]>;
  getLegalStrategies(): Promise<LegalStrategy[]>;
  getDocumentFormats(): Promise<DocumentFormat[]>;

  // Sub-Agent Knowledge System operations
  // Capability Ledger operations
  upsertCapability(capability: InsertSubAgentCapability): Promise<SubAgentCapability>;
  getCapability(capabilityName: string): Promise<SubAgentCapability | undefined>;
  getAllCapabilities(): Promise<SubAgentCapability[]>;
  updateCapabilitySuccess(capabilityName: string, executionTimeMs: number): Promise<SubAgentCapability>;
  updateCapabilityFailure(capabilityName: string): Promise<SubAgentCapability>;
  
  // Learning Patterns operations
  storePattern(pattern: InsertSubAgentLearningPattern): Promise<SubAgentLearningPattern>;
  getPatternsByType(patternType: string): Promise<SubAgentLearningPattern[]>;
  getAllPatterns(): Promise<SubAgentLearningPattern[]>;
  incrementPatternObservation(patternId: string): Promise<SubAgentLearningPattern>;
  
  // Performance Metrics operations
  recordMetric(metric: InsertSubAgentPerformanceMetric): Promise<SubAgentPerformanceMetric>;
  getMetricsByName(metricName: string, limit?: number): Promise<SubAgentPerformanceMetric[]>;
  getMetricsByCapability(capabilityName: string, limit?: number): Promise<SubAgentPerformanceMetric[]>;
  getAllMetrics(limit?: number): Promise<SubAgentPerformanceMetric[]>;
  
  // Self-Improvement Actions operations
  recordImprovementAction(action: InsertSubAgentSelfImprovementAction): Promise<SubAgentSelfImprovementAction>;
  getImprovementActions(limit?: number): Promise<SubAgentSelfImprovementAction[]>;
  rollbackImprovementAction(actionId: string, rollbackReason: string): Promise<SubAgentSelfImprovementAction>;
  getActionsByImpact(impact: string): Promise<SubAgentSelfImprovementAction[]>;

  // Search Cycle operations (Autonomous Data Collection)
  getSearchCycle(): Promise<SubAgentSearchCycle | undefined>;
  upsertSearchCycle(cycle: Partial<SubAgentSearchCycle>): Promise<SubAgentSearchCycle>;
  updateSearchCycleState(state: string, isPaused: boolean, pauseContext?: any): Promise<SubAgentSearchCycle>;
  updateSearchCycleProgress(currentCycle: string, lastCycleStart: Date, nextCycleStart: Date, searchCount: number): Promise<SubAgentSearchCycle>;
  
  // Department URL operations
  createDepartmentUrl(url: InsertDepartmentUrl): Promise<DepartmentUrl>;
  getDepartmentUrlsByState(state: string): Promise<DepartmentUrl[]>;
  getDepartmentUrlsByType(departmentType: string): Promise<DepartmentUrl[]>;
  getAllDepartmentUrls(limit?: number): Promise<DepartmentUrl[]>;
  updateDepartmentUrlVerification(id: string, verified: boolean): Promise<DepartmentUrl>;

  // Officer Profile operations
  upsertOfficerProfile(profile: InsertOfficerProfile): Promise<OfficerProfile>;
  getOfficerProfileByName(name: string, department?: string): Promise<OfficerProfile | undefined>;
  getAllOfficerProfiles(limit?: number): Promise<OfficerProfile[]>;
  searchOfficerProfiles(query: { name?: string; badgeNumber?: string; department?: string; location?: string }): Promise<OfficerProfile[]>;

  // Device Fingerprint operations (for sample consultation tracking)
  createDeviceFingerprint(fingerprint: InsertDeviceFingerprint): Promise<DeviceFingerprint>;
  getDeviceFingerprint(deviceId: string): Promise<DeviceFingerprint | undefined>;
  hasDeviceUsedSample(deviceId: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  // Helper to generate user returning columns
  private getUserReturningColumns() {
    return {
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      profileImageUrl: users.profileImageUrl,
      stripeCustomerId: users.stripeCustomerId,
      hasPaidForAccess: users.hasPaidForAccess,
      accessPaymentId: users.accessPaymentId,
      accessPaidAt: users.accessPaidAt,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    };
  }

  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db
      .select(this.getUserReturningColumns())
      .from(users)
      .where(eq(users.id, id));
    return user as User;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db
      .select(this.getUserReturningColumns())
      .from(users)
      .where(eq(users.email, email));
    return user as User;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // Use raw SQL to avoid Drizzle column mapping issues
    const query = sql`
      INSERT INTO users (id, email, first_name, last_name, profile_image_url, created_at, updated_at)
      VALUES (${userData.id}, ${userData.email}, ${userData.firstName}, ${userData.lastName}, ${userData.profileImageUrl}, ${new Date()}, ${new Date()})
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        profile_image_url = EXCLUDED.profile_image_url,
        updated_at = ${new Date()}
      RETURNING 
        id,
        email,
        first_name as "firstName",
        last_name as "lastName",
        profile_image_url as "profileImageUrl",
        stripe_customer_id as "stripeCustomerId",
        has_paid_for_access as "hasPaidForAccess",
        access_payment_id as "accessPaymentId",
        access_paid_at as "accessPaidAt",
        last_login_at as "lastLoginAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;
    
    const result = await db.execute(query);
    return result.rows[0] as User;
  }

  async updateUserStripeCustomerId(
    userId: string,
    stripeCustomerId: string
  ): Promise<User> {
    const [user] = await db
      .update(users)
      .set({
        stripeCustomerId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning(this.getUserReturningColumns());
    return user as User;
  }

  async updateUserAccess(
    userId: string,
    paymentId: string,
    amountPaid: number
  ): Promise<User> {
    const [user] = await db
      .update(users)
      .set({
        hasPaidForAccess: true,
        accessPaymentId: paymentId,
        accessPaidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning(this.getUserReturningColumns());
    return user as User;
  }

  async updateUserLastLogin(userId: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    if (!user) throw new Error(`User ${userId} not found`);
    return user;
  }

  // Auth account operations
  async createAuthAccount(authAccountData: InsertAuthAccount): Promise<AuthAccount> {
    const [authAccount] = await db
      .insert(authAccounts)
      .values(authAccountData)
      .returning();
    return authAccount;
  }

  async getAuthAccountByUsername(username: string): Promise<AuthAccount | undefined> {
    const [authAccount] = await db
      .select()
      .from(authAccounts)
      .where(eq(authAccounts.username, username));
    return authAccount;
  }

  async getAuthAccountByUserId(userId: string): Promise<AuthAccount | undefined> {
    const [authAccount] = await db
      .select()
      .from(authAccounts)
      .where(eq(authAccounts.userId, userId));
    return authAccount;
  }

  async updateAuthAccountLastLogin(id: string): Promise<AuthAccount> {
    const [authAccount] = await db
      .update(authAccounts)
      .set({
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(authAccounts.id, id))
      .returning();
    return authAccount;
  }

  // Admin access log operations
  async createAdminAccessLog(logData: InsertAdminAccessLog): Promise<AdminAccessLog> {
    const [log] = await db
      .insert(adminAccessLogs)
      .values(logData)
      .returning();
    return log;
  }

  async getAdminAccessLogs(limit: number = 100): Promise<AdminAccessLog[]> {
    return await db
      .select()
      .from(adminAccessLogs)
      .orderBy(desc(adminAccessLogs.accessedAt))
      .limit(limit);
  }

  // Badge lookup operations
  async createBadgeLookup(lookupData: InsertBadgeLookup): Promise<BadgeLookup> {
    const [lookup] = await db
      .insert(badgeLookups)
      .values(lookupData)
      .returning();
    return lookup;
  }

  async getBadgeLookup(id: string): Promise<BadgeLookup | undefined> {
    const [lookup] = await db
      .select()
      .from(badgeLookups)
      .where(eq(badgeLookups.id, id));
    return lookup;
  }

  async getUserBadgeLookups(userId: string): Promise<BadgeLookup[]> {
    return await db
      .select()
      .from(badgeLookups)
      .where(eq(badgeLookups.userId, userId))
      .orderBy(desc(badgeLookups.createdAt));
  }

  // Complaint operations
  async createComplaint(complaintData: InsertComplaint): Promise<Complaint> {
    const [complaint] = await db
      .insert(complaints)
      .values(complaintData as any)
      .returning();
    return complaint;
  }

  async getComplaint(id: string): Promise<Complaint | undefined> {
    const [complaint] = await db
      .select()
      .from(complaints)
      .where(eq(complaints.id, id));
    return complaint;
  }

  async getUserComplaints(userId: string): Promise<Complaint[]> {
    return await db
      .select()
      .from(complaints)
      .where(eq(complaints.userId, userId))
      .orderBy(desc(complaints.createdAt));
  }

  async updateComplaintStatus(id: string, status: string): Promise<Complaint> {
    const [complaint] = await db
      .update(complaints)
      .set({
        status,
        statusUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(complaints.id, id))
      .returning();
    return complaint;
  }

  async updateComplaintPayment(id: string, paymentId: string, paymentStatus: string, amountPaid: number): Promise<Complaint> {
    const [complaint] = await db
      .update(complaints)
      .set({
        paymentId,
        paymentStatus,
        amountPaid,
        updatedAt: new Date(),
      })
      .where(eq(complaints.id, id))
      .returning();
    return complaint;
  }

  async updateComplaintStatusAndVenue(
    id: string,
    status: string,
    submissionVenue: string,
    submissionEmail: string,
    submissionAddress: string
  ): Promise<Complaint> {
    const [complaint] = await db
      .update(complaints)
      .set({
        status,
        submissionVenue,
        submissionEmail,
        submissionAddress,
        statusUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(complaints.id, id))
      .returning();
    return complaint;
  }

  // Lawsuit filing operations
  async createLawsuitFiling(filingData: InsertLawsuitFiling): Promise<LawsuitFiling> {
    const [filing] = await db
      .insert(lawsuitFilings)
      .values(filingData as any)
      .returning();
    return filing;
  }

  async getLawsuitFiling(id: string): Promise<LawsuitFiling | undefined> {
    const [filing] = await db
      .select()
      .from(lawsuitFilings)
      .where(eq(lawsuitFilings.id, id));
    return filing;
  }

  async getUserLawsuitFilings(userId: string): Promise<LawsuitFiling[]> {
    return await db
      .select()
      .from(lawsuitFilings)
      .where(eq(lawsuitFilings.userId, userId))
      .orderBy(desc(lawsuitFilings.createdAt));
  }

  async updateLawsuitDocument(id: string, document: string, statutes: string[]): Promise<LawsuitFiling> {
    const [filing] = await db
      .update(lawsuitFilings)
      .set({
        generatedDocument: document,
        stateStatutes: statutes,
        updatedAt: new Date(),
      })
      .where(eq(lawsuitFilings.id, id))
      .returning();
    return filing;
  }

  async updateLawsuitPayment(id: string, paymentId: string, paymentStatus: string, amountPaid: number): Promise<LawsuitFiling> {
    const [filing] = await db
      .update(lawsuitFilings)
      .set({
        paymentId,
        paymentStatus,
        amountPaid,
        updatedAt: new Date(),
      })
      .where(eq(lawsuitFilings.id, id))
      .returning();
    return filing;
  }

  async updateLawsuitStatus(id: string, status: string): Promise<LawsuitFiling> {
    const [filing] = await db
      .update(lawsuitFilings)
      .set({
        status,
        statusUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(lawsuitFilings.id, id))
      .returning();
    return filing;
  }

  async updateLawsuitFilingInfo(
    id: string,
    filingFee: number,
    eFilingPortalUrl: string,
    eFilingPortalName: string,
    filingInstructions: string,
    clerkOfCourtAddress: string
  ): Promise<LawsuitFiling> {
    const [filing] = await db
      .update(lawsuitFilings)
      .set({
        filingFee,
        eFilingPortalUrl,
        eFilingPortalName,
        filingInstructions,
        clerkOfCourtAddress,
        updatedAt: new Date(),
      })
      .where(eq(lawsuitFilings.id, id))
      .returning();
    return filing;
  }

  async updateLawsuitTortNotice(
    id: string,
    tortNoticeRequired: boolean,
    tortNoticeSent: boolean,
    tortNoticeAgency: string | null,
    tortNoticeDocument: string | null
  ): Promise<LawsuitFiling> {
    const [filing] = await db
      .update(lawsuitFilings)
      .set({
        tortNoticeRequired,
        tortNoticeSent,
        tortNoticeAgency,
        tortNoticeDocument,
        tortNoticeSentAt: tortNoticeSent ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(lawsuitFilings.id, id))
      .returning();
    return filing;
  }

  async updateLawsuitPrecedents(
    id: string,
    precedents: string[]
  ): Promise<LawsuitFiling> {
    const [filing] = await db
      .update(lawsuitFilings)
      .set({
        relevantPrecedents: precedents,
        updatedAt: new Date(),
      })
      .where(eq(lawsuitFilings.id, id))
      .returning();
    return filing;
  }

  // Contact message operations
  async createContactMessage(messageData: InsertContactMessage): Promise<ContactMessage> {
    const [message] = await db
      .insert(contactMessages)
      .values(messageData)
      .returning();
    return message;
  }

  async getContactMessage(id: string): Promise<ContactMessage | undefined> {
    const [message] = await db
      .select()
      .from(contactMessages)
      .where(eq(contactMessages.id, id));
    return message;
  }

  async updateContactMessageStatus(id: string, status: string, emailSent: boolean): Promise<ContactMessage> {
    const [message] = await db
      .update(contactMessages)
      .set({
        status,
        emailSent,
      })
      .where(eq(contactMessages.id, id))
      .returning();
    return message;
  }

  // Jurisdiction operations
  async createJurisdiction(jurisdictionData: InsertJurisdiction): Promise<Jurisdiction> {
    const [jurisdiction] = await db
      .insert(jurisdictions)
      .values(jurisdictionData)
      .returning();
    return jurisdiction;
  }

  async findJurisdictionByLocation(
    city: string | null,
    county: string | null,
    state: string,
    agencyType: 'police' | 'sheriff' | 'trooper'
  ): Promise<Jurisdiction | undefined> {
    // Build conditions based on available location data
    // Priority: city match > county match for appropriate agency types
    const conditions = [
      eq(jurisdictions.state, state.toUpperCase()),
      eq(jurisdictions.agencyType, agencyType),
    ];

    // For city-level agencies (police), prioritize city match
    // For county-level agencies (sheriff), prioritize county match
    if (city && agencyType === 'police') {
      const normalizedCity = city.trim().toLowerCase();
      conditions.push(sql`LOWER(${jurisdictions.city}) = ${normalizedCity}`);
    } else if (county && agencyType === 'sheriff') {
      const normalizedCounty = county.trim().toLowerCase();
      conditions.push(sql`LOWER(${jurisdictions.county}) = ${normalizedCounty}`);
    } else if (city) {
      const normalizedCity = city.trim().toLowerCase();
      conditions.push(sql`LOWER(${jurisdictions.city}) = ${normalizedCity}`);
    } else if (county) {
      const normalizedCounty = county.trim().toLowerCase();
      conditions.push(sql`LOWER(${jurisdictions.county}) = ${normalizedCounty}`);
    }

    const results = await db
      .select()
      .from(jurisdictions)
      .where(and(...conditions))
      .orderBy(desc(jurisdictions.verified), desc(jurisdictions.confidence));

    return results[0];
  }

  async findVerifiedJurisdiction(
    city: string | null,
    county: string | null,
    state: string,
    agencyType: 'police' | 'sheriff' | 'trooper'
  ): Promise<Jurisdiction | undefined> {
    // Build conditions with verified requirement
    const conditions = [
      eq(jurisdictions.state, state.toUpperCase()),
      eq(jurisdictions.agencyType, agencyType),
      eq(jurisdictions.verified, true),
    ];

    // Match based on agency type and available data
    if (city && agencyType === 'police') {
      const normalizedCity = city.trim().toLowerCase();
      conditions.push(sql`LOWER(${jurisdictions.city}) = ${normalizedCity}`);
    } else if (county && agencyType === 'sheriff') {
      const normalizedCounty = county.trim().toLowerCase();
      conditions.push(sql`LOWER(${jurisdictions.county}) = ${normalizedCounty}`);
    } else if (city) {
      const normalizedCity = city.trim().toLowerCase();
      conditions.push(sql`LOWER(${jurisdictions.city}) = ${normalizedCity}`);
    } else if (county) {
      const normalizedCounty = county.trim().toLowerCase();
      conditions.push(sql`LOWER(${jurisdictions.county}) = ${normalizedCounty}`);
    }

    const results = await db
      .select()
      .from(jurisdictions)
      .where(and(...conditions))
      .orderBy(desc(jurisdictions.confidence));

    return results[0];
  }

  async getAllJurisdictions(): Promise<Jurisdiction[]> {
    return await db
      .select()
      .from(jurisdictions)
      .orderBy(jurisdictions.state, jurisdictions.city);
  }

  // ============================================
  // PUBLIC EVIDENCE HUB METHODS
  // ============================================

  async getPublicEvidence(fileType?: string | null): Promise<PublicEvidence[]> {
    try {
      const query = db.select({
        id: publicEvidence.id,
        userId: publicEvidence.userId,
        fileName: publicEvidence.fileName,
        fileType: publicEvidence.fileType,
        fileUrl: publicEvidence.fileUrl,
        officerName: publicEvidence.officerName,
        department: publicEvidence.department,
        location: publicEvidence.location,
        incidentDate: publicEvidence.incidentDate,
        description: publicEvidence.description,
        uploadedAt: publicEvidence.uploadedAt,
      })
      .from(publicEvidence)
      .orderBy(desc(publicEvidence.uploadedAt));

      if (fileType) {
        // Use LIKE for partial matching if fileType is intended to be a prefix
        return await query.where(sql`${publicEvidence.fileType} LIKE ${fileType}%`);
      }

      return await query;
    } catch (error) {
      console.error("Error fetching public evidence:", error);
      return [];
    }
  }

  async sharePublicEvidence(data: InsertPublicEvidence): Promise<PublicEvidence> {
    const [evidence] = await db.insert(publicEvidence).values(data).returning();
    return evidence;
  }

  async updatePublicEvidence(id: string, data: Partial<InsertPublicEvidence>): Promise<PublicEvidence | undefined> {
    const [updated] = await db.update(publicEvidence)
      .set(data)
      .where(eq(publicEvidence.id, id))
      .returning();
    return updated;
  }

  async deletePublicEvidence(id: string): Promise<void> {
    await db.delete(publicEvidence).where(eq(publicEvidence.id, id));
  }

  async bulkDeletePublicEvidence(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.delete(publicEvidence).where(sql`${publicEvidence.id} = ANY(${ids})`);
  }

  // ============================================
  // PETITION METHODS
  // ============================================

  async getPetition(id: string) {
    return await db.query.petitions.findFirst({
      where: eq(petitions.id, id),
    });
  }

  async getUserPetitions(userId: string) {
    return await db.query.petitions.findMany({
      where: eq(petitions.userId, userId),
      orderBy: (petitions, { desc }) => [desc(petitions.createdAt)],
    });
  }

  async updatePetitionPayment(
    petitionId: string,
    paymentId: string
  ) {
    return await db
      .update(petitions)
      .set({
        paymentId,
        updatedAt: new Date(),
      })
      .where(eq(petitions.id, petitionId));
  }

  // ============================================
  // AI LEARNING SYSTEM METHODS
  // ============================================

  async storeComplaintPattern(pattern: InsertComplaintPattern): Promise<ComplaintPattern | undefined> {
    try {
      const [stored] = await db.insert(complaintPatterns).values(pattern).returning();
      return stored;
    } catch (error) {
      console.error('Error storing complaint pattern:', error);
      return undefined;
    }
  }

  async storeLegalStrategy(strategy: InsertLegalStrategy): Promise<LegalStrategy | undefined> {
    try {
      const [stored] = await db.insert(legalStrategies).values(strategy).returning();
      return stored;
    } catch (error) {
      console.error('Error storing legal strategy:', error);
      return undefined;
    }
  }

  async storeCasePattern(pattern: InsertCasePattern): Promise<CasePattern | undefined> {
    try {
      const [stored] = await db.insert(casePatterns).values(pattern).returning();
      return stored;
    } catch (error) {
      console.error('Error storing case pattern:', error);
      return undefined;
    }
  }

  async storeDocumentFormat(format: InsertDocumentFormat): Promise<DocumentFormat | undefined> {
    try {
      const [stored] = await db.insert(documentFormats).values(format).returning();
      return stored;
    } catch (error) {
      console.error('Error storing document format:', error);
      return undefined;
    }
  }

  async getCasePatterns(): Promise<CasePattern[]> {
    try {
      return await db.select().from(casePatterns).orderBy(desc(casePatterns.createdAt));
    } catch (error) {
      console.error('Error fetching case patterns:', error);
      return [];
    }
  }

  async getLegalStrategies(): Promise<LegalStrategy[]> {
    try {
      return await db.select().from(legalStrategies).orderBy(desc(legalStrategies.successRate));
    } catch (error) {
      console.error('Error fetching legal strategies:', error);
      return [];
    }
  }

  async getDocumentFormats(): Promise<DocumentFormat[]> {
    try {
      return await db.select().from(documentFormats).orderBy(desc(documentFormats.successRate));
    } catch (error) {
      console.error('Error fetching document formats:', error);
      return [];
    }
  }

  // ============================================
  // SUB-AGENT KNOWLEDGE SYSTEM IMPLEMENTATIONS
  // ============================================

  // Capability Ledger operations
  async upsertCapability(capabilityData: InsertSubAgentCapability): Promise<SubAgentCapability> {
    const [capability] = await db
      .insert(subAgentCapabilities)
      .values(capabilityData)
      .onConflictDoUpdate({
        target: subAgentCapabilities.capabilityName,
        set: {
          description: capabilityData.description,
          limitations: capabilityData.limitations,
          improvements: capabilityData.improvements,
          metadata: capabilityData.metadata,
          updatedAt: new Date(),
        },
      })
      .returning();
    return capability;
  }

  async getCapability(capabilityName: string): Promise<SubAgentCapability | undefined> {
    const [capability] = await db
      .select()
      .from(subAgentCapabilities)
      .where(eq(subAgentCapabilities.capabilityName, capabilityName));
    return capability;
  }

  async getAllCapabilities(): Promise<SubAgentCapability[]> {
    return await db
      .select()
      .from(subAgentCapabilities)
      .orderBy(desc(subAgentCapabilities.lastUsed));
  }

  async updateCapabilitySuccess(capabilityName: string, executionTimeMs: number): Promise<SubAgentCapability> {
    const existing = await this.getCapability(capabilityName);
    
    if (!existing) {
      throw new Error(`Capability ${capabilityName} not found`);
    }

    const newSuccessCount = existing.successCount + 1;
    const totalExecutions = newSuccessCount + existing.failCount;
    const newAvgTime = existing.avgExecutionTimeMs
      ? Math.round((existing.avgExecutionTimeMs * (totalExecutions - 1) + executionTimeMs) / totalExecutions)
      : executionTimeMs;

    const [updated] = await db
      .update(subAgentCapabilities)
      .set({
        successCount: newSuccessCount,
        avgExecutionTimeMs: newAvgTime,
        lastUsed: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(subAgentCapabilities.capabilityName, capabilityName))
      .returning();
    
    return updated;
  }

  async updateCapabilityFailure(capabilityName: string): Promise<SubAgentCapability> {
    const existing = await this.getCapability(capabilityName);
    
    if (!existing) {
      throw new Error(`Capability ${capabilityName} not found`);
    }

    const [updated] = await db
      .update(subAgentCapabilities)
      .set({
        failCount: existing.failCount + 1,
        lastUsed: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(subAgentCapabilities.capabilityName, capabilityName))
      .returning();
    
    return updated;
  }

  // Learning Patterns operations
  async storePattern(patternData: InsertSubAgentLearningPattern): Promise<SubAgentLearningPattern> {
    const [pattern] = await db
      .insert(subAgentLearningPatterns)
      .values(patternData)
      .returning();
    return pattern;
  }

  async getPatternsByType(patternType: string): Promise<SubAgentLearningPattern[]> {
    return await db
      .select()
      .from(subAgentLearningPatterns)
      .where(eq(subAgentLearningPatterns.patternType, patternType))
      .orderBy(desc(subAgentLearningPatterns.confidenceScore), desc(subAgentLearningPatterns.timesObserved));
  }

  async getAllPatterns(): Promise<SubAgentLearningPattern[]> {
    return await db
      .select()
      .from(subAgentLearningPatterns)
      .orderBy(desc(subAgentLearningPatterns.lastObserved));
  }

  async incrementPatternObservation(patternId: string): Promise<SubAgentLearningPattern> {
    const [existing] = await db
      .select()
      .from(subAgentLearningPatterns)
      .where(eq(subAgentLearningPatterns.id, patternId));
    
    if (!existing) {
      throw new Error(`Pattern ${patternId} not found`);
    }

    const newConfidence = Math.min(100, existing.confidenceScore + 2);

    const [updated] = await db
      .update(subAgentLearningPatterns)
      .set({
        timesObserved: existing.timesObserved + 1,
        confidenceScore: newConfidence,
        lastObserved: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(subAgentLearningPatterns.id, patternId))
      .returning();
    
    return updated;
  }

  // Performance Metrics operations
  async recordMetric(metricData: InsertSubAgentPerformanceMetric): Promise<SubAgentPerformanceMetric> {
    const [metric] = await db
      .insert(subAgentPerformanceMetrics)
      .values(metricData)
      .returning();
    return metric;
  }

  async getMetricsByName(metricName: string, limit: number = 100): Promise<SubAgentPerformanceMetric[]> {
    return await db
      .select()
      .from(subAgentPerformanceMetrics)
      .where(eq(subAgentPerformanceMetrics.metricName, metricName))
      .orderBy(desc(subAgentPerformanceMetrics.measuredAt))
      .limit(limit);
  }

  async getMetricsByCapability(capabilityName: string, limit: number = 100): Promise<SubAgentPerformanceMetric[]> {
    return await db
      .select()
      .from(subAgentPerformanceMetrics)
      .where(eq(subAgentPerformanceMetrics.capabilityName, capabilityName))
      .orderBy(desc(subAgentPerformanceMetrics.measuredAt))
      .limit(limit);
  }

  async getAllMetrics(limit: number = 100): Promise<SubAgentPerformanceMetric[]> {
    return await db
      .select()
      .from(subAgentPerformanceMetrics)
      .orderBy(desc(subAgentPerformanceMetrics.measuredAt))
      .limit(limit);
  }

  // Self-Improvement Actions operations
  async recordImprovementAction(actionData: InsertSubAgentSelfImprovementAction): Promise<SubAgentSelfImprovementAction> {
    const [action] = await db
      .insert(subAgentSelfImprovementActions)
      .values(actionData)
      .returning();
    return action;
  }

  async getImprovementActions(limit: number = 100): Promise<SubAgentSelfImprovementAction[]> {
    return await db
      .select()
      .from(subAgentSelfImprovementActions)
      .orderBy(desc(subAgentSelfImprovementActions.implementedAt))
      .limit(limit);
  }

  async rollbackImprovementAction(actionId: string, rollbackReason: string): Promise<SubAgentSelfImprovementAction> {
    const [updated] = await db
      .update(subAgentSelfImprovementActions)
      .set({
        rolledBack: true,
        rollbackReason,
        impact: 'negative',
        updatedAt: new Date(),
      })
      .where(eq(subAgentSelfImprovementActions.id, actionId))
      .returning();
    
    if (!updated) {
      throw new Error(`Improvement action ${actionId} not found`);
    }
    
    return updated;
  }

  async getActionsByImpact(impact: string): Promise<SubAgentSelfImprovementAction[]> {
    return await db
      .select()
      .from(subAgentSelfImprovementActions)
      .where(eq(subAgentSelfImprovementActions.impact, impact))
      .orderBy(desc(subAgentSelfImprovementActions.implementedAt));
  }

  // Search Cycle operations (Autonomous Data Collection)
  async getSearchCycle(): Promise<SubAgentSearchCycle | undefined> {
    const [cycle] = await db
      .select()
      .from(subAgentSearchCycles)
      .limit(1);
    return cycle;
  }

  async upsertSearchCycle(cycleData: Partial<SubAgentSearchCycle>): Promise<SubAgentSearchCycle> {
    const existing = await this.getSearchCycle();
    
    if (existing) {
      const [updated] = await db
        .update(subAgentSearchCycles)
        .set({
          ...cycleData,
          updatedAt: new Date(),
        })
        .where(eq(subAgentSearchCycles.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(subAgentSearchCycles)
        .values({
          currentCycle: cycleData.currentCycle || 'officer',
          lastCycleStart: cycleData.lastCycleStart || null,
          nextCycleStart: cycleData.nextCycleStart || null,
          searchState: cycleData.searchState || 'not_running',
          isPaused: cycleData.isPaused || false,
          pauseContext: cycleData.pauseContext || null,
          cycleCount: cycleData.cycleCount || 0,
          lastOfficerSearchCount: cycleData.lastOfficerSearchCount || null,
          lastDepartmentSearchCount: cycleData.lastDepartmentSearchCount || null,
          metadata: cycleData.metadata || null,
        } as InsertSubAgentSearchCycle)
        .returning();
      return created;
    }
  }

  async updateSearchCycleState(state: string, isPaused: boolean, pauseContext?: any): Promise<SubAgentSearchCycle> {
    const existing = await this.getSearchCycle();
    if (!existing) {
      throw new Error('Search cycle not initialized');
    }

    const [updated] = await db
      .update(subAgentSearchCycles)
      .set({
        searchState: state,
        isPaused,
        pauseContext: pauseContext || null,
        updatedAt: new Date(),
      })
      .where(eq(subAgentSearchCycles.id, existing.id))
      .returning();
    
    return updated;
  }

  async updateSearchCycleProgress(
    currentCycle: string,
    lastCycleStart: Date,
    nextCycleStart: Date,
    searchCount: number
  ): Promise<SubAgentSearchCycle> {
    const existing = await this.getSearchCycle();
    if (!existing) {
      throw new Error('Search cycle not initialized');
    }

    const updateData: any = {
      currentCycle,
      lastCycleStart,
      nextCycleStart,
      cycleCount: existing.cycleCount + 1,
      searchState: 'not_running',
      isPaused: false,
      pauseContext: null,
      updatedAt: new Date(),
    };

    if (currentCycle === 'department') {
      updateData.lastDepartmentSearchCount = searchCount;
    } else {
      updateData.lastOfficerSearchCount = searchCount;
    }

    const [updated] = await db
      .update(subAgentSearchCycles)
      .set(updateData)
      .where(eq(subAgentSearchCycles.id, existing.id))
      .returning();
    
    return updated;
  }

  // Department URL operations
  async createDepartmentUrl(urlData: InsertDepartmentUrl): Promise<DepartmentUrl> {
    const [created] = await db
      .insert(departmentUrls)
      .values(urlData)
      .returning();
    return created;
  }

  async getDepartmentUrlsByState(state: string): Promise<DepartmentUrl[]> {
    return await db
      .select()
      .from(departmentUrls)
      .where(eq(departmentUrls.state, state))
      .orderBy(desc(departmentUrls.discoveredAt));
  }

  async getDepartmentUrlsByType(departmentType: string): Promise<DepartmentUrl[]> {
    return await db
      .select()
      .from(departmentUrls)
      .where(eq(departmentUrls.departmentType, departmentType))
      .orderBy(desc(departmentUrls.discoveredAt));
  }

  async getAllDepartmentUrls(limit: number = 100): Promise<DepartmentUrl[]> {
    return await db
      .select()
      .from(departmentUrls)
      .orderBy(desc(departmentUrls.discoveredAt))
      .limit(limit);
  }

  async updateDepartmentUrlVerification(id: string, verified: boolean): Promise<DepartmentUrl> {
    const [updated] = await db
      .update(departmentUrls)
      .set({
        verified,
        lastVerified: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(departmentUrls.id, id))
      .returning();
    
    if (!updated) {
      throw new Error(`Department URL ${id} not found`);
    }
    
    return updated;
  }

  // Officer Profile operations
  async upsertOfficerProfile(profile: InsertOfficerProfile): Promise<OfficerProfile> {
    const [upserted] = await db
      .insert(officerProfiles)
      .values(profile)
      .onConflictDoUpdate({
        target: [officerProfiles.officerName, officerProfiles.department],
        set: {
          ...profile,
          lastUpdated: new Date(),
        },
      })
      .returning();
    
    return upserted;
  }

  async getOfficerProfileByName(name: string, department?: string): Promise<OfficerProfile | undefined> {
    const conditions = department
      ? and(eq(officerProfiles.officerName, name), eq(officerProfiles.department, department))
      : eq(officerProfiles.officerName, name);

    const [profile] = await db
      .select()
      .from(officerProfiles)
      .where(conditions)
      .limit(1);
    
    return profile;
  }

  async getAllOfficerProfiles(limit: number = 100): Promise<OfficerProfile[]> {
    return await db
      .select()
      .from(officerProfiles)
      .orderBy(desc(officerProfiles.lastUpdated))
      .limit(limit);
  }

  async searchOfficerProfiles(query: {
    name?: string;
    badgeNumber?: string;
    department?: string;
    location?: string;
  }): Promise<OfficerProfile[]> {
    const conditions: any[] = [];

    if (query.name) {
      conditions.push(sql`${officerProfiles.officerName} ILIKE ${`%${query.name}%`}`);
    }
    if (query.badgeNumber) {
      conditions.push(eq(officerProfiles.badgeNumber, query.badgeNumber));
    }
    if (query.department) {
      conditions.push(sql`${officerProfiles.department} ILIKE ${`%${query.department}%`}`);
    }
    if (query.location) {
      conditions.push(sql`${officerProfiles.location} ILIKE ${`%${query.location}%`}`);
    }

    if (conditions.length === 0) {
      return [];
    }

    return await db
      .select()
      .from(officerProfiles)
      .where(and(...conditions))
      .orderBy(desc(officerProfiles.dataQualityScore))
      .limit(100);
  }

  // Device Fingerprint operations
  async createDeviceFingerprint(fingerprint: InsertDeviceFingerprint): Promise<DeviceFingerprint> {
    const [created] = await db
      .insert(deviceFingerprints)
      .values(fingerprint)
      .returning();
    
    return created;
  }

  async getDeviceFingerprint(deviceId: string): Promise<DeviceFingerprint | undefined> {
    const [fingerprint] = await db
      .select()
      .from(deviceFingerprints)
      .where(eq(deviceFingerprints.deviceId, deviceId))
      .limit(1);
    
    return fingerprint;
  }

  async hasDeviceUsedSample(deviceId: string): Promise<boolean> {
    const fingerprint = await this.getDeviceFingerprint(deviceId);
    return !!fingerprint;
  }
}

export const storage = new DatabaseStorage();