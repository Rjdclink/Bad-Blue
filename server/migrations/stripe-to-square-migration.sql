-- Migration: Stripe to Square Payment Processing
-- Description: Renames stripe_customer_id column to square_customer_id and resets values
-- Date: 2025-12-03

-- Rename the column from stripe_customer_id to square_customer_id
ALTER TABLE users RENAME COLUMN stripe_customer_id TO square_customer_id;

-- Reset all customer IDs to NULL since we're switching payment providers
UPDATE users SET square_customer_id = NULL;

-- Create index on the new column for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_square_customer_id ON users(square_customer_id);

-- Add comment for documentation
COMMENT ON COLUMN users.square_customer_id IS 'Square payment platform customer ID for processing payments';
