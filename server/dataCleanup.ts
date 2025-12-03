// Automated Data Cleanup Service
// Deletes user data 7 days after access expiration (14 days after payment)
// Preserves username and email for admin records

import { db } from './db';
import { eq, and, lt, sql } from 'drizzle-orm';
import {
  users,
  savedProgress,
  badgeLookups,
  complaints,
  lawsuitFilings,
  petitions,
  petitionSignatures,
  foiaRequests,
  publicEvidence,
  adminAccessLogs,
  aiSubAgentLogs,
  adminSettingsAudit,
} from '@shared/schema';
import { cleanupOldSearchRecords } from './deviceRateLimit';

// ============================================
// CLEANUP LOG TRACKING
// ============================================

interface CleanupLog {
  timestamp: Date;
  userId: string;
  email: string;
  username: string | null;
  accessPaidAt: Date;
  dataDeleted: {
    savedProgress: number;
    badgeLookups: number;
    complaints: number;
    lawsuitFilings: number;
    petitions: number;
    petitionSignatures: number;
    foiaRequests: number;
    publicEvidence: number;
    evidenceFiles: number;
  };
  success: boolean;
  error?: string;
}

const cleanupLogs: CleanupLog[] = [];

// Keep last 1000 cleanup logs
function logCleanup(log: CleanupLog) {
  cleanupLogs.push(log);
  if (cleanupLogs.length > 1000) {
    cleanupLogs.shift();
  }
  console.log(`[DATA CLEANUP] User ${log.email}: ${log.success ? 'SUCCESS' : 'FAILED'}`);
  if (log.success) {
    const totalRecords = Object.values(log.dataDeleted).reduce((sum, count) => sum + count, 0);
    console.log(`  Deleted ${totalRecords} total records`);
  } else {
    console.log(`  Error: ${log.error}`);
  }
}

// ============================================
// CORE CLEANUP FUNCTION
// ============================================

/**
 * Delete all user data for a specific user while preserving username and email
 */
async function cleanupUserData(userId: string, userEmail: string, username: string | null, accessPaidAt: Date): Promise<CleanupLog> {
  const log: CleanupLog = {
    timestamp: new Date(Date.now()), // Use UTC timestamp
    userId,
    email: userEmail,
    username,
    accessPaidAt,
    dataDeleted: {
      savedProgress: 0,
      badgeLookups: 0,
      complaints: 0,
      lawsuitFilings: 0,
      petitions: 0,
      petitionSignatures: 0,
      foiaRequests: 0,
      publicEvidence: 0,
      evidenceFiles: 0,
    },
    success: false,
  };

  try {

    // 1. Delete saved progress
    const deletedProgress = await db.delete(savedProgress)
      .where(eq(savedProgress.userId, userId))
      .returning();
    log.dataDeleted.savedProgress = deletedProgress.length;

    // 2. Delete badge lookups (and cascade will handle relationships)
    const deletedBadges = await db.delete(badgeLookups)
      .where(eq(badgeLookups.userId, userId))
      .returning();
    log.dataDeleted.badgeLookups = deletedBadges.length;

    // 3. Delete complaints
    // Note: Evidence files in object storage are preserved for archival/legal purposes
    // The database records containing file URLs will be deleted
    const deletedComplaints = await db.delete(complaints)
      .where(eq(complaints.userId, userId))
      .returning();
    log.dataDeleted.complaints = deletedComplaints.length;

    // 4. Delete lawsuit filings
    // Note: Evidence files in object storage are preserved for archival/legal purposes
    const deletedLawsuits = await db.delete(lawsuitFilings)
      .where(eq(lawsuitFilings.userId, userId))
      .returning();
    log.dataDeleted.lawsuitFilings = deletedLawsuits.length;

    // 5. Delete petitions (signatures will cascade)
    // First get count of signatures
    const userPetitions = await db.select().from(petitions).where(eq(petitions.userId, userId));
    for (const petition of userPetitions) {
      const signatures = await db.select().from(petitionSignatures)
        .where(eq(petitionSignatures.petitionId, petition.id));
      log.dataDeleted.petitionSignatures += signatures.length;
    }
    
    const deletedPetitions = await db.delete(petitions)
      .where(eq(petitions.userId, userId))
      .returning();
    log.dataDeleted.petitions = deletedPetitions.length;

    // 6. Delete FOIA requests
    const deletedFoia = await db.delete(foiaRequests)
      .where(eq(foiaRequests.userId, userId))
      .returning();
    log.dataDeleted.foiaRequests = deletedFoia.length;

    // 7. Delete public evidence
    // Note: Files in object storage are preserved for archival purposes
    const deletedPublicEvidence = await db.delete(publicEvidence)
      .where(eq(publicEvidence.userId, userId))
      .returning();
    log.dataDeleted.publicEvidence = deletedPublicEvidence.length;

    // 8. Clear user's sensitive data but keep username and email
    await db.update(users)
      .set({
        firstName: null,
        lastName: null,
        profileImageUrl: null,
        squareCustomerId: null,
        hasPaidForAccess: false,
        accessPaymentId: null,
        accessPaidAt: null,
        updatedAt: new Date(Date.now()), // Use UTC timestamp
      })
      .where(eq(users.id, userId));

    log.success = true;
    logCleanup(log);
    return log;

  } catch (error: any) {
    log.success = false;
    log.error = error.message;
    logCleanup(log);
    return log;
  }
}

// ============================================
// AUTOMATED CLEANUP RUNNER
// ============================================

/**
 * Run automated cleanup for all expired users
 * Deletes data for users whose access expired more than 7 days ago
 */
export async function runAutomatedCleanup(): Promise<{
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  logs: CleanupLog[];
}> {
  console.log('[DATA CLEANUP] Starting automated cleanup...');

  // Calculate cutoff date: 14 days ago (7 day access + 7 day retention)
  // Use UTC to ensure consistent behavior across timezones
  const cutoffDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 14 days in milliseconds

  console.log(`[DATA CLEANUP] Cutoff date (UTC): ${cutoffDate.toISOString()}`);
  console.log('[DATA CLEANUP] Finding users with expired access older than 7 days...');

  // Find users who paid for access more than 14 days ago
  const expiredUsers = await db.select({
    id: users.id,
    email: users.email,
    accessPaidAt: users.accessPaidAt,
  })
    .from(users)
    .where(
      and(
        lt(users.accessPaidAt, cutoffDate),
        eq(users.hasPaidForAccess, true)
      )
    );

  console.log(`[DATA CLEANUP] Found ${expiredUsers.length} users to process`);

  const results: CleanupLog[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const user of expiredUsers) {
    if (!user.email || !user.accessPaidAt) continue;

    // Get username from auth accounts
    const authAccount = await db.query.authAccounts.findFirst({
      where: (authAccounts, { eq }) => eq(authAccounts.userId, user.id),
    });

    const log = await cleanupUserData(
      user.id,
      user.email,
      authAccount?.username || null,
      user.accessPaidAt
    );

    results.push(log);
    if (log.success) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  console.log(`[DATA CLEANUP] Cleanup complete: ${successCount} successful, ${failureCount} failed`);

  return {
    totalProcessed: expiredUsers.length,
    successCount,
    failureCount,
    logs: results,
  };
}

/**
 * Get cleanup logs for admin review
 */
export function getCleanupLogs(limit: number = 100): CleanupLog[] {
  return cleanupLogs.slice(-limit).reverse();
}

/**
 * Get cleanup statistics
 */
export function getCleanupStats() {
  const totalCleanups = cleanupLogs.length;
  const successfulCleanups = cleanupLogs.filter(log => log.success).length;
  const failedCleanups = cleanupLogs.filter(log => !log.success).length;

  // Use UTC for 24-hour window
  const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours in milliseconds
  const recentCleanups = cleanupLogs.filter(log => log.timestamp > last24Hours);

  return {
    totalCleanups,
    successfulCleanups,
    failedCleanups,
    successRate: totalCleanups > 0 ? (successfulCleanups / totalCleanups) * 100 : 0,
    last24Hours: recentCleanups.length,
  };
}

// ============================================
// ERROR LOG DELETION (30-DAY RETENTION)
// ============================================

interface ErrorLogCleanupResult {
  timestamp: Date;
  adminAccessLogsDeleted: number;
  aiSubAgentLogsDeleted: number;
  adminSettingsAuditDeleted: number;
  totalDeleted: number;
  success: boolean;
  error?: string;
}

const errorLogCleanupHistory: ErrorLogCleanupResult[] = [];

/**
 * Delete error logs older than 30 days to save database space
 * This includes:
 * - Admin access logs (security audit trail)
 * - AI Sub-Agent logs (command execution history)
 * - Admin settings audit (configuration change history)
 */
export async function deleteOldErrorLogs(): Promise<ErrorLogCleanupResult> {
  const result: ErrorLogCleanupResult = {
    timestamp: new Date(Date.now()), // Use UTC timestamp
    adminAccessLogsDeleted: 0,
    aiSubAgentLogsDeleted: 0,
    adminSettingsAuditDeleted: 0,
    totalDeleted: 0,
    success: false,
  };

  try {
    console.log('[ERROR LOG CLEANUP] Starting 30-day error log deletion...');

    // Calculate cutoff date: 30 days ago (UTC)
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days in milliseconds

    console.log(`[ERROR LOG CLEANUP] Deleting logs older than (UTC): ${cutoffDate.toISOString()}`);

    // 1. Delete old admin access logs
    const deletedAdminAccess = await db.delete(adminAccessLogs)
      .where(lt(adminAccessLogs.accessedAt, cutoffDate))
      .returning();
    result.adminAccessLogsDeleted = deletedAdminAccess.length;
    console.log(`[ERROR LOG CLEANUP] Deleted ${deletedAdminAccess.length} admin access logs`);

    // 2. Delete old AI Sub-Agent logs
    const deletedAiLogs = await db.delete(aiSubAgentLogs)
      .where(lt(aiSubAgentLogs.createdAt, cutoffDate))
      .returning();
    result.aiSubAgentLogsDeleted = deletedAiLogs.length;
    console.log(`[ERROR LOG CLEANUP] Deleted ${deletedAiLogs.length} AI sub-agent logs`);

    // 3. Delete old admin settings audit logs
    const deletedAuditLogs = await db.delete(adminSettingsAudit)
      .where(lt(adminSettingsAudit.changedAt, cutoffDate))
      .returning();
    result.adminSettingsAuditDeleted = deletedAuditLogs.length;
    console.log(`[ERROR LOG CLEANUP] Deleted ${deletedAuditLogs.length} admin settings audit logs`);

    result.totalDeleted = result.adminAccessLogsDeleted + result.aiSubAgentLogsDeleted + result.adminSettingsAuditDeleted;
    result.success = true;

    console.log(`[ERROR LOG CLEANUP] ✓ Successfully deleted ${result.totalDeleted} total error logs`);

  } catch (error: any) {
    console.error('[ERROR LOG CLEANUP] ✗ Error log cleanup failed:', error);
    result.error = error.message;
    result.success = false;
  }

  // Store in history (keep last 100)
  errorLogCleanupHistory.push(result);
  if (errorLogCleanupHistory.length > 100) {
    errorLogCleanupHistory.shift();
  }

  return result;
}

/**
 * Get error log cleanup history
 */
export function getErrorLogCleanupHistory(limit: number = 50): ErrorLogCleanupResult[] {
  return errorLogCleanupHistory.slice(-limit).reverse();
}

/**
 * Get error log cleanup statistics
 */
export function getErrorLogCleanupStats() {
  const totalRuns = errorLogCleanupHistory.length;
  const successfulRuns = errorLogCleanupHistory.filter(r => r.success).length;
  const failedRuns = errorLogCleanupHistory.filter(r => !r.success).length;
  const totalLogsDeleted = errorLogCleanupHistory.reduce((sum, r) => sum + r.totalDeleted, 0);

  // Use UTC for 30-day window
  const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days in milliseconds
  const recentRuns = errorLogCleanupHistory.filter(r => r.timestamp > last30Days);

  return {
    totalRuns,
    successfulRuns,
    failedRuns,
    successRate: totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0,
    totalLogsDeleted,
    last30DaysRuns: recentRuns.length,
    lastRun: errorLogCleanupHistory.length > 0 ? errorLogCleanupHistory[errorLogCleanupHistory.length - 1] : null,
  };
}

// ============================================
// COMPREHENSIVE CLEANUP (ALL SYSTEMS)
// ============================================

/**
 * Run all cleanup operations (user data, error logs, officer search records)
 */
export async function runComprehensiveCleanup(): Promise<{
  userDataCleanup: Awaited<ReturnType<typeof runAutomatedCleanup>>;
  errorLogCleanup: ErrorLogCleanupResult;
  deviceSearchCleanup: number;
}> {
  console.log('[COMPREHENSIVE CLEANUP] Starting comprehensive cleanup...');
  
  // Run all cleanup operations in parallel
  const [userDataResult, errorLogResult, deviceSearchDeleted] = await Promise.all([
    runAutomatedCleanup(),
    deleteOldErrorLogs(),
    cleanupOldSearchRecords(),
  ]);
  
  console.log('[COMPREHENSIVE CLEANUP] Complete:');
  console.log(`  - User data: ${userDataResult.successCount}/${userDataResult.totalProcessed} users processed`);
  console.log(`  - Error logs: ${errorLogResult.totalDeleted} records deleted`);
  console.log(`  - Device search: ${deviceSearchDeleted} records deleted`);
  
  return {
    userDataCleanup: userDataResult,
    errorLogCleanup: errorLogResult,
    deviceSearchCleanup: deviceSearchDeleted,
  };
}
