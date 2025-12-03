// Square Payment Client - Configured for v43.2.1 API
import { SquareClient, SquareEnvironment } from 'square';
import { getConfig } from './config';

let squareClient: SquareClient | null = null;

export function getSquareClient(): SquareClient {
  if (squareClient) return squareClient;

  const config = getConfig();
  const accessToken = config.SQUARE_ENVIRONMENT === 'production' 
    ? config.SQUARE_ACCESS_TOKEN 
    : config.SQUARE_SANDBOX_ACCESS_TOKEN;

  const environment = config.SQUARE_ENVIRONMENT === 'production'
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox;

  if (!accessToken) {
    throw new Error('Square access token not configured');
  }

  squareClient = new SquareClient({
    token: accessToken,
    environment: environment,
  });

  console.log(`[Square] Initialized client in ${environment} mode`);

  return squareClient;
}

export function getSquareLocationId(): string {
  const config = getConfig();
  if (!config.SQUARE_LOCATION_ID) {
    throw new Error('SQUARE_LOCATION_ID not configured');
  }
  return config.SQUARE_LOCATION_ID;
}
