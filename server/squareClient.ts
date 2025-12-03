// Square Payment Client - Configured for v43.2.1 API
import { SquareClient, SquareEnvironment } from 'square';

let squareClient: SquareClient | null = null;

export function getSquareClient(): SquareClient {
  if (squareClient) return squareClient;

  const accessToken = process.env.SQUARE_ENVIRONMENT === 'production' 
    ? process.env.SQUARE_ACCESS_TOKEN 
    : process.env.SQUARE_SANDBOX_ACCESS_TOKEN;

  const environment = process.env.SQUARE_ENVIRONMENT === 'production'
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox;

  if (!accessToken) {
    throw new Error('Square access token not configured');
  }

  squareClient = new SquareClient({
    accessToken: accessToken,
    environment: environment,
  });

  console.log(`[Square] Initialized client in ${environment} mode`);

  return squareClient;
}

export function getSquareLocationId(): string {
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!locationId) {
    throw new Error('SQUARE_LOCATION_ID not configured');
  }
  return locationId;
}
