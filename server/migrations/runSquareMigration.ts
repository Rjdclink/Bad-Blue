import { db } from '../db';
import { sql } from 'drizzle-orm';

export async function runSquareMigration() {
  console.log('[Migration] Starting Stripe to Square migration...');
  
  try {
    // Check if column already exists
    const checkColumn = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name = 'square_customer_id'
    `);
    
    if (checkColumn.rows.length > 0) {
      console.log('[Migration] ✓ square_customer_id column already exists');
      return;
    }
    
    // Check if old column exists
    const checkOldColumn = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name = 'stripe_customer_id'
    `);
    
    if (checkOldColumn.rows.length > 0) {
      // Rename old column
      await db.execute(sql`
        ALTER TABLE users RENAME COLUMN stripe_customer_id TO square_customer_id
      `);
      console.log('[Migration] ✓ Renamed stripe_customer_id to square_customer_id');
    } else {
      // Add new column if neither exists
      await db.execute(sql`
        ALTER TABLE users ADD COLUMN square_customer_id VARCHAR
      `);
      console.log('[Migration] ✓ Added square_customer_id column');
    }
    
    // Create index
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_users_square_customer_id ON users(square_customer_id)
    `);
    console.log('[Migration] ✓ Created index on square_customer_id');
    
    console.log('[Migration] ✅ Square migration completed successfully');
  } catch (error: any) {
    console.error('[Migration] ✗ Square migration failed:', error);
    throw error;
  }
}
