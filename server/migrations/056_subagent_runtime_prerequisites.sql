-- Overflow-owned runtime prerequisites for the optional Sub-Agent/search services.
-- These objects were historically created only by the legacy application migration
-- runner. Overflow-first startup intentionally skips that runner, so the services
-- could start against an otherwise healthy Overflow plane before their own tables
-- existed. Keep the repair idempotent and server-only: RLS is enabled without
-- anon/authenticated policies so these internal tables are not exposed through the
-- Supabase Data API.

CREATE TABLE IF NOT EXISTS public.subagent_capabilities (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_name VARCHAR UNIQUE NOT NULL,
  description TEXT NOT NULL,
  success_count INTEGER DEFAULT 0 NOT NULL,
  fail_count INTEGER DEFAULT 0 NOT NULL,
  avg_execution_time_ms INTEGER,
  last_used TIMESTAMP,
  learned_at TIMESTAMP DEFAULT NOW() NOT NULL,
  limitations TEXT[],
  improvements TEXT[],
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.subagent_learning_patterns (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type VARCHAR NOT NULL,
  pattern_data JSONB NOT NULL,
  confidence_score INTEGER DEFAULT 50 NOT NULL,
  times_observed INTEGER DEFAULT 1 NOT NULL,
  last_observed TIMESTAMP DEFAULT NOW() NOT NULL,
  associated_capabilities TEXT[],
  impact VARCHAR,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.subagent_performance_metrics (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name VARCHAR NOT NULL,
  metric_value INTEGER NOT NULL,
  measured_at TIMESTAMP DEFAULT NOW() NOT NULL,
  context JSONB,
  task_id VARCHAR,
  capability_name VARCHAR,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.subagent_self_improvement_actions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type VARCHAR NOT NULL,
  description TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  success_metrics JSONB,
  rollback_available BOOLEAN DEFAULT TRUE NOT NULL,
  rolled_back BOOLEAN DEFAULT FALSE NOT NULL,
  rollback_reason TEXT,
  impact VARCHAR,
  capability_affected VARCHAR,
  implemented_at TIMESTAMP DEFAULT NOW() NOT NULL,
  evaluated_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.jurisdiction_populations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(2) NOT NULL,
  population INTEGER NOT NULL,
  region TEXT,
  entity_type VARCHAR(30) NOT NULL DEFAULT 'city',
  priority_score INTEGER DEFAULT 0,
  search_status VARCHAR(20) DEFAULT 'pending',
  last_searched_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(city, state)
);

CREATE TABLE IF NOT EXISTS public.officer_category_priority (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name VARCHAR(50) UNIQUE NOT NULL,
  priority_order INTEGER NOT NULL,
  search_interval_minutes INTEGER DEFAULT 10,
  rest_interval_minutes INTEGER DEFAULT 10,
  daily_budget_minutes INTEGER DEFAULT 60,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.subagent_search_queue (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id VARCHAR REFERENCES public.jurisdiction_populations(id) ON DELETE CASCADE,
  entity_type VARCHAR(30) NOT NULL,
  priority_score INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) DEFAULT 'queued',
  attempt_count INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMP,
  next_attempt_at TIMESTAMP,
  error_message TEXT,
  officers_found INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.subagent_search_sessions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date VARCHAR(10) UNIQUE NOT NULL,
  total_budget_minutes INTEGER DEFAULT 180,
  minutes_used INTEGER DEFAULT 0,
  minutes_remaining INTEGER DEFAULT 180,
  interval_plan JSONB,
  searches_completed INTEGER DEFAULT 0,
  officers_found INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  paused_at TIMESTAMP,
  resumed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- SearchSessionManager's adaptive delay is governed by the shared AI token quota
-- repository. Keep its hot quota evidence on Overflow as well so a healthy search
-- session never has to query cold Primary or silently treat an auth failure as zero
-- usage. Historical Primary rows remain archive data; new runtime truth is Overflow.
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

CREATE INDEX IF NOT EXISTS idx_subagent_pattern_type ON public.subagent_learning_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_subagent_confidence_score ON public.subagent_learning_patterns(confidence_score);
CREATE INDEX IF NOT EXISTS idx_subagent_last_observed ON public.subagent_learning_patterns(last_observed);
CREATE INDEX IF NOT EXISTS idx_subagent_metric_name ON public.subagent_performance_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_subagent_measured_at ON public.subagent_performance_metrics(measured_at);
CREATE INDEX IF NOT EXISTS idx_subagent_action_type ON public.subagent_self_improvement_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_jurisdiction_state ON public.jurisdiction_populations(state);
CREATE INDEX IF NOT EXISTS idx_jurisdiction_population ON public.jurisdiction_populations(population DESC);
CREATE INDEX IF NOT EXISTS idx_jurisdiction_search_status ON public.jurisdiction_populations(search_status);
CREATE INDEX IF NOT EXISTS idx_category_priority_order ON public.officer_category_priority(priority_order);
CREATE INDEX IF NOT EXISTS idx_search_queue_status ON public.subagent_search_queue(status);
CREATE INDEX IF NOT EXISTS idx_search_queue_priority ON public.subagent_search_queue(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_search_queue_next_attempt ON public.subagent_search_queue(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_search_session_date ON public.subagent_search_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_date ON public.ai_usage_metrics(provider, date);
CREATE INDEX IF NOT EXISTS idx_ai_usage_source_date ON public.ai_usage_metrics(source, date);
CREATE INDEX IF NOT EXISTS idx_ai_usage_timestamp ON public.ai_usage_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_timestamp ON public.ai_usage_metrics(provider, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_task ON public.ai_usage_metrics(task_name);
CREATE INDEX IF NOT EXISTS idx_ai_usage_source ON public.ai_usage_metrics(source);
CREATE INDEX IF NOT EXISTS idx_ai_usage_source_timestamp ON public.ai_usage_metrics(source, timestamp DESC);

INSERT INTO public.officer_category_priority
  (category_name, priority_order, search_interval_minutes, rest_interval_minutes, daily_budget_minutes)
VALUES
  ('municipal', 1, 10, 10, 90),
  ('town', 2, 10, 10, 45),
  ('state', 3, 10, 10, 25),
  ('government', 4, 10, 10, 15),
  ('corrections', 5, 10, 10, 5)
ON CONFLICT (category_name) DO NOTHING;

ALTER TABLE public.subagent_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subagent_learning_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subagent_performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subagent_self_improvement_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jurisdiction_populations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.officer_category_priority ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subagent_search_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subagent_search_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_metrics ENABLE ROW LEVEL SECURITY;
