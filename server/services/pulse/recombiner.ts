import type { SignedPulsePacket } from './types.js';

interface RecombinedState {
  packetId: string;
  firstSeenAt: number;
  lastSeenAt: number;
  fragments: SignedPulsePacket[];
}

const store = new Map<string, RecombinedState>();

export function ingestFragment(fragment: SignedPulsePacket): RecombinedState {
  const id = fragment.packet.id;
  const now = Date.now();
  const existing = store.get(id);
  if (!existing) {
    const state: RecombinedState = {
      packetId: id,
      firstSeenAt: now,
      lastSeenAt: now,
      fragments: [fragment],
    };
    store.set(id, state);
    return state;
  }
  existing.lastSeenAt = now;
  existing.fragments.push(fragment);
  if (existing.fragments.length > 200) existing.fragments = existing.fragments.slice(-200);
  return existing;
}

export function getRecombined(packetId: string): RecombinedState | null {
  return store.get(packetId) || null;
}

