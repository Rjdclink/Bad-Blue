import crypto from 'crypto';
import type { PulsePacket, SignedPulsePacket } from './types.js';

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: any): any => {
    if (v === null) return null;
    const t = typeof v;
    if (t === 'number' || t === 'boolean' || t === 'string') return v;
    if (t === 'bigint') return v.toString();
    if (t !== 'object') return null;
    if (Array.isArray(v)) return v.map(walk);
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    const keys = Object.keys(v).sort();
    const out: Record<string, any> = {};
    for (const k of keys) {
      const val = v[k];
      if (val === undefined) continue;
      out[k] = walk(val);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

export function base64url(bytes: Buffer): string {
  return bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function randomB64url(bytes = 16): string {
  return base64url(crypto.randomBytes(bytes));
}

export function signPacket(packet: PulsePacket, secret: string): SignedPulsePacket {
  const payload = stableStringify(packet);
  const sig = base64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return { alg: 'hmac-sha256', packet, sig };
}

export function verifySignedPacket(signed: SignedPulsePacket, secret: string): boolean {
  if (!signed || signed.alg !== 'hmac-sha256' || !signed.packet || !signed.sig) return false;
  const expected = signPacket(signed.packet, secret).sig;
  // constant-time compare
  const a = Buffer.from(signed.sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

