import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import {
  normalizeSpectraProviderPayload,
  SPECTRA_PROVIDER_NORMALIZER_KINDS,
  type SpectraProviderNormalizerKind,
  type SpectraNormalizedProviderBatch,
} from './SpectraProviderTelemetryNormalizer';

export interface SpectraMqttProviderConfig {
  id: string;
  label: string;
  brokerUrl: string;
  topic: string;
  decoder: 'json' | 'cot-xml';
  normalizerKind: SpectraProviderNormalizerKind;
  sessionId?: string;
  subjectLabel?: string;
  usernameEnv?: string;
  passwordEnv?: string;
  clientId?: string;
  keepAliveSeconds: number;
  reconnectMinMs: number;
  reconnectMaxMs: number;
}

export interface SpectraMqttProviderHealth {
  id: string;
  label: string;
  state: 'idle' | 'connecting' | 'healthy' | 'degraded' | 'stopped';
  topic: string;
  decoder: 'json' | 'cot-xml';
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

type Consumer = (
  batch: SpectraNormalizedProviderBatch,
  providerId: string,
) => Promise<void> | void;

interface Runtime {
  config: SpectraMqttProviderConfig;
  health: SpectraMqttProviderHealth;
  socket?: TLSSocket;
  reconnectTimer?: NodeJS.Timeout;
  pingTimer?: NodeJS.Timeout;
  buffer: Buffer;
  packetId: number;
  reconnectAttempt: number;
  stopped: boolean;
  recentKeys: Map<string, number>;
}

const runtimes = new Map<string, Runtime>();
let consumer: Consumer | null = null;

function positiveInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
    : fallback;
}

function loadConfigs(): SpectraMqttProviderConfig[] {
  const raw = String(process.env.SPECTRA_MQTT_PROVIDER_ADAPTERS || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();

    return parsed.slice(0, 32).flatMap((item: any) => {
      const id = String(item?.id || '').trim().slice(0, 120);
      const label = String(item?.label || id).trim().slice(0, 200);
      const brokerUrl = String(item?.brokerUrl || '').trim();
      const topic = String(item?.topic || '').trim().slice(0, 500);
      const decoder = String(item?.decoder || 'json').trim() as 'json' | 'cot-xml';
      const normalizerKind = String(item?.normalizerKind || '').trim() as SpectraProviderNormalizerKind;

      let validBroker = false;
      try {
        const url = new URL(brokerUrl);
        validBroker = url.protocol === 'mqtts:' && Boolean(url.hostname) && !url.username && !url.password;
      } catch {}

      if (
        !id
        || seen.has(id)
        || !validBroker
        || !topic
        || topic.includes('\u0000')
        || !['json', 'cot-xml'].includes(decoder)
        || !SPECTRA_PROVIDER_NORMALIZER_KINDS.includes(normalizerKind)
      ) return [];

      seen.add(id);
      return [{
        id,
        label: label || id,
        brokerUrl,
        topic,
        decoder,
        normalizerKind,
        sessionId: String(item?.sessionId || '').trim().slice(0, 200) || undefined,
        subjectLabel: String(item?.subjectLabel || '').trim().slice(0, 500) || undefined,
        usernameEnv: String(item?.usernameEnv || '').trim() || undefined,
        passwordEnv: String(item?.passwordEnv || '').trim() || undefined,
        clientId: String(item?.clientId || '').trim().slice(0, 120) || undefined,
        keepAliveSeconds: positiveInt(item?.keepAliveSeconds, 30, 10, 300),
        reconnectMinMs: positiveInt(item?.reconnectMinMs, 2_000, 500, 60_000),
        reconnectMaxMs: positiveInt(item?.reconnectMaxMs, 60_000, 2_000, 300_000),
      }];
    });
  } catch {
    return [];
  }
}

function encodeString(value: string): Buffer {
  const data = Buffer.from(value, 'utf8');
  if (data.length > 65_535) throw new Error('MQTT string exceeds protocol limit.');
  const prefix = Buffer.allocUnsafe(2);
  prefix.writeUInt16BE(data.length, 0);
  return Buffer.concat([prefix, data]);
}

function encodeRemainingLength(length: number): Buffer {
  const bytes: number[] = [];
  let value = length;
  do {
    let digit = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) digit |= 0x80;
    bytes.push(digit);
  } while (value > 0 && bytes.length < 4);
  return Buffer.from(bytes);
}

function packet(typeAndFlags: number, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([typeAndFlags]),
    encodeRemainingLength(body.length),
    body,
  ]);
}

function connectPacket(runtime: Runtime): Buffer {
  const username = runtime.config.usernameEnv
    ? String(process.env[runtime.config.usernameEnv] || '')
    : '';
  const password = runtime.config.passwordEnv
    ? String(process.env[runtime.config.passwordEnv] || '')
    : '';
  const clientId = runtime.config.clientId || `spectra-${runtime.config.id}`;

  let flags = 0x02;
  if (username) flags |= 0x80;
  if (password) flags |= 0x40;

  const variableHeader = Buffer.concat([
    encodeString('MQTT'),
    Buffer.from([0x04, flags]),
    Buffer.from([
      (runtime.config.keepAliveSeconds >>> 8) & 0xff,
      runtime.config.keepAliveSeconds & 0xff,
    ]),
  ]);

  const payload = Buffer.concat([
    encodeString(clientId),
    ...(username ? [encodeString(username)] : []),
    ...(password ? [encodeString(password)] : []),
  ]);

  return packet(0x10, Buffer.concat([variableHeader, payload]));
}

function subscribePacket(runtime: Runtime): Buffer {
  runtime.packetId = runtime.packetId >= 65_535 ? 1 : runtime.packetId + 1;
  const packetId = Buffer.allocUnsafe(2);
  packetId.writeUInt16BE(runtime.packetId, 0);
  const topic = Buffer.concat([encodeString(runtime.config.topic), Buffer.from([0x00])]);
  return packet(0x82, Buffer.concat([packetId, topic]));
}

function pubAckPacket(packetId: number): Buffer {
  const body = Buffer.allocUnsafe(2);
  body.writeUInt16BE(packetId, 0);
  return packet(0x40, body);
}

function parseRemainingLength(buffer: Buffer, offset: number): {
  value: number;
  bytes: number;
} | null {
  let multiplier = 1;
  let value = 0;
  let bytes = 0;

  while (offset + bytes < buffer.length && bytes < 4) {
    const digit = buffer[offset + bytes];
    value += (digit & 127) * multiplier;
    bytes += 1;
    if ((digit & 128) === 0) return { value, bytes };
    multiplier *= 128;
  }
  return null;
}

function readMqttString(buffer: Buffer, offset: number): {
  value: string;
  next: number;
} | null {
  if (offset + 2 > buffer.length) return null;
  const length = buffer.readUInt16BE(offset);
  const start = offset + 2;
  const end = start + length;
  if (end > buffer.length) return null;
  return { value: buffer.subarray(start, end).toString('utf8'), next: end };
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

function pruneAccepted(runtime: Runtime, now = Date.now()): void {
  for (const [key, at] of runtime.recentKeys) {
    if (now - at > 5 * 60_000) runtime.recentKeys.delete(key);
  }
}

function wasAccepted(
  runtime: Runtime,
  batch: SpectraNormalizedProviderBatch,
): boolean {
  pruneAccepted(runtime);
  return runtime.recentKeys.has(dedupeKey(batch));
}

function rememberAccepted(
  runtime: Runtime,
  batch: SpectraNormalizedProviderBatch,
): void {
  const now = Date.now();
  pruneAccepted(runtime, now);
  runtime.recentKeys.set(dedupeKey(batch), now);
}

async function processPublish(runtime: Runtime, flags: number, body: Buffer): Promise<void> {
  const topic = readMqttString(body, 0);
  if (!topic) return;

  const qos = (flags >> 1) & 0x03;
  let offset = topic.next;
  let packetId: number | undefined;
  if (qos > 0) {
    if (offset + 2 > body.length) return;
    packetId = body.readUInt16BE(offset);
    offset += 2;
  }

  runtime.health.messages += 1;
  runtime.health.lastMessageAt = new Date().toISOString();

  try {
    const payloadBytes = body.subarray(offset);
    if (!payloadBytes.length || payloadBytes.length > 8_000_000) {
      throw new Error('MQTT telemetry payload is empty or exceeds the bounded payload size.');
    }

    const batch = (() => {
      if (runtime.config.decoder === 'cot-xml') {
        const xml = payloadBytes.toString('utf8').trim();
        if (!xml.startsWith('<') || xml.length > 2_000_000) {
          throw new Error('MQTT CoT frame is empty or exceeds the bounded XML size.');
        }
        return normalizeSpectraProviderPayload(
          runtime.config.normalizerKind,
          runtime.config.id,
          {
            xml,
            sessionId: runtime.config.sessionId,
            subjectLabel: runtime.config.subjectLabel,
            _spectraMqttTopic: topic.value,
          },
        );
      }

      const payload = JSON.parse(payloadBytes.toString('utf8'));
      const payloadRecord =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload as Record<string, unknown>
          : Array.isArray(payload)
            ? { data: payload }
            : { value: payload };

      return normalizeSpectraProviderPayload(
        runtime.config.normalizerKind,
        runtime.config.id,
        {
          ...payloadRecord,
          sessionId: runtime.config.sessionId
            || String(payloadRecord.sessionId || '').trim()
            || undefined,
          subjectLabel: runtime.config.subjectLabel
            || String(payloadRecord.subjectLabel || '').trim()
            || undefined,
          _spectraMqttTopic: topic.value,
        },
      );
    })();

    if (!wasAccepted(runtime, batch)) {
      if (!consumer) {
        throw new Error('SPECTRA MQTT telemetry consumer is unavailable.');
      }

      // QoS1 is acknowledged only after the canonical consumer succeeds.
      // Failed batches remain unacknowledged so the broker can redeliver them.
      await consumer(batch, runtime.config.id);
      rememberAccepted(runtime, batch);

      runtime.health.acceptedBatches += 1;
      runtime.health.measurements += batch.measurements.length;
      runtime.health.lastAcceptedAt = new Date().toISOString();
      runtime.health.state = 'healthy';
      runtime.health.lastError = undefined;
    }

    // A duplicate that is already in recentKeys was successfully consumed on a
    // prior delivery, so acknowledging that retransmission is also correct.
    if (qos === 1 && packetId && runtime.socket?.writable) {
      runtime.socket.write(pubAckPacket(packetId));
    }
  } catch (error) {
    runtime.health.state = 'degraded';
    runtime.health.lastErrorAt = new Date().toISOString();
    runtime.health.lastError = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 500);

    // Force a clean reconnect without PUBACK. For QoS1 the broker will
    // redeliver the unacknowledged publication on the next session.
    fail(runtime, error);
  }
}

function handleData(runtime: Runtime, chunk: Buffer): void {
  runtime.buffer = Buffer.concat([runtime.buffer, chunk]);

  while (runtime.buffer.length >= 2) {
    const remaining = parseRemainingLength(runtime.buffer, 1);
    if (!remaining) return;

    const headerLength = 1 + remaining.bytes;
    const totalLength = headerLength + remaining.value;
    if (runtime.buffer.length < totalLength) return;

    const first = runtime.buffer[0];
    const packetType = first >> 4;
    const flags = first & 0x0f;
    const body = runtime.buffer.subarray(headerLength, totalLength);
    runtime.buffer = runtime.buffer.subarray(totalLength);

    if (packetType === 2) {
      if (body.length < 2 || body[1] !== 0) {
        fail(runtime, new Error(`MQTT CONNACK rejected with code ${body[1] ?? -1}.`));
        return;
      }
      runtime.socket?.write(subscribePacket(runtime));
      runtime.reconnectAttempt = 0;
      runtime.health.state = 'healthy';
      runtime.health.connectedAt = new Date().toISOString();
      runtime.health.lastError = undefined;
    } else if (packetType === 3) {
      void processPublish(runtime, flags, body);
    } else if (packetType === 13) {
      // PINGRESP
    }
  }
}

function reconnectDelay(runtime: Runtime): number {
  const ceiling = Math.min(
    runtime.config.reconnectMaxMs,
    runtime.config.reconnectMinMs * Math.pow(2, Math.min(8, runtime.reconnectAttempt)),
  );
  const floor = Math.min(runtime.config.reconnectMinMs, ceiling);
  return Math.max(floor, Math.floor(floor + Math.random() * Math.max(1, ceiling - floor)));
}

function clearRuntimeTimers(runtime: Runtime): void {
  if (runtime.pingTimer) clearInterval(runtime.pingTimer);
  runtime.pingTimer = undefined;
}

function scheduleReconnect(runtime: Runtime): void {
  if (runtime.stopped || runtime.reconnectTimer) return;
  const delay = reconnectDelay(runtime);
  runtime.health.reconnects += 1;
  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = undefined;
    connectRuntime(runtime);
  }, delay);
  runtime.reconnectTimer.unref?.();
}

function fail(runtime: Runtime, error?: unknown): void {
  clearRuntimeTimers(runtime);
  if (runtime.socket) {
    try { runtime.socket.destroy(); } catch {}
    runtime.socket = undefined;
  }

  if (runtime.stopped) {
    runtime.health.state = 'stopped';
    return;
  }

  runtime.reconnectAttempt += 1;
  runtime.health.state = error ? 'degraded' : 'connecting';
  if (error) {
    runtime.health.lastErrorAt = new Date().toISOString();
    runtime.health.lastError = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 500);
  }
  scheduleReconnect(runtime);
}

function connectRuntime(runtime: Runtime): void {
  if (runtime.stopped || runtime.socket) return;

  const url = new URL(runtime.config.brokerUrl);
  const port = Number(url.port || 8883);
  runtime.health.state = 'connecting';

  const socket = tlsConnect({
    host: url.hostname,
    port,
    servername: url.hostname,
    rejectUnauthorized: true,
  });
  runtime.socket = socket;
  runtime.buffer = Buffer.alloc(0);

  socket.once('secureConnect', () => {
    socket.write(connectPacket(runtime));
    runtime.pingTimer = setInterval(() => {
      if (socket.writable) socket.write(Buffer.from([0xc0, 0x00]));
    }, Math.max(5_000, Math.floor(runtime.config.keepAliveSeconds * 500)));
    runtime.pingTimer.unref?.();
  });

  socket.on('data', chunk => handleData(runtime, Buffer.from(chunk)));
  socket.once('error', error => fail(runtime, error));
  socket.once('close', () => fail(runtime));
}

export function startSpectraMqttProviderStreams(nextConsumer: Consumer): void {
  consumer = nextConsumer;
  for (const config of loadConfigs()) {
    if (runtimes.has(config.id)) continue;
    const runtime: Runtime = {
      config,
      health: {
        id: config.id,
        label: config.label,
        state: 'idle',
        topic: config.topic,
        decoder: config.decoder,
        normalizerKind: config.normalizerKind,
        messages: 0,
        acceptedBatches: 0,
        measurements: 0,
        reconnects: 0,
      },
      buffer: Buffer.alloc(0),
      packetId: 0,
      reconnectAttempt: 0,
      stopped: false,
      recentKeys: new Map(),
    };
    runtimes.set(config.id, runtime);
    connectRuntime(runtime);
  }
}

export function stopSpectraMqttProviderStreams(): void {
  for (const runtime of runtimes.values()) {
    runtime.stopped = true;
    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = undefined;
    clearRuntimeTimers(runtime);
    try { runtime.socket?.destroy(); } catch {}
    runtime.socket = undefined;
    runtime.health.state = 'stopped';
  }
  consumer = null;
}

export function getSpectraMqttProviderHealth(): SpectraMqttProviderHealth[] {
  return [...runtimes.values()]
    .map(runtime => ({ ...runtime.health }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getConfiguredSpectraMqttProviders(): Array<{
  id: string;
  label: string;
  topic: string;
  decoder: 'json' | 'cot-xml';
  normalizerKind: string;
  sessionBound: boolean;
}> {
  return loadConfigs().map(config => ({
    id: config.id,
    label: config.label,
    topic: config.topic,
    decoder: config.decoder,
    normalizerKind: config.normalizerKind,
    sessionBound: Boolean(config.sessionId),
  }));
}
