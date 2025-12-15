export interface PulseTraceHop {
  hopId: string;
  at: number; // epoch ms
  mirrorId: string;
  serviceName?: string;
  host?: string;
  phase: number;
  entropy: string; // base64url
  outcome?: string;
  context?: Record<string, unknown>;
}

export interface PulsePacket<TPayload = unknown> {
  id: string; // packet correlation id
  intent: string;
  payload: TPayload;
  ts: number; // epoch ms
  nonce: string; // base64url
  phase: number; // increases per hop
  ttlMs: number;
  trace: PulseTraceHop[];
  emitter?: {
    serviceName?: string;
    host?: string;
  };
}

export interface SignedPulsePacket<TPayload = unknown> {
  alg: 'hmac-sha256';
  packet: PulsePacket<TPayload>;
  sig: string; // base64url(hmac_sha256(secret, stable_json(packet)))
}

