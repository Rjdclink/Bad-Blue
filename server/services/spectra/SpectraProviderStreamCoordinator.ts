import WebSocket, { type RawData } from 'ws';
import { randomUUID } from 'node:crypto';
import {
  normalizeSpectraProviderPayload,
  SPECTRA_PROVIDER_NORMALIZER_KINDS,
  type SpectraProviderNormalizerKind,
  type SpectraNormalizedProviderBatch,
} from './SpectraProviderTelemetryNormalizer';
import { decodeSpectraArubaLocationFrame } from './SpectraArubaStreamDecoder';

export type SpectraProviderStreamDecoder =
  | 'json'
  | 'aruba-location-protobuf';

export interface SpectraProviderStreamConfig {
  id: string;
  label: string;
  url: string;
  decoder: SpectraProviderStreamDecoder;
  normalizerKind: SpectraProviderNormalizerKind;
  authorizationEnv?: string;
  subscriberIdEnv?: string;
  headersFromEnv?: Record<string, string>;
  reconnectMinMs: number;
  reconnectMaxMs: number;
  heartbeatMs: number;
}

export interface SpectraProviderStreamHealth {
  id: string;
  label: string;
  state: 'idle' | 'connecting' | 'healthy' | 'degraded' | 'stopped';
  decoder: SpectraProviderStreamDecoder;
  normalizerKind: string;
  connectedAt?: string;
  lastMessageAt?: string;
  lastAcceptedAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  messages: number;
  acceptedBatches: number;
  measurements: number;
  reconnects: number;
}

type BatchConsumer = (
  batch: SpectraNormalizedProviderBatch,
  providerId: string,
) => Promise<void> | void;

interface RuntimeState {
  config: SpectraProviderStreamConfig;
  health: SpectraProviderStreamHealth;
  socket?: WebSocket;
  timer?: NodeJS.Timeout;
  stopped: boolean;
  reconnectAttempt: number;
  recentKeys: Map<string, number>;
}

const runtimes = new Map<string, RuntimeState>();
let activeConsumer: BatchConsumer | null = null;

function positiveInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
    : fallback;
}

function validWssUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'wss:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function loadConfigs(): SpectraProviderStreamConfig[] {
  const raw = String(process.env.SPECTRA_WSS_PROVIDER_ADAPTERS || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    return parsed.slice(0, 32).flatMap((item: any) => {
      const id = String(item?.id || '').trim().slice(0, 120);
      const label = String(item?.label || id).trim().slice(0, 200);
      const url = String(item?.url || '').trim();
      const decoder = String(item?.decoder || 'json').trim() as SpectraProviderStreamDecoder;
      const normalizerKind = String(item?.normalizerKind || '').trim() as SpectraProviderNormalizerKind;

      if (
        !id
        || seen.has(id)
        || !validWssUrl(url)
        || !['json', 'aruba-location-protobuf'].includes(decoder)
        || !SPECTRA_PROVIDER_NORMALIZER_KINDS.includes(normalizerKind)
      ) return [];

      seen.add(id);
      return [{
        id,
        label: label || id,
        url,
        decoder,
        normalizerKind,
        authorizationEnv: String(item?.authorizationEnv || '').trim() || undefined,
        subscriberIdEnv: String(item?.subscriberIdEnv || '').trim() || undefined,
        headersFromEnv:
          item?.headersFromEnv && typeof item.headersFromEnv === 'object'
            ? Object.fromEntries(
                Object.entries(item.headersFromEnv)
                  .map(([header, envName]) => [String(header).trim(), String(envName).trim()])
                  .filter(([header, envName]) => header && envName),
              )
            : undefined,
        reconnectMinMs: positiveInt(item?.reconnectMinMs, 2_000, 500, 60_000),
        reconnectMaxMs: positiveInt(item?.reconnectMaxMs, 60_000, 2_000, 300_000),
        heartbeatMs: positiveInt(item?.heartbeatMs, 25_000, 5_000, 120_000),
      }];
    });
  } catch {
    return [];
  }
}

function headersFor(config: SpectraProviderStreamConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'LegalWhat-SPECTRA/1.0',
  };

  if (config.authorizationEnv) {
    const token = String(process.env[config.authorizationEnv] || '').trim();
    if (token) headers.Authorization = /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
  }

  if (config.subscriberIdEnv) {
    const configured = String(process.env[config.subscriberIdEnv] || '').trim();
    headers['Subscriber-Id'] = configured || randomUUID();
  }

  for (const [header, envName] of Object.entries(config.headersFromEnv || {})) {
    const value = String(process.env[envName] || '').trim();
    if (value) headers[header] = value;
  }

  return headers;
}

function rawBytes(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) {
    const merged = Buffer.concat(data);
    return new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(Buffer.from(data as any));
}

function dedupeKey(batch: SpectraNormalizedProviderBatch): string {
  const first = batch.measurements[0] as any;
  return [
    batch.sourceId,
    first?.recordId || '',
    first?.timestamp || '',
    first?.correlationGroup || '',
    batch.measurements.length,
  ].join('|');
}

function acceptedOnce(runtime: RuntimeState, batch: SpectraNormalizedProviderBatch): boolean {
  const now = Date.now();
  for (const [key, at] of runtime.recentKeys) {
    if (now - at > 5 * 60_000) runtime.recentKeys.delete(key);
  }
  const key = dedupeKey(batch);
  if (runtime.recentKeys.has(key)) return false;
  runtime.recentKeys.set(key, now);
  return true;
}

function updateHealth(
  runtime: RuntimeState,
  patch: Partial<SpectraProviderStreamHealth>,
): void {
  runtime.health = { ...runtime.health, ...patch };
}

async function decodeFrame(
  runtime: RuntimeState,
  data: RawData,
): Promise<SpectraNormalizedProviderBatch | null> {
  if (runtime.config.decoder === 'aruba-location-protobuf') {
    const decoded = decodeSpectraArubaLocationFrame(rawBytes(data));
    if (!decoded) return null;
    return normalizeSpectraProviderPayload(
      runtime.config.normalizerKind,
      runtime.config.id,
      {
        events: [decoded.payload],
        metadata: {
          streamDecoder: 'aruba-location-protobuf',
          eventType: decoded.eventType,
          eventId: decoded.eventId,
        },
      },
    );
  }

  const bytes = rawBytes(data);
  if (!bytes.length || bytes.length > 8_000_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  return normalizeSpectraProviderPayload(
    runtime.config.normalizerKind,
    runtime.config.id,
    parsed,
  );
}

function reconnectDelay(runtime: RuntimeState): number {
  const attempt = Math.max(0, runtime.reconnectAttempt);
  return Math.min(
    runtime.config.reconnectMaxMs,
    runtime.config.reconnectMinMs * Math.pow(2, Math.min(8, attempt)),
  );
}

function scheduleReconnect(runtime: RuntimeState): void {
  if (runtime.stopped || runtime.timer) return;
  const delay = reconnectDelay(runtime);
  runtime.health.reconnects += 1;
  runtime.timer = setTimeout(() => {
    runtime.timer = undefined;
    void connectRuntime(runtime);
  }, delay);
  runtime.timer.unref?.();
}

async function connectRuntime(runtime: RuntimeState): Promise<void> {
  if (runtime.stopped || runtime.socket) return;

  updateHealth(runtime, { state: 'connecting' });
  const headers = headersFor(runtime.config);
  const socket = new WebSocket(runtime.config.url, { headers });
  runtime.socket = socket;

  const heartbeat = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      try { socket.ping(); } catch {}
    }
  }, runtime.config.heartbeatMs);
  heartbeat.unref?.();

  socket.once('open', () => {
    runtime.reconnectAttempt = 0;
    updateHealth(runtime, {
      state: 'healthy',
      connectedAt: new Date().toISOString(),
      lastError: undefined,
    });
  });

  socket.on('message', data => {
    runtime.health.messages += 1;
    runtime.health.lastMessageAt = new Date().toISOString();

    void (async () => {
      try {
        const batch = await decodeFrame(runtime, data);
        if (!batch || !acceptedOnce(runtime, batch)) return;

        if (activeConsumer) {
          await activeConsumer(batch, runtime.config.id);
        }
        runtime.health.acceptedBatches += 1;
        runtime.health.measurements += batch.measurements.length;
        updateHealth(runtime, {
          state: 'healthy',
          lastAcceptedAt: new Date().toISOString(),
          lastError: undefined,
        });
      } catch (error) {
        updateHealth(runtime, {
          state: 'degraded',
          lastErrorAt: new Date().toISOString(),
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        });
      }
    })();
  });

  const disconnect = (error?: unknown) => {
    clearInterval(heartbeat);
    if (runtime.socket === socket) runtime.socket = undefined;
    if (runtime.stopped) {
      updateHealth(runtime, { state: 'stopped' });
      return;
    }
    runtime.reconnectAttempt += 1;
    updateHealth(runtime, {
      state: error ? 'degraded' : 'connecting',
      lastErrorAt: error ? new Date().toISOString() : runtime.health.lastErrorAt,
      lastError: error
        ? (error instanceof Error ? error.message : String(error)).slice(0, 500)
        : runtime.health.lastError,
    });
    scheduleReconnect(runtime);
  };

  socket.once('error', error => disconnect(error));
  socket.once('close', () => disconnect());
}

export function startSpectraProviderStreams(consumer: BatchConsumer): void {
  activeConsumer = consumer;
  for (const config of loadConfigs()) {
    if (runtimes.has(config.id)) continue;
    const runtime: RuntimeState = {
      config,
      health: {
        id: config.id,
        label: config.label,
        state: 'idle',
        decoder: config.decoder,
        normalizerKind: config.normalizerKind,
        messages: 0,
        acceptedBatches: 0,
        measurements: 0,
        reconnects: 0,
      },
      stopped: false,
      reconnectAttempt: 0,
      recentKeys: new Map(),
    };
    runtimes.set(config.id, runtime);
    void connectRuntime(runtime);
  }
}

export function stopSpectraProviderStreams(): void {
  for (const runtime of runtimes.values()) {
    runtime.stopped = true;
    if (runtime.timer) clearTimeout(runtime.timer);
    runtime.timer = undefined;
    try { runtime.socket?.close(); } catch {}
    runtime.socket = undefined;
    updateHealth(runtime, { state: 'stopped' });
  }
  activeConsumer = null;
}

export function getSpectraProviderStreamHealth(): SpectraProviderStreamHealth[] {
  return [...runtimes.values()]
    .map(runtime => ({ ...runtime.health }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getConfiguredSpectraProviderStreams(): Array<{
  id: string;
  label: string;
  decoder: SpectraProviderStreamDecoder;
  normalizerKind: string;
}> {
  return loadConfigs().map(config => ({
    id: config.id,
    label: config.label,
    decoder: config.decoder,
    normalizerKind: config.normalizerKind,
  }));
}
