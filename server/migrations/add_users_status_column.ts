import { db } from '../db';
import { sql } from 'drizzle-orm';

export async function addUsersStatusColumn() {
  console.log('[Migration] Adding status column to users table...');
  
  try {
    // Check if column already exists
    const checkResult = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name = 'status'
    `);
    
    if (checkResult.rows.length > 0) {
      console.log('[Migration] ✓ status column already exists');
      return;
    }

    // Add status column with default value
    await db.execute(sql`
      ALTER TABLE users 
      ADD COLUMN status VARCHAR(50) DEFAULT 'active' NOT NULL
    `);
    
    console.log('[Migration] ✓ Added status column to users table');
    
    // Create index for status queries
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)
    `);
    
    console.log('[Migration] ✓ Created index on users.status');
    
  } catch (error) {
    console.error('[Migration] ❌ Failed to add status column:', error);
    throw error;
  }
}
