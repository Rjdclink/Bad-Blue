-- Migration: Stripe to Square Customer ID
-- Description: Rename stripe_customer_id column to square_customer_id and reset values
-- Author: BadBlue Migration
-- Date: 2025-12-03

-- Step 1: Rename the column from stripe_customer_id to square_customer_id
ALTER TABLE users RENAME COLUMN stripe_customer_id TO square_customer_id;

-- Step 2: Reset all existing customer IDs to NULL (Square will create new ones)
UPDATE users SET square_customer_id = NULL;

-- Step 3: Create index on square_customer_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_square_customer_id ON users(square_customer_id);

-- Note: After running this migration:
-- 1. Deploy the new code with Square integration
-- 2. Users will get new Square customer IDs on their next payment
-- 3. Old Stripe data is preserved in Stripe dashboard for reference
