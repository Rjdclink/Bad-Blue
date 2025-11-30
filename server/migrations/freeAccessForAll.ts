// Migration: Make officer search and legal consultation FREE for all signed-in users
// This migration sets hasPaidForAccess=true for ALL existing users
// Date: 2025-01-13

import { db } from '../db';
import { users } from '@shared/schema';
import { sql } from 'drizzle-orm';

export async function runFreeAccessMigration() {
  try {
    console.log('Starting migration: Making officer search and legal consultation FREE for all users...');
    
    // Update all existing users to have hasPaidForAccess=true
    const result = await db
      .update(users)
      .set({ 
        hasPaidForAccess: true,
        updatedAt: new Date()
      })
      .where(sql`1=1`); // Update ALL users
    
    // Get count of updated users for logging
    const userCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(users);
    
    console.log(`✓ Migration complete: Updated ${userCount[0]?.count || 0} users to have free access to officer search and legal consultation`);
    console.log('✓ All new users will automatically have free access (hasPaidForAccess defaults to true in schema)');
    
    return {
      success: true,
      message: `Successfully granted free access to ${userCount[0]?.count || 0} users`,
      usersUpdated: userCount[0]?.count || 0
    };
  } catch (error) {
    console.error('Migration failed:', error);
    return {
      success: false,
      message: `Migration failed: ${(error as Error).message || 'Unknown error'}`,
      usersUpdated: 0
    };
  }
}

// Export for use in migration runner
export default runFreeAccessMigration;