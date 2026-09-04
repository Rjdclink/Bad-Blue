-- Overflow application-support schema for SelfImprovementEngine.
--
-- The normal runtime can operate in Overflow proxy mode without running the
-- legacy primary startup migration suite. SelfImprovementEngine is still an
-- application subsystem and legitimately reads/writes these three relations via
-- the active application data plane. Keep this migration narrowly scoped to the
-- relations that engine owns; do not import the full legacy Sub-Agent migration
-- set or install any competing scheduler/worker authority here.

CREATE TABLE IF NOT EXISTS public.subagent_learning_patterns (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type varchar NOT NULL,
  pattern_data jsonb NOT NULL,
  confidence_score integer NOT NULL DEFAULT 50,
  times_observed integer NOT NULL DEFAULT 1,
  last_observed timestamp NOT NULL DEFAULT now(),
  associated_capabilities text[],
  impact varchar,
  metadata jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

ALTER TABLE public.subagent_learning_patterns
  ADD COLUMN IF NOT EXISTS pattern_type varchar,
  ADD COLUMN IF NOT EXISTS pattern_data jsonb,
  ADD COLUMN IF NOT EXISTS confidence_score integer DEFAULT 50,
  ADD COLUMN IF NOT EXISTS times_observed integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_observed timestamp DEFAULT now(),
  ADD COLUMN IF NOT EXISTS associated_capabilities text[],
  ADD COLUMN IF NOT EXISTS impact varchar,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_pattern_type ON public.subagent_learning_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_confidence_score ON public.subagent_learning_patterns(confidence_score);
CREATE INDEX IF NOT EXISTS idx_last_observed ON public.subagent_learning_patterns(last_observed);

CREATE TABLE IF NOT EXISTS public.subagent_performance_metrics (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name varchar NOT NULL,
  metric_value integer NOT NULL,
  measured_at timestamp NOT NULL DEFAULT now(),
  context jsonb,
  task_id varchar,
  capability_name varchar,
  metadata jsonb,
  created_at timestamp DEFAULT now()
);

ALTER TABLE public.subagent_performance_metrics
  ADD COLUMN IF NOT EXISTS metric_name varchar,
  ADD COLUMN IF NOT EXISTS metric_value integer,
  ADD COLUMN IF NOT EXISTS measured_at timestamp DEFAULT now(),
  ADD COLUMN IF NOT EXISTS context jsonb,
  ADD COLUMN IF NOT EXISTS task_id varchar,
  ADD COLUMN IF NOT EXISTS capability_name varchar,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_metric_name ON public.subagent_performance_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_measured_at ON public.subagent_performance_metrics(measured_at);
CREATE INDEX IF NOT EXISTS idx_metrics_capability_name ON public.subagent_performance_metrics(capability_name);

CREATE TABLE IF NOT EXISTS public.subagent_self_improvement_actions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type varchar NOT NULL,
  description text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  success_metrics jsonb,
  rollback_available boolean NOT NULL DEFAULT true,
  rolled_back boolean NOT NULL DEFAULT false,
  rollback_reason text,
  impact varchar,
  capability_affected varchar,
  implemented_at timestamp NOT NULL DEFAULT now(),
  evaluated_at timestamp,
  metadata jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

ALTER TABLE public.subagent_self_improvement_actions
  ADD COLUMN IF NOT EXISTS action_type varchar,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS before_state jsonb,
  ADD COLUMN IF NOT EXISTS after_state jsonb,
  ADD COLUMN IF NOT EXISTS success_metrics jsonb,
  ADD COLUMN IF NOT EXISTS rollback_available boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS rolled_back boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS rollback_reason text,
  ADD COLUMN IF NOT EXISTS impact varchar,
  ADD COLUMN IF NOT EXISTS capability_affected varchar,
  ADD COLUMN IF NOT EXISTS implemented_at timestamp DEFAULT now(),
  ADD COLUMN IF NOT EXISTS evaluated_at timestamp,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_action_type ON public.subagent_self_improvement_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_implemented_at ON public.subagent_self_improvement_actions(implemented_at);
CREATE INDEX IF NOT EXISTS idx_impact ON public.subagent_self_improvement_actions(impact);
CREATE INDEX IF NOT EXISTS idx_rolled_back ON public.subagent_self_improvement_actions(rolled_back);

COMMENT ON TABLE public.subagent_learning_patterns IS
  'Overflow application-data-plane support for SelfImprovementEngine learned patterns. No execution, trading, or scheduler authority.';
COMMENT ON TABLE public.subagent_performance_metrics IS
  'Overflow application-data-plane support for SelfImprovementEngine KPI history. No execution, trading, or scheduler authority.';
COMMENT ON TABLE public.subagent_self_improvement_actions IS
  'Overflow application-data-plane support for audited SelfImprovementEngine changes and rollback metadata. No execution, trading, or scheduler authority.';
