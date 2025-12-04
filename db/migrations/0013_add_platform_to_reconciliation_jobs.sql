-- Migration: Add platform support to reconciliation_jobs (Drizzle-kit compatible)
-- Date: 2025-12-04

ALTER TABLE "reconciliation_jobs" ADD COLUMN IF NOT EXISTS "platform" text DEFAULT 'square' NOT NULL;
ALTER TABLE "reconciliation_jobs" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
ALTER TABLE "reconciliation_jobs" ADD COLUMN IF NOT EXISTS "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "reconciliation_jobs" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending' NOT NULL;
ALTER TABLE "reconciliation_jobs" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "reconciliation_jobs" ADD COLUMN IF NOT EXISTS "last_error" text;
ALTER TABLE "reconciliation_jobs" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;
ALTER TABLE "reconciliation_jobs" ADD COLUMN IF NOT EXISTS "worker" text;
ALTER TABLE "reconciliation_jobs" ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;

DO $$ BEGIN
 ALTER TABLE "reconciliation_jobs" ADD CONSTRAINT "reconciliation_jobs_status_check" CHECK ("status" IN ('pending', 'processing', 'done', 'failed', 'manual_review'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "reconciliation_jobs" ADD CONSTRAINT "reconciliation_jobs_platform_check" CHECK ("platform" IN ('square', 'newplatform'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "idx_reconciliation_platform_status" ON "reconciliation_jobs" ("platform","status");
CREATE INDEX IF NOT EXISTS "idx_reconciliation_status_created" ON "reconciliation_jobs" ("status","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "ux_reconciliation_platform_idempotency" ON "reconciliation_jobs" ("platform","idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_reconciliation_worker" ON "reconciliation_jobs" ("worker") WHERE "worker" IS NOT NULL;
