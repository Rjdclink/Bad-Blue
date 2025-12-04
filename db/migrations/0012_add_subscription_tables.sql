-- Migration: Add subscription tables for Legalezo payment system
-- Date: 2025-12-04
-- Description: Extends users table and creates plans, subscriptions, and transactions tables

-- Extend existing users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'pending_payment';
ALTER TABLE users ADD COLUMN IF NOT EXISTS square_customer_id TEXT;

-- Set existing users to 'active' status so they can log in immediately
UPDATE users 
SET status = 'active' 
WHERE status IS NULL OR status = 'pending_payment';

-- Create plans table
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  interval VARCHAR(16) NOT NULL DEFAULT 'monthly',
  square_plan_id TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status VARCHAR(32) NOT NULL,
  square_subscription_id TEXT,
  start_date DATE,
  renewal_date DATE,
  canceled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  square_payment_id TEXT,
  amount INTEGER NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status VARCHAR(32) NOT NULL,
  event_type TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  raw_payload JSONB
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_subscription_id ON transactions(subscription_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_square_customer_id ON users(square_customer_id);

-- Seed Legalezo plan
-- NOTE: Replace PLACEHOLDER_SQUARE_PLAN_ID with actual Square plan ID before deployment
INSERT INTO plans (name, price, currency, interval, square_plan_id, is_active)
SELECT 'Legalezo Subscription', 2599, 'USD', 'monthly', 'PLACEHOLDER_SQUARE_PLAN_ID', true
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE square_plan_id = 'PLACEHOLDER_SQUARE_PLAN_ID');
