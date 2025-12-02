-- Migration: Add OpenRouter providers to AI usage metrics
-- Date: 2025-12-02
-- Description: Extends ai_provider enum to support DeepSeek, Grok, and Kimi models via OpenRouter

-- Note: PostgreSQL requires adding enum values one at a time
-- These are the new OpenRouter-based providers for USER context

-- Add DeepSeek provider (671B params, strong reasoning)
ALTER TYPE ai_provider ADD VALUE IF NOT EXISTS 'deepseek';

-- Add Grok provider (2M context, multimodal)
ALTER TYPE ai_provider ADD VALUE IF NOT EXISTS 'grok';

-- Add Kimi provider (1T params, structured extraction)
ALTER TYPE ai_provider ADD VALUE IF NOT EXISTS 'kimi';

-- Note: The existing ai_usage_metrics table schema already supports
-- the new providers since the provider column is VARCHAR(20).
-- This migration only affects the ai_provider enum type if it exists.

-- If your schema uses VARCHAR instead of enum, no changes needed.
-- The TypeScript types have been updated to include:
-- 'gemini' | 'groq' | 'mistral' | 'claude' | 'deepseek' | 'grok' | 'kimi'

-- Verification query (run after migration):
-- SELECT DISTINCT provider FROM ai_usage_metrics ORDER BY provider;

-- Context separation enforcement (application-level, not DB-level):
-- AUTONOMOUS context: Only 'groq' and 'mistral' allowed
-- USER context: Only 'gemini', 'claude', 'deepseek', 'grok', 'kimi' allowed
