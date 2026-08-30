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
 * The canonical CryptoCrawler learning authority persists through PostgreSQL.
 * DeepLearningStore is a legacy/optional Supabase-js mirror. Normalize the
 * server-side Supabase aliases before that legacy module is evaluated so it can
 * reuse already-provisioned backend credentials instead of falsely reporting
 * that the whole learning system is memory-only.
 */
export function normalizeLegacySupabaseLearningEnvironment(): void {
  const existingUrl = clean(process.env.SUPABASE_URL);
  const url = existingUrl
    || clean(process.env.PUBLIC_SUPABASE_URL)
    || clean(process.env.VITE_SUPABASE_URL)
    || clean(process.env.NEXT_PUBLIC_SUPABASE_URL)
    || deriveProjectUrl(clean(process.env.SUPABASE_DATABASE_URL));

  const existingAnon = clean(process.env.SUPABASE_ANON_KEY);
  const serviceRole = clean(process.env.SUPABASE_SERVICE_ROLE_KEY)
    || clean(process.env.SUPABASE_SERVICE_KEY);
  const key = existingAnon || serviceRole;

  if (!existingUrl && url) process.env.SUPABASE_URL = url;
  if (!existingAnon && key) process.env.SUPABASE_ANON_KEY = key;

  logger.info('[LearningPersistence] Legacy Supabase-js mirror environment normalized', {
    component: 'SupabaseLearningCompatibility',
    canonicalLearningPersistence: clean(process.env.SUPABASE_DATABASE_URL) ? 'postgresql' : 'not_configured',
    legacyMirrorUrlAvailable: Boolean(process.env.SUPABASE_URL),
    legacyMirrorKeyAvailable: Boolean(process.env.SUPABASE_ANON_KEY),
    legacyMirrorCredentialSource: existingAnon
      ? 'anon_key'
      : serviceRole
        ? 'server_service_key'
        : 'none',
    databaseUrlUsedOnlyForProjectUrlDerivation: !existingUrl && Boolean(url),
    secretValuesLogged: false,
  });
}

normalizeLegacySupabaseLearningEnvironment();
