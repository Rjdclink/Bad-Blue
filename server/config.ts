import { z } from 'zod';

// Helper function to validate port numbers (TCP/UDP range: 1-65535)
const validatePort = (val: string, fieldName: string): number => {
  const num = parseInt(val, 10);
  if (isNaN(num) || num <= 0 || num > 65535) {
    throw new Error(`${fieldName} must be a valid port number (1-65535)`);
  }
  return num;
};

// Helper function to validate and parse port numbers
// Note: Accepts string input (from process.env) and transforms to number for type safety
// Default values like '5000' are strings from .env but get transformed to numbers
const portValidator = (fieldName: string) => z.string().transform((val) => 
  validatePort(val, fieldName)
);

const envSchema = z.object({
  // Database
  // NOTE: In non-production environments we allow "no secrets" boot.
  // Production safety is enforced in loadConfig() with explicit checks.
  DATABASE_URL: z.string().optional().default(''),
  SUPABASE_DATABASE_URL: z.string().optional().default(''),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_DB_URL: z.string().optional().default(''),
  
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: portValidator('PORT').default('5000'),
  BASE_URL: z.string().url().optional(),
  // Fail hard if missing/weak. No placeholder/demo secrets.
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  
  // AI Services
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  
  // Payment (Square)
  // In dev/test these may be unset; production safety enforced in loadConfig().
  SQUARE_ACCESS_TOKEN: z.string().optional().default(''),
  SQUARE_SANDBOX_ACCESS_TOKEN: z.string().optional(),
  SQUARE_LOCATION_ID: z.string().optional().default(''),
  SQUARE_APPLICATION_ID: z.string().optional().default(''),
  SQUARE_ENVIRONMENT: z.enum(['production', 'sandbox']).default('production'),
  SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().optional(),
  
  // Email
  GWSMTP_USER: z.string().email().optional(),
  GWSMTP_PASSWORD: z.string().optional(),
  GWSMTP_PASS: z.string().optional(),
  GWSMTP_HOST: z.string().default('smtp.gmail.com'),
  GWSMTP_PORT: portValidator('GWSMTP_PORT').default('587'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional().transform((val) => 
    val ? validatePort(val, 'SMTP_PORT') : undefined
  ),
  RESEND_API_KEY: z.string().optional(),
  DEFAULT_FROM_EMAIL: z.string().email().optional(),
  DEFAULT_FROM_NAME: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  
  // Storage
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GCS_PROJECT_ID: z.string().optional(),
  PRIVATE_OBJECT_DIR: z.string().default('.private'),
  PUBLIC_OBJECT_SEARCH_PATHS: z.string().default('public'),
  DEFAULT_OBJECT_STORAGE_BUCKET_ID: z.string().optional(),
  OBJECT_STORAGE_ENDPOINT: z.string().url().optional(),
  
  // Admin
  ADMIN_BYPASS_ID: z.string().optional(),
  ADMIN_BYPASS_PASSWORD: z.string().optional(),
  ADMIN_BYPASS_EMAIL: z.string().email().optional(),
  
  // Worker
  ALLOW_WORKER_INSTALL: z.string().transform(val => val === 'true').default('false'),
  SUBAGENT_ALLOW_ADMIN_MODS: z.string().transform(val => val === 'true').default('false'),
  
  // Platform Detection
  REPL_ID: z.string().optional(),
  REPL_SLUG: z.string().optional(),
  RAILWAY_ENVIRONMENT: z.string().optional(),
  RAILWAY_PROJECT_ID: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

let config: Config | null = null;

export function isPostgresConnectionString(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

export function isHttpUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

export function isSupabaseProjectUrl(url: string | undefined): boolean {
  if (!url) return false;
  return isHttpUrl(url) && (
    url.includes('supabase.co') ||
    url.includes('supabase.com') ||
    url.includes('.supabase.')
  );
}

export function isSupabasePostgresConnectionString(url: string | undefined): boolean {
  if (!isPostgresConnectionString(url)) return false;
  return !!url && (
    url.includes('supabase.co') ||
    url.includes('supabase.com') ||
    url.includes('supabase.net') ||
    url.includes('.supabase.')
  );
}

export function resolveDatabaseUrl(cfg: Pick<Config, 'SUPABASE_DATABASE_URL' | 'SUPABASE_DB_URL' | 'DATABASE_URL'>): {
  url: string;
  source: 'SUPABASE_DATABASE_URL' | 'SUPABASE_DB_URL' | 'DATABASE_URL' | 'none';
} {
  const candidates: Array<{ source: 'SUPABASE_DATABASE_URL' | 'SUPABASE_DB_URL' | 'DATABASE_URL'; value: string }> = [
    { source: 'SUPABASE_DATABASE_URL', value: cfg.SUPABASE_DATABASE_URL },
    { source: 'SUPABASE_DB_URL', value: cfg.SUPABASE_DB_URL },
    { source: 'DATABASE_URL', value: cfg.DATABASE_URL },
  ];

  for (const candidate of candidates) {
    const normalized = candidate.value.trim();
    if (!normalized) continue;
    return { url: normalized, source: candidate.source };
  }

  return { url: '', source: 'none' };
}

export function loadConfig(): Config {
  if (config) return config;
  
  try {
    config = envSchema.parse(process.env);
    // Fail-fast: never allow placeholder/demo secrets.
    // This prevents production (and dev) from silently booting with an insecure default.
    const rawSessionSecret = String(process.env.SESSION_SECRET || '');
    const bannedSecrets = new Set([
      'dev-session-secret-legalwhat-000000000000',
      'generate-a-long-random-string-here',
    ]);
    if (!rawSessionSecret || rawSessionSecret.trim().length < 32) {
      throw new Error('SESSION_SECRET is required and must be at least 32 characters');
    }
    if (bannedSecrets.has(rawSessionSecret.trim())) {
      throw new Error('SESSION_SECRET is set to a placeholder value; generate a real secret (32+ chars) and set it as an env var');
    }
    // Hard production guardrails (no silent boot with missing secrets).
    const { url: dbUrl, source: dbUrlSource } = resolveDatabaseUrl(config);
    if (dbUrl) {
      if (isSupabaseProjectUrl(dbUrl)) {
        throw new Error(`${dbUrlSource} is set to a Supabase project URL. Use the Postgres connection string from Supabase Settings -> Database, not https://<project>.supabase.co`);
      }
      if (!isPostgresConnectionString(dbUrl)) {
        throw new Error(`${dbUrlSource} must be a postgres:// or postgresql:// connection string`);
      }
    }

    if (config.NODE_ENV === 'production') {
      if (!dbUrl || !dbUrl.trim()) {
        throw new Error('SUPABASE_DATABASE_URL or SUPABASE_DB_URL is required in production');
      }
      if (!isSupabasePostgresConnectionString(dbUrl)) {
        throw new Error(`${dbUrlSource} must be a Supabase Postgres connection string in production`);
      }
      if (!config.SQUARE_ACCESS_TOKEN || !config.SQUARE_ACCESS_TOKEN.trim()) {
        throw new Error('SQUARE_ACCESS_TOKEN is required in production');
      }
      if (!config.SQUARE_LOCATION_ID || !config.SQUARE_LOCATION_ID.trim()) {
        throw new Error('SQUARE_LOCATION_ID is required in production');
      }
      if (!config.SQUARE_APPLICATION_ID || !config.SQUARE_APPLICATION_ID.trim()) {
        throw new Error('SQUARE_APPLICATION_ID is required in production');
      }
    }
    // Note: Using console.log here intentionally as logger is not yet initialized during bootstrap
    console.log('[Config] ✓ Environment variables validated successfully');
    console.log(`[Config] Environment: ${config.NODE_ENV}`);
    console.log(`[Config] Port: ${config.PORT}`);
    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('[Config] ✗ Environment variable validation failed:');
      error.errors.forEach(err => {
        console.error(`  ❌ ${err.path.join('.')}: ${err.message}`);
      });
      throw new Error('Invalid environment configuration');
    }
    throw error;
  }
}

export function getConfig(): Config {
  if (!config) {
    throw new Error('Configuration not loaded. Call loadConfig() first.');
  }
  return config;
}

export const isDevelopment = (): boolean => getConfig().NODE_ENV === 'development';
export const isProduction = (): boolean => getConfig().NODE_ENV === 'production';
export const isTest = (): boolean => getConfig().NODE_ENV === 'test';
export const isRailway = (): boolean => !!getConfig().RAILWAY_ENVIRONMENT;
export const isReplit = (): boolean => !!getConfig().REPL_ID;

export const getDatabaseUrl = (): string => {
  return resolveDatabaseUrl(getConfig()).url;
};

export const getDatabaseUrlSource = (): string => resolveDatabaseUrl(getConfig()).source;

export const getPort = (): number => getConfig().PORT;

/**
 * Safe environment accessor for modules that are initialized before loadConfig().
 * Uses trimmed values and falls back when unset.
 */
export const getEnv = (name: string, fallback: string = ''): string => {
  const value = process.env[name];
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
};

export const hasEnv = (name: string): boolean => getEnv(name).length > 0;

export const getBaseUrl = (): string => {
  const cfg = getConfig();
  if (cfg.BASE_URL) return cfg.BASE_URL;
  if (cfg.NODE_ENV === 'production') return 'https://legalwhat.com';
  return `http://localhost:${cfg.PORT}`;
};

/**
 * Object storage is optional. Directory defaults do not establish that a GCS
 * client can authenticate or that a configured bucket path exists.
 */
export const isObjectStorageAvailable = (): boolean => {
  const hasCredentials = hasEnv('GOOGLE_APPLICATION_CREDENTIALS') ||
    hasEnv('GCS_PROJECT_ID') ||
    hasEnv('GOOGLE_CLOUD_PROJECT');
  const hasStoragePath = hasEnv('PUBLIC_OBJECT_SEARCH_PATHS') || hasEnv('PRIVATE_OBJECT_DIR');
  return hasCredentials && hasStoragePath;
};

export const CACHE_CONFIG = {
  retrieval: {
    ttl: 3600000,
    maxSize: 50 * 1024 * 1024,
    maxEntries: 500
  },
  search: {
    ttl: 1800000,
    maxSize: 20 * 1024 * 1024,
    maxEntries: 200
  }
};

