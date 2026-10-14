import { pool } from '../../db';

export interface SpectraEnrolledDevice {
  phoneE164: string;
  deviceRef: string;
  subjectLabel?: string;
  ownTracksUser?: string;
  ownTracksDevice?: string;
  traccarDeviceId?: number;
  metadata: Record<string, unknown>;
  source: 'database' | 'environment';
}

export type SpectraEnrolledDeviceResolution =
  | { status: 'matched'; device: SpectraEnrolledDevice; databaseAvailable: boolean }
  | { status: 'not-found'; databaseAvailable: boolean }
  | { status: 'ambiguous'; databaseAvailable: boolean; deviceRefs: string[] }
  | { status: 'mismatch'; databaseAvailable: boolean; expectedDeviceRef: string; suppliedDeviceRef: string };

type Query = (sql: string, parameters?: unknown[]) => Promise<{ rows: any[] }>;

function cleanText(value: unknown, maximum = 300): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, maximum) : undefined;
}

/**
 * Canonical phone key for the enrolled-device registry.
 * - E.164 input stays E.164.
 * - Ten-digit NANP input is canonicalized to +1.
 * - Other 11-15 digit international input is prefixed with +.
 */
export function normalizeSpectraEnrolledPhone(value: string | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 7 && digits.length <= 15 && raw.startsWith('+') && digits[0] !== '0') {
    return `+${digits}`;
  }
  if (digits.length >= 11 && digits.length <= 15 && digits[0] !== '0') return `+${digits}`;
  return null;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function environmentRecords(env: NodeJS.ProcessEnv): SpectraEnrolledDevice[] {
  const raw = String(env.SPECTRA_ENROLLED_DEVICES_JSON || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: any) => {
      const phoneE164 = normalizeSpectraEnrolledPhone(String(entry?.phoneNumber ?? entry?.phoneE164 ?? ''));
      const deviceRef = cleanText(entry?.deviceRef);
      if (!phoneE164 || !deviceRef) return [];
      return [{
        phoneE164,
        deviceRef,
        subjectLabel: cleanText(entry?.subjectLabel, 500),
        ownTracksUser: cleanText(entry?.ownTracksUser, 200),
        ownTracksDevice: cleanText(entry?.ownTracksDevice, 200),
        traccarDeviceId: positiveInteger(entry?.traccarDeviceId),
        metadata: entry?.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
          ? { ...entry.metadata } : {},
        source: 'environment' as const,
      }];
    });
  } catch {
    return [];
  }
}

function databaseRecord(row: any): SpectraEnrolledDevice | null {
  const phoneE164 = normalizeSpectraEnrolledPhone(String(row?.phone_e164 || ''));
  const deviceRef = cleanText(row?.device_ref);
  if (!phoneE164 || !deviceRef) return null;
  return {
    phoneE164,
    deviceRef,
    subjectLabel: cleanText(row?.subject_label, 500),
    ownTracksUser: cleanText(row?.owntracks_user, 200),
    ownTracksDevice: cleanText(row?.owntracks_device, 200),
    traccarDeviceId: positiveInteger(row?.traccar_device_id),
    metadata: row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? { ...row.metadata } : {},
    source: 'database',
  };
}

export async function resolveSpectraEnrolledDevice(
  userId: string,
  phoneNumber: string | undefined,
  suppliedDeviceRef?: string,
  options: { query?: Query; env?: NodeJS.ProcessEnv } = {},
): Promise<SpectraEnrolledDeviceResolution> {
  const phoneE164 = normalizeSpectraEnrolledPhone(phoneNumber);
  if (!phoneE164) return { status: 'not-found', databaseAvailable: true };

  const query = options.query || ((sql: string, parameters?: unknown[]) => pool.query(sql, parameters as any[]));
  const env = options.env || process.env;
  let databaseAvailable = true;
  const candidates: SpectraEnrolledDevice[] = [];

  try {
    const result = await query(
      `SELECT phone_e164, device_ref, subject_label, owntracks_user, owntracks_device,
              traccar_device_id, metadata
       FROM public.spectra_enrolled_devices
       WHERE user_id = $1 AND phone_e164 = $2 AND active = true
       ORDER BY updated_at DESC
       LIMIT 4`,
      [userId, phoneE164],
    );
    for (const row of result.rows || []) {
      const record = databaseRecord(row);
      if (record) candidates.push(record);
    }
  } catch {
    // Enrollment storage is optional during rollout. A database outage/missing
    // migration does not abort the rest of a SPECTRA investigation.
    databaseAvailable = false;
  }

  // Environment enrollment is a server-side bootstrap/fallback and never
  // overrides a different database mapping for the same phone.
  candidates.push(...environmentRecords(env).filter(record => record.phoneE164 === phoneE164));

  const byDevice = new Map<string, SpectraEnrolledDevice>();
  for (const candidate of candidates) {
    const key = candidate.deviceRef.trim().toLowerCase();
    if (!byDevice.has(key) || candidate.source === 'database') byDevice.set(key, candidate);
  }
  const unique = [...byDevice.values()];

  if (!unique.length) return { status: 'not-found', databaseAvailable };
  if (unique.length > 1) {
    return {
      status: 'ambiguous',
      databaseAvailable,
      deviceRefs: unique.map(record => record.deviceRef),
    };
  }

  const device = unique[0];
  const supplied = cleanText(suppliedDeviceRef);
  if (supplied && supplied.toLowerCase() !== device.deviceRef.toLowerCase()) {
    return {
      status: 'mismatch',
      databaseAvailable,
      expectedDeviceRef: device.deviceRef,
      suppliedDeviceRef: supplied,
    };
  }

  return { status: 'matched', device, databaseAvailable };
}
