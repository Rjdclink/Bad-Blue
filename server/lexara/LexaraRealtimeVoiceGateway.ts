import crypto from 'crypto';
import type { IncomingMessage, Server } from 'http';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { createLogger } from '../logger';

const log = createLogger('LexaraRealtimeVoice');

interface RealtimeTicket {
  expiresAt: number;
  subject: string | null;
}

interface ClientConfigMessage {
  type: 'client_config';
  inputSampleRate?: number;
  outputSampleRate?: number;
  keyterms?: string[];
}

interface ClientControlMessage {
  type: string;
  turnId?: string;
  text?: string;
  playbackOffsetMs?: number;
  keyterms?: string[];
  thresholds?: {
    eager_eot_threshold?: number;
    eot_threshold?: number;
    eot_timeout_ms?: number;
  };
}

const tickets = new Map<string, RealtimeTicket>();
const TICKET_TTL_MS = 60_000;
const CLIENT_MAX_PAYLOAD_BYTES = 256 * 1024;
const DEEPGRAM_CONNECT_TIMEOUT_MS = 8_000;
const KEEPALIVE_MS = 25_000;
const MAX_RECENT_TURNS = 48;
const DEFAULT_INPUT_SAMPLE_RATE = 16_000;
const DEFAULT_OUTPUT_SAMPLE_RATE = 24_000;
const SUPPORTED_INPUT_SAMPLE_RATES = new Set([8_000, 16_000, 24_000, 44_100, 48_000]);
const SUPPORTED_OUTPUT_SAMPLE_RATES = new Set([8_000, 16_000, 24_000, 32_000, 44_100, 48_000]);

function deepgramApiKey(): string {
  return process.env.DEEPGRAM_API_KEY?.trim()
    || process.env.DEEPGRAM?.trim()
    || '';
}

function boundedSampleRate(value: unknown, fallback: number, supported: Set<number>): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && supported.has(parsed) ? parsed : fallback;
}

function normalizedKeyterms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 100))];
}

function pruneTickets(): void {
  const now = Date.now();
  for (const [ticket, state] of tickets) {
    if (state.expiresAt <= now) tickets.delete(ticket);
  }
}

export function issueLexaraRealtimeVoiceTicket(subject?: string | null): {
  ticket: string;
  expiresAt: number;
} {
  pruneTickets();
  const ticket = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + TICKET_TTL_MS;
  tickets.set(ticket, {
    expiresAt,
    subject: subject?.trim() || null,
  });
  return { ticket, expiresAt };
}

function consumeTicket(ticket: string): RealtimeTicket | null {
  pruneTickets();
  const state = tickets.get(ticket);
  if (!state || state.expiresAt <= Date.now()) {
    tickets.delete(ticket);
    return null;
  }
  tickets.delete(ticket);
  return state;
}

function rejectUpgrade(socket: any, status: number, reason: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  } finally {
    socket.destroy();
  }
}

function safeSendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // Client disconnect is route-local to this voice session.
  }
}

function parseJson(data: RawData): any | null {
  try {
    return JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
  } catch {
    return null;
  }
}

function deepgramListenUrl(sampleRate: number): string {
  const url = new URL('wss://api.deepgram.com/v2/listen');
  url.searchParams.set('model', process.env.DEEPGRAM_FLUX_STT_MODEL?.trim() || 'flux-general-en');
  url.searchParams.set('encoding', 'linear16');
  url.searchParams.set('sample_rate', String(sampleRate));
  url.searchParams.set('eager_eot_threshold', process.env.LEXARA_FLUX_EAGER_EOT_THRESHOLD?.trim() || '0.4');
  url.searchParams.set('eot_threshold', process.env.LEXARA_FLUX_EOT_THRESHOLD?.trim() || '0.7');
  url.searchParams.set('eot_timeout_ms', process.env.LEXARA_FLUX_EOT_TIMEOUT_MS?.trim() || '6000');
  url.searchParams.set('numerals', 'true');
  return url.toString();
}

function deepgramSpeakUrl(sampleRate: number): string {
  const url = new URL('wss://api.deepgram.com/v2/speak');
  url.searchParams.set('model', process.env.DEEPGRAM_TTS_MODEL?.trim() || 'flux-haley-en');
  url.searchParams.set('encoding', 'linear16');
  url.searchParams.set('sample_rate', String(sampleRate));
  // Pin Flux's production-validated delivery explicitly so provider/model
  // defaults cannot silently alter LEXARA's speaking rate or timbre.
  url.searchParams.set('speed', '1.0');
  url.searchParams.set('expressivity', '0');
  return url.toString();
}

function openDeepgramSocket(url: string, apiKey: string): WebSocket {
  return new WebSocket(url, {
    headers: { Authorization: `Token ${apiKey}` },
    perMessageDeflate: false,
    handshakeTimeout: DEEPGRAM_CONNECT_TIMEOUT_MS,
    maxPayload: 2 * 1024 * 1024,
  });
}

function handleRealtimeClient(client: WebSocket, ticket: RealtimeTicket): void {
  const apiKey = deepgramApiKey();
  if (!apiKey) {
    safeSendJson(client, { type: 'fatal', code: 'deepgram_not_configured' });
    client.close(1011, 'Realtime voice unavailable');
    return;
  }

  let stt: WebSocket | null = null;
  let tts: WebSocket | null = null;
  let configured = false;
  let activeTurnId: string | null = null;
  let activeTurnFlushed = false;
  let sttRequestId: string | null = null;
  let ttsRequestId: string | null = null;
  let sttReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let sttReconnectAttempt = 0;
  const recentTurnIds: string[] = [];
  const queuedInputFrames: Buffer[] = [];
  const keepalive = setInterval(() => {
    try {
      if (stt?.readyState === WebSocket.OPEN) stt.ping();
      if (tts?.readyState === WebSocket.OPEN) tts.ping();
      if (client.readyState === WebSocket.OPEN) client.ping();
    } catch {
      // The close path below owns cleanup.
    }
  }, KEEPALIVE_MS);
  keepalive.unref?.();

  const rememberTurn = (turnId: string | null) => {
    if (!turnId) return;
    recentTurnIds.push(turnId);
    while (recentTurnIds.length > MAX_RECENT_TURNS) recentTurnIds.shift();
  };

  const closeUpstreams = () => {
    clearInterval(keepalive);
    if (sttReconnectTimer) clearTimeout(sttReconnectTimer);
    sttReconnectTimer = null;
    for (const socket of [stt, tts]) {
      if (!socket) continue;
      try {
        if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'LEXARA session ended');
        else socket.terminate();
      } catch {
        // Already closed.
      }
    }
    stt = null;
    tts = null;
  };

  const maybeReady = () => {
    if (stt?.readyState === WebSocket.OPEN && tts?.readyState === WebSocket.OPEN) {
      safeSendJson(client, {
        type: 'ready',
        provider: 'deepgram-flux',
        subject: ticket.subject,
      });
      while (queuedInputFrames.length && stt.readyState === WebSocket.OPEN) {
        stt.send(queuedInputFrames.shift()!);
      }
    }
  };

  const configureUpstreams = (message: ClientConfigMessage) => {
    if (configured) return;
    configured = true;
    const inputSampleRate = boundedSampleRate(
      message.inputSampleRate,
      DEFAULT_INPUT_SAMPLE_RATE,
      SUPPORTED_INPUT_SAMPLE_RATES,
    );
    // The realtime playback worklet consumes raw linear16 PCM. Keep one
    // authoritative 24 kHz clock end-to-end rather than asking Flux to emit
    // device-dependent 44.1/48 kHz audio and then interpreting it elsewhere.
    const outputSampleRate = DEFAULT_OUTPUT_SAMPLE_RATE;
    const keyterms = normalizedKeyterms(message.keyterms);

    tts = openDeepgramSocket(deepgramSpeakUrl(outputSampleRate), apiKey);

    tts.on('open', maybeReady);

    tts.on('message', (data, isBinary) => {
      if (isBinary) {
        const audio = Array.isArray(data) ? Buffer.concat(data) : data;
        if (client.readyState === WebSocket.OPEN) client.send(audio, { binary: true });
        return;
      }
      const payload = parseJson(data);
      if (!payload) return;
      if (payload.type === 'Connected' && typeof payload.request_id === 'string') {
        ttsRequestId = payload.request_id;
      }
      if (payload.type === 'SpeechMetadata') {
        rememberTurn(activeTurnId);
        activeTurnId = null;
        activeTurnFlushed = false;
      } else if (payload.type === 'SpeechInterrupted') {
        rememberTurn(activeTurnId);
        activeTurnId = null;
        activeTurnFlushed = false;
      }
      safeSendJson(client, { type: 'tts_control', payload });
    });

    const handleUpstreamFailure = (
      channel: 'stt' | 'tts',
      error?: unknown,
      close?: { code?: number; reason?: string },
    ) => {
      const failureReason = error instanceof Error
        ? error.message
        : close?.reason || String(error || 'closed');
      log.warn('[LEXARA Realtime] Deepgram realtime channel failed', {
        channel,
        subject: ticket.subject,
        error: failureReason,
        closeCode: close?.code ?? null,
        closeReason: close?.reason || null,
        requestId: channel === 'tts' ? ttsRequestId : sttRequestId,
        activeTurnId,
        activeTurnFlushed,
      });
      safeSendJson(client, {
        type: 'fatal',
        code: `${channel}_unavailable`,
        channel,
        reason: failureReason.slice(0, 160),
        requestId: channel === 'tts' ? ttsRequestId : sttRequestId,
      });
      try { client.close(1011, 'Realtime voice route unavailable'); } catch { /* noop */ }
    };

    tts.on('error', error => handleUpstreamFailure('tts', error));
    tts.on('close', (code, reason) => {
      if (client.readyState === WebSocket.OPEN && code !== 1000) {
        handleUpstreamFailure('tts', undefined, { code, reason: reason.toString('utf8') });
      }
    });

    const openSttChannel = () => {
      if (client.readyState !== WebSocket.OPEN) return;
      const channel = openDeepgramSocket(deepgramListenUrl(inputSampleRate), apiKey);
      stt = channel;
      let recoveryScheduled = false;

      const recoverStt = (error?: unknown, close?: { code?: number; reason?: string }) => {
        if (recoveryScheduled || client.readyState !== WebSocket.OPEN) return;
        recoveryScheduled = true;
        if (stt === channel) stt = null;
        const failureReason = error instanceof Error
          ? error.message
          : close?.reason || String(error || 'closed');
        log.warn('[LEXARA Realtime] STT channel reconnecting without interrupting speech', {
          subject: ticket.subject,
          error: failureReason,
          closeCode: close?.code ?? null,
          closeReason: close?.reason || null,
          requestId: sttRequestId,
          activeTurnId,
          retry: sttReconnectAttempt + 1,
        });
        safeSendJson(client, {
          type: 'channel_status',
          channel: 'stt',
          status: 'reconnecting',
          reason: failureReason.slice(0, 160),
        });
        const delayMs = Math.min(2_000, 250 * (2 ** sttReconnectAttempt));
        sttReconnectAttempt = Math.min(4, sttReconnectAttempt + 1);
        sttReconnectTimer = setTimeout(() => {
          sttReconnectTimer = null;
          openSttChannel();
        }, delayMs);
        sttReconnectTimer.unref?.();
      };

      channel.on('open', () => {
        if (stt !== channel) return;
        sttReconnectAttempt = 0;
        if (keyterms.length) channel.send(JSON.stringify({ type: 'Configure', keyterms }));
        safeSendJson(client, { type: 'channel_status', channel: 'stt', status: 'ready' });
        maybeReady();
        while (queuedInputFrames.length && channel.readyState === WebSocket.OPEN) {
          channel.send(queuedInputFrames.shift()!);
        }
      });
      channel.on('message', (data, isBinary) => {
        if (isBinary || stt !== channel) return;
        const payload = parseJson(data);
        if (!payload) return;
        if (payload.type === 'Connected' && typeof payload.request_id === 'string') {
          sttRequestId = payload.request_id;
        }
        safeSendJson(client, { type: 'stt', payload });
      });
      channel.on('error', error => recoverStt(error));
      channel.on('close', (code, reason) => {
        recoverStt(undefined, { code, reason: reason.toString('utf8') });
      });
    };

    openSttChannel();

    safeSendJson(client, {
      type: 'config_ack',
      inputSampleRate,
      outputSampleRate,
    });
  };

  client.on('message', (data, isBinary) => {
    if (isBinary) {
      const frame = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer);
      if (stt?.readyState === WebSocket.OPEN) {
        stt.send(frame);
      } else if (configured && queuedInputFrames.length < 4) {
        queuedInputFrames.push(frame);
      }
      return;
    }

    const message = parseJson(data) as ClientControlMessage | ClientConfigMessage | null;
    if (!message?.type) return;

    if (message.type === 'client_config') {
      configureUpstreams(message as ClientConfigMessage);
      return;
    }

    if (!configured) return;

    if (message.type === 'stt_configure' && stt?.readyState === WebSocket.OPEN) {
      const keyterms = message.keyterms === undefined ? undefined : normalizedKeyterms(message.keyterms);
      const configure: Record<string, unknown> = { type: 'Configure' };
      if (keyterms !== undefined) configure.keyterms = keyterms;
      if (message.thresholds && typeof message.thresholds === 'object') {
        configure.thresholds = message.thresholds;
      }
      stt.send(JSON.stringify(configure));
      return;
    }

    if (message.type === 'stt_force_end' && stt?.readyState === WebSocket.OPEN) {
      stt.send(JSON.stringify({ type: 'ForceEndTurn' }));
      return;
    }

    if (message.type === 'tts_speak' && tts?.readyState === WebSocket.OPEN) {
      const turnId = String(message.turnId || '').trim();
      const text = String(message.text || '').trim();
      if (!turnId || !text || recentTurnIds.includes(turnId)) return;
      if (activeTurnId === turnId) return;
      if (activeTurnId && activeTurnId !== turnId) {
        tts.send(JSON.stringify({ type: 'Interrupt' }));
        rememberTurn(activeTurnId);
      }
      activeTurnId = turnId;
      activeTurnFlushed = false;
      tts.send(JSON.stringify({ type: 'Speak', text }));
      return;
    }

    if (message.type === 'tts_flush' && tts?.readyState === WebSocket.OPEN) {
      const turnId = String(message.turnId || '').trim();
      if (!turnId || activeTurnId !== turnId || activeTurnFlushed) return;
      activeTurnFlushed = true;
      tts.send(JSON.stringify({ type: 'Flush' }));
      return;
    }

    if (message.type === 'tts_interrupt' && tts?.readyState === WebSocket.OPEN) {
      const offset = Math.max(0, Math.round(Number(message.playbackOffsetMs) || 0));
      const payload = offset > 0
        ? { type: 'Interrupt', playback_offset: { type: 'time_ms', value: offset } }
        : { type: 'Interrupt' };
      tts.send(JSON.stringify(payload));
      return;
    }
  });

  client.once('close', (code, reason) => {
    log.info('[LEXARA Realtime] Browser voice socket closed', {
      subject: ticket.subject,
      closeCode: code,
      closeReason: reason.toString('utf8') || null,
      activeTurnId,
      activeTurnFlushed,
      sttRequestId,
      ttsRequestId,
    });
    closeUpstreams();
  });
  client.once('error', error => {
    log.warn('[LEXARA Realtime] Browser voice socket error', {
      subject: ticket.subject,
      error: error.message,
      activeTurnId,
      sttRequestId,
      ttsRequestId,
    });
    closeUpstreams();
  });

  safeSendJson(client, { type: 'connected', ticketExpiresAt: ticket.expiresAt });
}

let attached = false;

export function attachLexaraRealtimeVoiceGateway(server: Server): void {
  if (attached) return;
  attached = true;

  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: CLIENT_MAX_PAYLOAD_BYTES,
  });

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    } catch {
      return;
    }

    if (url.pathname !== '/api/lexara/realtime') return;
    const ticketValue = url.searchParams.get('ticket') || '';
    const ticket = consumeTicket(ticketValue);
    if (!ticket) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }

    wss.handleUpgrade(request, socket, head, client => {
      handleRealtimeClient(client, ticket);
    });
  });

  log.info('[LEXARA Realtime] Persistent Flux duplex gateway attached');
}
