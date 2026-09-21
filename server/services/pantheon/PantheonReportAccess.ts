import crypto from 'node:crypto';

const COOKIE_NAME = 'pantheon_report_access';
const TOKEN_VERSION = 1;
const TOKEN_TTL_SECONDS = 6 * 60 * 60;

interface PantheonReportTokenPayload {
  v: number;
  reportId: string;
  userId: string;
  iat: number;
  exp: number;
}

function secret(): string {
  const value = String(process.env.SESSION_SECRET || '').trim();
  if (!value) throw new Error('SESSION_SECRET is required for Pantheon report access tokens');
  return value;
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signature(encodedPayload: string): string {
  return crypto.createHmac('sha256', secret()).update(encodedPayload).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readCookie(req: any, name: string): string | null {
  const header = String(req?.headers?.cookie || '');
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function issuePantheonReportAccess(res: any, reportId: string, userId: string): void {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: PantheonReportTokenPayload = {
    v: TOKEN_VERSION,
    reportId,
    userId,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  const token = `${encodedPayload}.${signature(encodedPayload)}`;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/api/osint/report-jobs',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${TOKEN_TTL_SECONDS}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function verifyPantheonReportAccess(req: any, reportId: string): PantheonReportTokenPayload | null {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const encodedPayload = token.slice(0, separator);
  const receivedSignature = token.slice(separator + 1);
  const expectedSignature = signature(encodedPayload);
  if (!safeEqual(receivedSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(decode(encodedPayload)) as PantheonReportTokenPayload;
    if (
      payload.v !== TOKEN_VERSION ||
      payload.reportId !== reportId ||
      !payload.userId ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    const issuedAt = Number.isFinite(payload.iat)
      ? Number(payload.iat)
      : Number(payload.exp) - TOKEN_TTL_SECONDS;
    if (!Number.isFinite(issuedAt) || issuedAt > Number(payload.exp)) return null;
    return { ...payload, iat: issuedAt };
  } catch {
    return null;
  }
}
