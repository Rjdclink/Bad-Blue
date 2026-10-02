import { EventEmitter } from 'node:events';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

export interface SpectraRealtimeObservationEvent {
  type: 'observation';
  investigationId: string;
  userId: string;
  observationId: string;
  payload: Record<string, unknown>;
}

type SpectraRealtimeListener = (event: SpectraRealtimeObservationEvent) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let supabase: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let bridgeStarted = false;
const recentIds = new Map<string, number>();
const RECENT_ID_TTL_MS = 60_000;
const RECENT_ID_MAX = 5_000;

function cleanupRecentIds(now = Date.now()): void {
  for (const [id, expiresAt] of recentIds) {
    if (expiresAt <= now) recentIds.delete(id);
  }
  while (recentIds.size > RECENT_ID_MAX) {
    const oldest = recentIds.keys().next().value as string | undefined;
    if (!oldest) break;
    recentIds.delete(oldest);
  }
}

function emitOnce(event: SpectraRealtimeObservationEvent): void {
  cleanupRecentIds();
  if (recentIds.has(event.observationId)) return;
  recentIds.set(event.observationId, Date.now() + RECENT_ID_TTL_MS);
  emitter.emit(event.investigationId, event);
}

function getSupabaseClient(): SupabaseClient | null {
  if (supabase) return supabase;
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(
    process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || '',
  ).trim();
  if (!/^https:\/\//i.test(url) || !key) return null;

  supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      params: { eventsPerSecond: 20 },
    },
  });
  return supabase;
}

/**
 * Starts one server-side Supabase Realtime subscription per Railway process.
 * Local writes are emitted immediately; this bridge supplies the same updates
 * across additional app replicas without polling the database.
 */
export function ensureSpectraRealtimeBridge(): void {
  if (bridgeStarted) return;
  bridgeStarted = true;

  const client = getSupabaseClient();
  if (!client) return;

  channel = client
    .channel('spectra-location-observations-server')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'spectra_location_observations',
      },
      (change: any) => {
        const row = change?.new || {};
        const investigationId = String(row.investigation_id || '').trim();
        const userId = String(row.user_id || '').trim();
        const observationId = String(row.id || '').trim();
        if (!investigationId || !userId || !observationId) return;
        emitOnce({
          type: 'observation',
          investigationId,
          userId,
          observationId,
          payload: row,
        });
      },
    )
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[SPECTRA Realtime] Supabase bridge degraded', { status });
      }
    });
}

export function publishLocalSpectraObservation(event: SpectraRealtimeObservationEvent): void {
  emitOnce(event);
}

export function subscribeSpectraInvestigation(
  investigationId: string,
  listener: SpectraRealtimeListener,
): () => void {
  ensureSpectraRealtimeBridge();
  emitter.on(investigationId, listener);
  return () => emitter.off(investigationId, listener);
}

export async function closeSpectraRealtimeBridge(): Promise<void> {
  if (channel && supabase) {
    await supabase.removeChannel(channel).catch(() => undefined);
  }
  channel = null;
  supabase = null;
  bridgeStarted = false;
}
