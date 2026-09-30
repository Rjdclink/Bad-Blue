export interface LexaraDeviceLocationSignal {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  observedAt: number;
}

const STORAGE_KEY = 'lexara-device-location-v1';
const MAX_AGE_MS = 30 * 60_000;

function validSignal(value: any): value is LexaraDeviceLocationSignal {
  return Number.isFinite(value?.latitude)
    && value.latitude >= -90 && value.latitude <= 90
    && Number.isFinite(value?.longitude)
    && value.longitude >= -180 && value.longitude <= 180
    && Number.isFinite(value?.observedAt);
}

export function readLexaraDeviceLocation(): LexaraDeviceLocationSignal | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (!validSignal(parsed) || Date.now() - parsed.observedAt > MAX_AGE_MS) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export async function captureLexaraDeviceLocation(
  options: { prompt?: boolean; timeoutMs?: number } = {},
): Promise<LexaraDeviceLocationSignal | undefined> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return undefined;

  if (!options.prompt && navigator.permissions?.query) {
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (permission.state !== 'granted') return readLexaraDeviceLocation();
    } catch {
      // Some browsers do not expose geolocation through Permissions API.
      return readLexaraDeviceLocation();
    }
  }

  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => {
        const signal: LexaraDeviceLocationSignal = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : undefined,
          observedAt: Date.now(),
        };
        try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(signal)); } catch {}
        resolve(signal);
      },
      () => resolve(readLexaraDeviceLocation()),
      {
        enableHighAccuracy: true,
        timeout: Math.max(1_000, options.timeoutMs ?? 6_000),
        maximumAge: 5 * 60_000,
      },
    );
  });
}
