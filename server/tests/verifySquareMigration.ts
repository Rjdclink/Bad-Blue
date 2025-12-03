import { db } from '../db';
import { sql } from 'drizzle-orm';

export async function verifySquareMigration() {
  console.log('\n[Verification] Checking square_customer_id column...\n');
  
  try {
    // Check column exists
    const columnCheck = await db.execute(sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name = 'square_customer_id'
    `);
    
    if (columnCheck.rows.length === 0) {
      throw new Error('❌ square_customer_id column does not exist!');
    }
    
    console.log('✅ Column exists:', columnCheck.rows[0]);
    
    // Check index exists
    const indexCheck = await db.execute(sql`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'users' 
      AND indexname = 'idx_users_square_customer_id'
    `);
    
    if (indexCheck.rows.length > 0) {
      console.log('✅ Index exists:', indexCheck.rows[0].indexname);
    } else {
      console.log('⚠️  Index not found (may not be critical)');
    }
    
    // Test query that was failing
    console.log('\nTesting the exact query that was failing...');
    const testQuery = await db.execute(sql`
      SELECT id, email, first_name, last_name, profile_image_url, 
             square_customer_id, has_paid_for_access, access_payment_id, 
             access_paid_at, last_login_at, created_at, updated_at 
      FROM users 
      LIMIT 1
    `);
    
    console.log('✅ Query executed successfully!');
    console.log('✅ Migration verification PASSED\n');
    
    return true;
  } catch (error: any) {
    console.error('❌ Verification FAILED:', error.message);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  verifySquareMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
