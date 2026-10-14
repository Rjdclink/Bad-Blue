import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SpectraNormalizedProviderBatch } from './SpectraProviderTelemetryNormalizer';
import type { SpectraDevicePlatform } from './SpectraEnrolledDeviceRegistry';

interface AuthorizedDeviceIngest {
  userId: string;
  phoneE164: string;
  deviceRef: string;
  platform: SpectraDevicePlatform;
  subjectLabel?: string;
  source: 'database' | 'environment';
}

type Query = (sql: string, parameters?: unknown[]) => Promise<{ rows: any[] }>;

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeHashEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function platform(value: unknown): SpectraDevicePlatform {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'android') return 'android';
  if (['ios', 'iphone', 'ipad', 'apple'].includes(text)) return 'ios';
  return 'other';
}

function clean(value: unknown, maximum = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, maximum) : undefined;
}

function defaultQuery(): Query {
  return async (sql: string, parameters?: unknown[]) => {
    const { pool } = await import('../../db');
    return pool.query(sql, parameters as any[]);
  };
}

export async function authorizeSpectraEnrolledDeviceIngest(
  deviceRef: string,
  bearerToken: string,
  options: { env?: NodeJS.ProcessEnv; query?: Query } = {},
): Promise<AuthorizedDeviceIngest | null> {
  const ref = clean(deviceRef, 300);
  const token = clean(bearerToken, 2_000);
  if (!ref || !token || token.length < 16) return null;

  const suppliedHash = digest(token);
  const query = options.query || defaultQuery();

  try {
    const result = await query(
      `SELECT user_id, phone_e164, device_ref, platform, subject_label
       FROM public.spectra_enrolled_devices
       WHERE lower(device_ref) = lower($1)
         AND ingest_token_hash = $2
         AND active = true
       ORDER BY updated_at DESC
       LIMIT 2`,
      [ref, suppliedHash],
    );
    if (result.rows?.length === 1) {
      const row = result.rows[0];
      return {
        userId: String(row.user_id),
        phoneE164: String(row.phone_e164),
        deviceRef: String(row.device_ref),
        platform: platform(row.platform),
        subjectLabel: clean(row.subject_label),
        source: 'database',
      };
    }
    if ((result.rows?.length || 0) > 1) return null;
  } catch {
    // Device telemetry must be durably tied to the server-side enrollment
    // registry. A database outage therefore rejects the push rather than
    // accepting telemetry that cannot be durably associated with its device.
  }

  return null;
}

function observedAt(batch: SpectraNormalizedProviderBatch): Date | null {
  let latest = Number.NEGATIVE_INFINITY;
  for (const measurement of batch.measurements || []) {
    const raw = (measurement as any)?.timestamp;
    const value = raw instanceof Date ? raw.getTime() : Date.parse(String(raw || ''));
    if (Number.isFinite(value)) latest = Math.max(latest, value);
  }
  return Number.isFinite(latest) ? new Date(latest) : null;
}

export async function persistSpectraEnrolledDeviceTelemetry(
  device: AuthorizedDeviceIngest,
  normalizerKind: string,
  batch: SpectraNormalizedProviderBatch,
  options: { query?: Query } = {},
): Promise<boolean> {
  const observed = observedAt(batch);
  if (!observed) return false;
  const canonical = {
    ...batch,
    sessionId: undefined,
    subjectLabel: undefined,
    metadata: {
      ...(batch.metadata || {}),
      deviceRef: device.deviceRef,
      platform: device.platform,
      enrolledDeviceInbox: true,
    },
  };
  const payload = JSON.stringify(canonical);
  if (Buffer.byteLength(payload, 'utf8') > 2_000_000) return false;
  const payloadHash = digest(payload);
  const query = options.query || defaultQuery();

  try {
    await query(
      `INSERT INTO public.spectra_enrolled_device_telemetry
        (user_id, device_ref, platform, normalizer_kind, observed_at, payload_hash, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (user_id, device_ref, payload_hash)
       DO UPDATE SET received_at = now()`,
      [
        device.userId,
        device.deviceRef,
        device.platform,
        normalizerKind.slice(0, 100),
        observed.toISOString(),
        payloadHash,
        payload,
      ],
    );
    // Bounded retention per enrolled device. This runs after the insert and
    // never affects whether the newest observation was accepted.
    await query(
      `DELETE FROM public.spectra_enrolled_device_telemetry
       WHERE id IN (
         SELECT id
         FROM public.spectra_enrolled_device_telemetry
         WHERE user_id = $1 AND device_ref = $2
         ORDER BY observed_at DESC, received_at DESC
         OFFSET 256
       )`,
      [device.userId, device.deviceRef],
    ).catch(() => ({ rows: [] }));
    return true;
  } catch {
    return false;
  }
}

export async function loadLatestSpectraEnrolledDeviceTelemetry(
  userId: string,
  deviceRef: string,
  options: {
    query?: Query;
    maxAgeMs?: number;
  } = {},
): Promise<SpectraNormalizedProviderBatch | null> {
  const query = options.query || defaultQuery();
  const maxAgeMs = Math.max(
    5_000,
    Math.min(24 * 60 * 60_000, Number(options.maxAgeMs ?? 5 * 60_000)),
  );
  try {
    const result = await query(
      `SELECT payload, observed_at
       FROM public.spectra_enrolled_device_telemetry
       WHERE user_id = $1
         AND lower(device_ref) = lower($2)
         AND observed_at >= now() - ($3::bigint * interval '1 millisecond')
       ORDER BY observed_at DESC, received_at DESC
       LIMIT 1`,
      [userId, deviceRef, maxAgeMs],
    );
    const payload = result.rows?.[0]?.payload;
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.measurements)) {
      return null;
    }
    return payload as SpectraNormalizedProviderBatch;
  } catch {
    return null;
  }
}


export async function rotateSpectraEnrolledDeviceIngestToken(
  userId: string,
  deviceRef: string,
  options: { query?: Query } = {},
): Promise<{ deviceRef: string; platform: SpectraDevicePlatform; token: string } | null> {
  const user = clean(userId, 300);
  const ref = clean(deviceRef, 300);
  if (!user || !ref) return null;

  const token = randomBytes(32).toString('base64url');
  const tokenHash = digest(token);
  const query = options.query || defaultQuery();
  try {
    const result = await query(
      `UPDATE public.spectra_enrolled_devices
       SET ingest_token_hash = $3, updated_at = now()
       WHERE user_id = $1
         AND lower(device_ref) = lower($2)
         AND active = true
       RETURNING device_ref, platform`,
      [user, ref, tokenHash],
    );
    if (result.rows?.length !== 1) return null;
    return {
      deviceRef: String(result.rows[0].device_ref),
      platform: platform(result.rows[0].platform),
      token,
    };
  } catch {
    return null;
  }
}
