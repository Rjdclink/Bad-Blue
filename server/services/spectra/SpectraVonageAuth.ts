import { createSign, randomUUID } from 'node:crypto';
import {
  bearerHeader,
  configuredSpectraEndpoint,
  fetchSpectraConfiguredJson,
} from './SpectraExternalSourceHttp';

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function normalizePrivateKey(value: string | undefined): string {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

export function mintSpectraVonageApplicationJwt(
  applicationId: string,
  privateKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const appId = applicationId.trim();
  const key = normalizePrivateKey(privateKey);
  if (!appId || !key) throw new Error('Vonage application credentials are incomplete.');

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    application_id: appId,
    iat: nowSeconds,
    nbf: Math.max(0, nowSeconds - 1),
    exp: nowSeconds + 300,
    jti: randomUUID(),
  }));
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(key).toString('base64url');
  return `${signingInput}.${signature}`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function cibaAccessToken(
  phoneE164: string,
  appJwt: string,
  scope: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const authorizeUrl = configuredSpectraEndpoint(
    env.SPECTRA_VONAGE_AUTHORIZATION_URL
      || 'https://api-eu.vonage.com/oauth2/bc-authorize',
  );
  const tokenUrl = configuredSpectraEndpoint(
    env.SPECTRA_VONAGE_TOKEN_URL
      || 'https://api-eu.vonage.com/oauth2/token',
  );
  if (!authorizeUrl || !tokenUrl) throw new Error('Vonage authentication URLs are invalid.');

  const authorization = await fetchSpectraConfiguredJson(authorizeUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...bearerHeader(appJwt),
    },
    body: new URLSearchParams({
      login_hint: phoneE164,
      scope,
    }).toString(),
  }, Number(env.SPECTRA_VONAGE_AUTH_TIMEOUT_MS || 7_000));

  const authRequestId = String(authorization?.auth_req_id || '').trim();
  if (!authRequestId) throw new Error('Vonage authorization did not return an auth request id.');
  const intervalSeconds = Math.max(
    0,
    Math.min(5, Number(authorization?.interval || 0)),
  );

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0 && intervalSeconds > 0) {
      await sleep(intervalSeconds * 1000);
    }
    try {
      const token = await fetchSpectraConfiguredJson(tokenUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          ...bearerHeader(appJwt),
        },
        body: new URLSearchParams({
          auth_req_id: authRequestId,
          grant_type: 'urn:openid:params:grant-type:ciba',
        }).toString(),
      }, Number(env.SPECTRA_VONAGE_AUTH_TIMEOUT_MS || 7_000));
      const accessToken = String(token?.access_token || '').trim();
      if (!accessToken) throw new Error('Vonage token response did not contain an access token.');
      return accessToken;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Vonage access-token exchange failed.');
}

export function spectraVonageAuthenticationConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (String(env.SPECTRA_VONAGE_LOCATION_TOKEN || '').trim()) return true;
  return Boolean(
    String(env.SPECTRA_VONAGE_APPLICATION_ID || '').trim()
    && normalizePrivateKey(env.SPECTRA_VONAGE_PRIVATE_KEY),
  );
}

export async function getSpectraVonageBearerToken(
  phoneE164: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const direct = String(env.SPECTRA_VONAGE_LOCATION_TOKEN || '').trim();
  if (direct) return direct;

  const applicationId = String(env.SPECTRA_VONAGE_APPLICATION_ID || '').trim();
  const privateKey = normalizePrivateKey(env.SPECTRA_VONAGE_PRIVATE_KEY);
  if (!applicationId || !privateKey) {
    throw new Error('Vonage Device Location Retrieval is not configured.');
  }

  const appJwt = mintSpectraVonageApplicationJwt(applicationId, privateKey);
  const scope = String(env.SPECTRA_VONAGE_OAUTH_SCOPE || '').trim();
  return scope
    ? cibaAccessToken(phoneE164, appJwt, scope, env)
    : appJwt;
}
