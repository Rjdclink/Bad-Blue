import logger from '../../../logger.js';

function clean(value: string | undefined): string | null {
  if (!value) return null;
  let normalized = value.trim();
  if (normalized.length >= 2) {
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      normalized = normalized.slice(1, -1).trim();
    }
  }
  return normalized || null;
}

function deriveProjectUrl(databaseUrl: string | null): string | null {
  if (!databaseUrl) return null;
  try {
    const parsed = new URL(databaseUrl);
    const direct = parsed.hostname.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i);
    if (direct?.[1]) return `https://${direct[1]}.supabase.co`;

    // Supabase pooler connection strings commonly encode the project ref in the
    // username as postgres.<project-ref>. Only derive a public project URL when
    // that explicit Supabase shape is present; never guess from arbitrary hosts.
    const username = decodeURIComponent(parsed.username || '');
    const pooled = username.match(/^postgres\.([a-z0-9-]+)$/i);
    if (pooled?.[1] && /\.supabase\.(com|net)$/i.test(parsed.hostname)) {
      return `https://${pooled[1]}.supabase.co`;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * The canonical CryptoCrawler learning authority persists through the dedicated
 * Overflow PostgreSQL plane. DeepLearningStore is a legacy/optional Supabase-js
 * mirror; normalize it to the Overflow project before that legacy module is
 * evaluated so no learning path silently binds itself back to Primary.
 */
export function normalizeLegacySupabaseLearningEnvironment(): void {
  const overflowDatabaseUrl = clean(process.env.SUPABASE_DATABASE_URL_OVERFLOW);
  const existingUrl = clean(process.env.SUPABASE_URL_OVERFLOW);
  const url = existingUrl || deriveProjectUrl(overflowDatabaseUrl);

  const publishableKey = clean(process.env.SUPABASE_PUBLISHABLE_KEY_OVERFLOW);
  const secretKey = clean(process.env.SUPABASE_SECRET_KEY_OVERFLOW);
  const key = publishableKey || secretKey;

  // These generic aliases are process-local compatibility inputs consumed by the
  // legacy mirror only. Their source of truth is always the Overflow variables.
  if (url) process.env.SUPABASE_URL = url;
  if (key) process.env.SUPABASE_ANON_KEY = key;

  logger.info('[LearningPersistence] Legacy Supabase-js mirror environment normalized to Overflow', {
    component: 'SupabaseLearningCompatibility',
    canonicalLearningPersistence: overflowDatabaseUrl ? 'overflow_postgresql' : 'not_configured',
    legacyMirrorUrlAvailable: Boolean(url),
    legacyMirrorKeyAvailable: Boolean(key),
    legacyMirrorCredentialSource: publishableKey
      ? 'overflow_publishable_key'
      : secretKey
        ? 'overflow_secret_key'
        : 'none',
    primaryCredentialFallbackUsed: false,
    secretValuesLogged: false,
  });
}

normalizeLegacySupabaseLearningEnvironment();
