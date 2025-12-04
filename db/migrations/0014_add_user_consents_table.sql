-- Migration: Create user_consents table (Drizzle-kit compatible)
-- Date: 2025-12-04

CREATE TABLE IF NOT EXISTS "user_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"payment_id" text NOT NULL,
	"plan_id" text,
	"consent_version" text NOT NULL,
	"consent_text" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);

DO $$ BEGIN
 ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_version_format_check" CHECK ("consent_version" ~ '^v[0-9]+\.[0-9]+(\.[0-9]+)?$');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ux_user_payment_consent" ON "user_consents" ("user_id","payment_id","consent_version");
CREATE INDEX IF NOT EXISTS "idx_user_consents_user_id" ON "user_consents" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_user_consents_payment_id" ON "user_consents" ("payment_id");
CREATE INDEX IF NOT EXISTS "idx_user_consents_created_at" ON "user_consents" ("created_at" DESC);
