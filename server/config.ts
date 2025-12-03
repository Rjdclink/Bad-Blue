import { z } from 'zod';

// Helper function to validate and parse port numbers
// Note: Accepts string input (from process.env) and transforms to number for type safety
// Validates port range 1-65535 (valid TCP/UDP port range)
const portValidator = (fieldName: string) => z.string().transform((val) => {
  const num = parseInt(val, 10);
  if (isNaN(num) || num <= 0 || num > 65535) {
    throw new Error(`${fieldName} must be a valid port number (1-65535)`);
  }
  return num;
});

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SUPABASE_DATABASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_DB_URL: z.string().optional(),
  
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: portValidator('PORT').default('5000'),
  BASE_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  
  // AI Services
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  
  // Payment (Square)
  SQUARE_ACCESS_TOKEN: z.string().min(1, 'SQUARE_ACCESS_TOKEN is required'),
  SQUARE_SANDBOX_ACCESS_TOKEN: z.string().optional(),
  SQUARE_LOCATION_ID: z.string().min(1, 'SQUARE_LOCATION_ID is required'),
  SQUARE_APPLICATION_ID: z.string().min(1, 'SQUARE_APPLICATION_ID is required'),
  SQUARE_ENVIRONMENT: z.enum(['production', 'sandbox']).default('sandbox'),
  SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().optional(),
  
  // Email
  GWSMTP_USER: z.string().email().optional(),
  GWSMTP_PASSWORD: z.string().optional(),
  GWSMTP_PASS: z.string().optional(),
  GWSMTP_HOST: z.string().default('smtp.gmail.com'),
  GWSMTP_PORT: portValidator('GWSMTP_PORT').default('587'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional().transform((val) => {
    if (!val) return undefined;
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0 || num > 65535) {
      throw new Error('SMTP_PORT must be a valid port number (1-65535)');
    }
    return num;
  }),
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

export function loadConfig(): Config {
  if (config) return config;
  
  try {
    config = envSchema.parse(process.env);
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
  const cfg = getConfig();
  return cfg.SUPABASE_DATABASE_URL || cfg.SUPABASE_DB_URL || cfg.DATABASE_URL;
};

export const getPort = (): number => getConfig().PORT;

export const getBaseUrl = (): string => {
  const cfg = getConfig();
  if (cfg.BASE_URL) return cfg.BASE_URL;
  if (cfg.RAILWAY_ENVIRONMENT) return `https://${cfg.RAILWAY_PROJECT_ID}.railway.app`;
  if (cfg.REPL_SLUG) return `https://${cfg.REPL_SLUG}.replit.app`;
  return `http://localhost:${cfg.PORT}`;
};
