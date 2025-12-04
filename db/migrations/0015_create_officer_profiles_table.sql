-- Migration: Ensure officer_profiles table exists (Drizzle-Kit Compatible)
-- This table stores compiled public data about law enforcement officers
-- Created: 2025-12-04

CREATE TABLE IF NOT EXISTS "officer_profiles" (
  "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic officer information
  "officer_name" TEXT NOT NULL,
  "badge_number" VARCHAR,
  "department" TEXT,
  "rank" TEXT,
  "location" TEXT, -- City, State format
  
  -- Comprehensive data (JSONB for flexible schema)
  "career_data" JSONB, -- Career history, training, certifications
  "incidents" JSONB, -- Disciplinary records, incidents, complaints
  "court_cases" JSONB, -- Lawsuits, court cases involving the officer
  "news_mentions" JSONB, -- News articles, media coverage
  "community_complaints" JSONB, -- Community feedback, complaints
  
  -- Source tracking
  "sources" TEXT[], -- URLs to source documents
  
  -- Data quality and freshness
  "data_quality_score" INTEGER, -- 0-100 score based on source reliability
  "last_updated" TIMESTAMP DEFAULT NOW(),
  
  -- Search metadata
  "search_count" INTEGER DEFAULT 0, -- How many times this officer has been searched
  "last_searched_at" TIMESTAMP,
  
  "created_at" TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "officer_profiles_name_idx" ON "officer_profiles"("officer_name");
CREATE INDEX IF NOT EXISTS "officer_profiles_badge_idx" ON "officer_profiles"("badge_number");
CREATE INDEX IF NOT EXISTS "officer_profiles_department_idx" ON "officer_profiles"("department");
CREATE INDEX IF NOT EXISTS "officer_profiles_location_idx" ON "officer_profiles"("location");

-- Unique constraint to prevent duplicate profiles (name + department combination)
CREATE UNIQUE INDEX IF NOT EXISTS "officer_profiles_unique_name_dept" 
  ON "officer_profiles"("officer_name", "department");

-- Add comment for documentation
COMMENT ON TABLE "officer_profiles" IS 'Compiled public data about law enforcement officers from web searches and public records';
