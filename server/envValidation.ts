/**
 * Environment Variable Validation
 * Validates required environment variables on server startup
 * Part of Subscription Phase 1 - Backend Verification
 */

export interface EnvValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * Required environment variables for server operation
 */
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'SESSION_SECRET',
] as const;

/**
 * Required Square environment variables
 */
const REQUIRED_SQUARE_ENV_VARS = [
  'SQUARE_ACCESS_TOKEN',
  'SQUARE_APPLICATION_ID',
  'SQUARE_LOCATION_ID',
  'SQUARE_ENVIRONMENT',
] as const;

/**
 * Optional but recommended environment variables
 */
const RECOMMENDED_ENV_VARS = [
  'SQUARE_WEBHOOK_SIGNATURE_KEY',
  'SQUARE_WEBHOOK_NOTIFICATION_URL',
  'SERVER_BASE_URL',
  'NODE_ENV',
] as const;

/**
 * Validate that all required environment variables are set
 * @returns Validation result with missing variables
 */
export function validateEnvironment(): EnvValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required vars
  for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  // Check Square vars
  for (const envVar of REQUIRED_SQUARE_ENV_VARS) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  // Check recommended vars
  for (const envVar of RECOMMENDED_ENV_VARS) {
    if (!process.env[envVar]) {
      warnings.push(envVar);
    }
  }

  // Validate Square environment value
  if (process.env.SQUARE_ENVIRONMENT) {
    const validEnvironments = ['sandbox', 'production'];
    if (!validEnvironments.includes(process.env.SQUARE_ENVIRONMENT)) {
      warnings.push('SQUARE_ENVIRONMENT must be "sandbox" or "production"');
    }
  }

  // Validate webhook notification URL matches Square dashboard if both are set
  if (process.env.SQUARE_WEBHOOK_NOTIFICATION_URL && process.env.SERVER_BASE_URL) {
    const expectedUrl = `${process.env.SERVER_BASE_URL}/api/square/webhook`;
    if (process.env.SQUARE_WEBHOOK_NOTIFICATION_URL !== expectedUrl) {
      warnings.push(
        `SQUARE_WEBHOOK_NOTIFICATION_URL (${process.env.SQUARE_WEBHOOK_NOTIFICATION_URL}) ` +
        `does not match expected URL (${expectedUrl}). ` +
        `Ensure this matches the URL registered in Square Dashboard.`
      );
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Validate environment and exit if critical vars are missing
 * Call this at server startup before initializing any services
 */
export function validateEnvironmentOrExit(): void {
  const result = validateEnvironment();

  if (!result.valid) {
    console.error('❌ Environment validation failed!');
    console.error('Missing required environment variables:');
    result.missing.forEach(envVar => {
      console.error(`  - ${envVar}`);
    });
    console.error('\nPlease set these variables in your .env file or environment.');
    console.error('See .env.example for required configuration.');
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    console.warn('⚠️  Environment warnings:');
    result.warnings.forEach(warning => {
      console.warn(`  - ${warning}`);
    });
    console.warn('');
  }

  console.log('✅ Environment validation passed');
  console.log(`   SQUARE_ENVIRONMENT: ${process.env.SQUARE_ENVIRONMENT}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
}

/**
 * Get environment-specific configuration
 */
export function getEnvConfig() {
  return {
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV === 'development',
    isSquareProduction: process.env.SQUARE_ENVIRONMENT === 'production',
    isSquareSandbox: process.env.SQUARE_ENVIRONMENT === 'sandbox',
    databaseUrl: process.env.DATABASE_URL!,
    serverBaseUrl: process.env.SERVER_BASE_URL || 'http://localhost:5000',
    square: {
      accessToken: process.env.SQUARE_ACCESS_TOKEN!,
      applicationId: process.env.SQUARE_APPLICATION_ID!,
      locationId: process.env.SQUARE_LOCATION_ID!,
      environment: process.env.SQUARE_ENVIRONMENT! as 'sandbox' | 'production',
      webhookSignatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
      webhookNotificationUrl: process.env.SQUARE_WEBHOOK_NOTIFICATION_URL,
    },
  };
}
