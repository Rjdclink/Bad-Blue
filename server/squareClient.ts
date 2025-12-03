// Square Payment Integration Client
import { Client, Environment } from 'square';

let squareClient: Client | null = null;

/**
 * Get or initialize the Square API client
 * Uses environment variables for configuration
 */
export function getSquareClient(): Client {
  if (!squareClient) {
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const environment = process.env.SQUARE_ENVIRONMENT || 'production';
    
    if (!accessToken) {
      throw new Error('SQUARE_ACCESS_TOKEN environment variable is not set');
    }

    // Determine environment
    const squareEnvironment = environment === 'sandbox' 
      ? Environment.Sandbox 
      : Environment.Production;

    squareClient = new Client({
      accessToken,
      environment: squareEnvironment,
    });
  }

  return squareClient;
}

/**
 * Get the Square location ID from environment variables
 * Required for creating payment links
 */
export function getSquareLocationId(): string {
  const locationId = process.env.SQUARE_LOCATION_ID;
  
  if (!locationId) {
    throw new Error('SQUARE_LOCATION_ID environment variable is not set');
  }

  return locationId;
}

/**
 * Get the Square application ID from environment variables
 * Used for frontend integrations
 */
export function getSquareApplicationId(): string {
  const applicationId = process.env.SQUARE_APPLICATION_ID;
  
  if (!applicationId) {
    throw new Error('SQUARE_APPLICATION_ID environment variable is not set');
  }

  return applicationId;
}

/**
 * Get the Square webhook signature key for verification
 */
export function getSquareWebhookSignatureKey(): string {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  
  if (!signatureKey) {
    throw new Error('SQUARE_WEBHOOK_SIGNATURE_KEY environment variable is not set');
  }

  return signatureKey;
}
