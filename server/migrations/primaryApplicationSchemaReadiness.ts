import { pool } from '../db';

/**
 * Readiness proof only. Table creation remains exclusively owned by the canonical
 * migrations in reconcileAppSchema.ts and their existing creator modules.
 */
export const PRIMARY_REQUIRED_APPLICATION_TABLES = [
  // Existing core application verification surface.
  'public.users',
  'public.complaints',
  'public.lawsuit_filings',
  'public.foia_requests',
  'public.officer_profiles',
  'public.section_1983_filings',
  'public.authority_contacts_cache',
  'public.complaint_routing_history',
  'public.foia_routing_history',
  'public.trial_consultations',
  'public.ai_subagent_logs',

  // Search-session/priority schema used by the autonomous officer-data worker.
  'public.jurisdiction_populations',
  'public.officer_category_priority',
  'public.subagent_search_queue',
  'public.subagent_search_sessions',

  // Migration-owned Sub-Agent/worker runtime support.
  'public.subagent_capabilities',
  'public.subagent_learning_patterns',
  'public.subagent_performance_metrics',
  'public.subagent_self_improvement_actions',
  'public.department_urls',
  'public.sub_agent_search_cycles',
  'public.worker_alerts',
  'public.worker_failure_logs',
  'public.worker_function_errors',
  'public.worker_repair_metrics',
  'public.worker_health_metrics',
] as const;

export class PrimaryApplicationSchemaReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrimaryApplicationSchemaReadinessError';
  }
}

async function verifyPrimaryApplicationSchemaOnce(): Promise<void> {
  const required = [...PRIMARY_REQUIRED_APPLICATION_TABLES];
  const result = await pool.query(
    `SELECT required_name, to_regclass(required_name)::text AS relation
     FROM unnest($1::text[]) AS required(required_name)`,
    [required],
  );

  const observed = new Map<string, string | null>(
    result.rows.map((row: any) => [String(row.required_name), row.relation ? String(row.relation) : null]),
  );
  const missing = required.filter(name => !observed.get(name));
  if (missing.length > 0) {
    throw new PrimaryApplicationSchemaReadinessError(
      `required Primary application schema is absent: ${missing.join(', ')}`,
    );
  }
}

function readinessRetryDelayMs(attempt: number): number {
  const capMs = Math.min(5_000, 500 * Math.max(1, attempt));
  const floorMs = Math.min(250, Math.max(50, Math.floor(capMs / 4)));
  return floorMs + Math.floor(Math.random() * Math.max(1, capMs - floorMs + 1));
}

/**
 * Bounded retry allows a rolling-deploy sibling that already owns the canonical
 * advisory migration lock to finish its DDL. Readiness never mutates schema and
 * never treats mere database connectivity as application-schema readiness.
 */
export async function requirePrimaryApplicationSchema(maxAttempts = 8): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
    try {
      await verifyPrimaryApplicationSchemaOnce();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, readinessRetryDelayMs(attempt)));
      }
    }
  }

  const message = lastError instanceof Error
    ? lastError.message
    : String(lastError || 'unknown Primary application schema failure');
  throw new PrimaryApplicationSchemaReadinessError(
    `Primary application schema readiness failed after ${Math.max(1, maxAttempts)} attempts: ${message}`,
  );
}
