export type SpectraDevicePlatform = 'android' | 'ios' | 'other';

export interface SpectraEnrolledDevice {
  phoneE164: string;
  deviceRef: string;
  platform: SpectraDevicePlatform;
  subjectLabel?: string;
  ownTracksUser?: string;
  ownTracksDevice?: string;
  traccarDeviceId?: number;
  metadata: Record<string, unknown>;
  source: 'database' | 'environment';
}

export type SpectraEnrolledDeviceResolution =
  | { status: 'matched'; device: SpectraEnrolledDevice; databaseAvailable: boolean }
  | { status: 'not-enrolled'; databaseAvailable: boolean }
  | { status: 'unavailable'; databaseAvailable: false }
  | { status: 'ambiguous'; databaseAvailable: boolean; deviceRefs: string[] }
  | {
      status: 'mismatch';
      databaseAvailable: boolean;
      mismatch: 'device-ref' | 'subject';
      expected: string;
      supplied: string;
    };

type Query = (sql: string, parameters?: unknown[]) => Promise<{ rows: any[] }>;

function text(value: unknown, maxLength = 300): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function normalizeSpectraPhoneE164(value: string | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (
    digits.length >= 7
    && digits.length <= 15
    && digits[0] !== '0'
    && (raw.startsWith('+') || digits.length >= 11)
  ) return `+${digits}`;
  return null;
}

function normalizePlatform(value: unknown): SpectraDevicePlatform {
  const platform = String(value || '').trim().toLowerCase();
  if (platform === 'android') return 'android';
  if (platform === 'ios' || platform === 'iphone' || platform === 'ipad' || platform === 'apple') return 'ios';
  return 'other';
}

function comparableSubject(value: string | undefined): string {
  const normalized = String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:\+?\d[\d\s().-]{6,}\d)$/.test(String(value || '').trim()) ? '' : normalized;
}

function subjectsCompatible(expected: string | undefined, supplied: string | undefined): boolean {
  const left = comparableSubject(expected);
  const right = comparableSubject(supplied);
  if (!left || !right || left === right) return true;
  const a = left.split(' ');
  const b = right.split(' ');
  const containsOrdered = (shorter: string[], longer: string[]) => {
    let index = 0;
    for (const token of longer) {
      if (token === shorter[index]) index += 1;
      if (index === shorter.length) return true;
    }
    return false;
  };
  return a.length <= b.length ? containsOrdered(a, b) : containsOrdered(b, a);
}

function fromRow(row: any, source: SpectraEnrolledDevice['source']): SpectraEnrolledDevice | null {
  const phoneE164 = normalizeSpectraPhoneE164(String(row?.phone_e164 ?? row?.phoneE164 ?? row?.phoneNumber ?? ''));
  const deviceRef = text(row?.device_ref ?? row?.deviceRef);
  if (!phoneE164 || !deviceRef) return null;
  return {
    phoneE164,
    deviceRef,
    platform: normalizePlatform(row?.platform),
    subjectLabel: text(row?.subject_label ?? row?.subjectLabel, 500),
    ownTracksUser: text(row?.owntracks_user ?? row?.ownTracksUser, 200),
    ownTracksDevice: text(row?.owntracks_device ?? row?.ownTracksDevice, 200),
    traccarDeviceId: positiveInteger(row?.traccar_device_id ?? row?.traccarDeviceId),
    metadata: row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? { ...row.metadata } : {},
    source,
  };
}

function environmentDevices(env: NodeJS.ProcessEnv, userId: string): SpectraEnrolledDevice[] {
  const raw = String(env.SPECTRA_ENROLLED_DEVICES_JSON || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row: any) => {
      if (String(row?.userId || '').trim() !== userId) return [];
      const device = fromRow(row, 'environment');
      return device ? [device] : [];
    });
  } catch {
    return [];
  }
}

function defaultRegistryQuery(): Query {
  return async (sql: string, parameters?: unknown[]) => {
    // Delay database initialization until a real registry lookup needs it.
    // Pure normalization/tests and environment-only fixtures do not require
    // application database configuration merely by importing this module.
    const { pool } = await import('../../db');
    return pool.query(sql, parameters as any[]);
  };
}

function resolveUniqueCandidates(
  candidates: readonly SpectraEnrolledDevice[],
  databaseAvailable: boolean,
  options: { suppliedDeviceRef?: string; subjectLabel?: string } = {},
): SpectraEnrolledDeviceResolution {
  const byRef = new Map<string, SpectraEnrolledDevice>();
  for (const candidate of candidates) {
    const key = candidate.deviceRef.toLowerCase();
    const previous = byRef.get(key);
    if (!previous || candidate.source === 'database') byRef.set(key, candidate);
  }
  const unique = [...byRef.values()];

  if (!unique.length) {
    return databaseAvailable
      ? { status: 'not-enrolled', databaseAvailable }
      : { status: 'unavailable', databaseAvailable: false };
  }
  if (unique.length > 1) {
    return {
      status: 'ambiguous',
      databaseAvailable,
      deviceRefs: unique.map(device => device.deviceRef),
    };
  }

  const device = unique[0];
  const suppliedDeviceRef = text(options.suppliedDeviceRef);
  if (
    suppliedDeviceRef
    && suppliedDeviceRef.toLowerCase() !== device.deviceRef.toLowerCase()
  ) {
    return {
      status: 'mismatch',
      databaseAvailable,
      mismatch: 'device-ref',
      expected: device.deviceRef,
      supplied: suppliedDeviceRef,
    };
  }
  if (!subjectsCompatible(device.subjectLabel, options.subjectLabel)) {
    return {
      status: 'mismatch',
      databaseAvailable,
      mismatch: 'subject',
      expected: device.subjectLabel || '',
      supplied: options.subjectLabel || '',
    };
  }
  return { status: 'matched', device, databaseAvailable };
}

export async function resolveSpectraEnrolledDevice(
  userId: string,
  phoneNumber: string | undefined,
  options: {
    suppliedDeviceRef?: string;
    subjectLabel?: string;
    query?: Query;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<SpectraEnrolledDeviceResolution> {
  const phoneE164 = normalizeSpectraPhoneE164(phoneNumber);
  if (!phoneE164) return { status: 'not-enrolled', databaseAvailable: true };

  const query: Query = options.query || defaultRegistryQuery();
  const env = options.env || process.env;
  let databaseAvailable = true;
  const candidates: SpectraEnrolledDevice[] = [];

  try {
    const result = await query(
      `SELECT phone_e164, device_ref, platform, subject_label,
              owntracks_user, owntracks_device, traccar_device_id, metadata
       FROM public.spectra_enrolled_devices
       WHERE user_id = $1 AND phone_e164 = $2 AND active = true
       ORDER BY updated_at DESC
       LIMIT 4`,
      [userId, phoneE164],
    );
    for (const row of result.rows || []) {
      const device = fromRow(row, 'database');
      if (device) candidates.push(device);
    }
  } catch {
    databaseAvailable = false;
  }

  candidates.push(
    ...environmentDevices(env, userId).filter(device => device.phoneE164 === phoneE164),
  );

  return resolveUniqueCandidates(candidates, databaseAvailable, {
    suppliedDeviceRef: options.suppliedDeviceRef,
    subjectLabel: options.subjectLabel,
  });
}

export async function resolveSpectraEnrolledDeviceByRef(
  userId: string,
  deviceRef: string | undefined,
  options: {
    subjectLabel?: string;
    query?: Query;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<SpectraEnrolledDeviceResolution> {
  const normalizedRef = text(deviceRef);
  if (!normalizedRef) return { status: 'not-enrolled', databaseAvailable: true };

  const query: Query = options.query || defaultRegistryQuery();
  const env = options.env || process.env;
  let databaseAvailable = true;
  const candidates: SpectraEnrolledDevice[] = [];

  try {
    const result = await query(
      `SELECT phone_e164, device_ref, platform, subject_label,
              owntracks_user, owntracks_device, traccar_device_id, metadata
       FROM public.spectra_enrolled_devices
       WHERE user_id = $1 AND lower(device_ref) = lower($2) AND active = true
       ORDER BY updated_at DESC
       LIMIT 4`,
      [userId, normalizedRef],
    );
    for (const row of result.rows || []) {
      const device = fromRow(row, 'database');
      if (device) candidates.push(device);
    }
  } catch {
    databaseAvailable = false;
  }

  candidates.push(
    ...environmentDevices(env, userId).filter(
      device => device.deviceRef.toLowerCase() === normalizedRef.toLowerCase(),
    ),
  );

  return resolveUniqueCandidates(candidates, databaseAvailable, {
    suppliedDeviceRef: normalizedRef,
    subjectLabel: options.subjectLabel,
  });
}
