// Square Payment Integration Client
import { Client as SquareClient, Environment as SquareEnvironment, ApiError } from 'square';

let squareClient: SquareClient | null = null;

/**
 * Get or initialize the Square API client
 * Uses environment variables for configuration
 */
export function getSquareClient(): SquareClient {
  if (!squareClient) {
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const environment = process.env.SQUARE_ENVIRONMENT || 'production';
    
    if (!accessToken) {
      throw new Error('SQUARE_ACCESS_TOKEN environment variable is not set');
    }

    // Determine environment
    const squareEnvironment = environment === 'sandbox' 
      ? SquareEnvironment.Sandbox 
      : SquareEnvironment.Production;

    squareClient = new SquareClient({
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
