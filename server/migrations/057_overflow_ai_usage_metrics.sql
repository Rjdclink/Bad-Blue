-- Overflow-owned hot AI usage/quota authority.
-- Runtime quota governance must not depend on the cold Primary application DB.
-- This table mirrors the existing ai_usage_metrics shape used by Drizzle so the
-- token governor can preserve exact runtime semantics while remaining on Overflow.

CREATE TABLE IF NOT EXISTS public.ai_usage_metrics (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(50) NOT NULL,
  source VARCHAR(100) NOT NULL DEFAULT 'user',
  task_name VARCHAR(100) NOT NULL DEFAULT 'unknown',
  tokens_used INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  verbosity VARCHAR(20) NOT NULL DEFAULT 'standard',
  priority INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  requests_made INTEGER DEFAULT 1,
  error_count INTEGER DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  date DATE DEFAULT CURRENT_DATE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_date ON public.ai_usage_metrics(provider, date);
CREATE INDEX IF NOT EXISTS idx_ai_usage_source_date ON public.ai_usage_metrics(source, date);
CREATE INDEX IF NOT EXISTS idx_ai_usage_timestamp ON public.ai_usage_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_timestamp ON public.ai_usage_metrics(provider, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_task ON public.ai_usage_metrics(task_name);
CREATE INDEX IF NOT EXISTS idx_ai_usage_source ON public.ai_usage_metrics(source);
CREATE INDEX IF NOT EXISTS idx_ai_usage_source_timestamp ON public.ai_usage_metrics(source, timestamp DESC);

ALTER TABLE public.ai_usage_metrics ENABLE ROW LEVEL SECURITY;
