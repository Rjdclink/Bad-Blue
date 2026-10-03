import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

export interface SpectraRealtimeObservationRow {
  id?: string;
  user_id?: string | null;
  session_id: string;
  subject_label?: string | null;
  source_type: string;
  provider?: string | null;
  latitude: number;
  longitude: number;
  altitude?: number | null;
  accuracy_meters?: number | null;
  confidence: number;
  observation_kind: string;
  evidence_class?: string | null;
  subject_match_confidence?: number | null;
  timestamp_confidence?: number | null;
  acquisition_method?: string | null;
  source_url?: string | null;
  observed_at: string;
  received_at: string;
  correlation_group?: string | null;
  provenance?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

type Listener = (row: SpectraRealtimeObservationRow) => void;

interface SessionSubscription {
  channel: RealtimeChannel;
  listeners: Set<Listener>;
}

let client: SupabaseClient | null | undefined;
const subscriptions = new Map<string, SessionSubscription>();

function getRealtimeClient(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(
    process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || ''
  ).trim();

  if (!url || !key || !/^https:\/\//i.test(url)) {
    client = null;
    return client;
  }

  try {
    client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: {
        params: { eventsPerSecond: 20 },
      },
    });
  } catch {
    client = null;
  }

  return client;
}

export function spectraRealtimeBridgeConfigured(): boolean {
  return getRealtimeClient() !== null;
}

export function subscribeSpectraDatabaseObservations(
  sessionId: string,
  listener: Listener,
): () => void {
  const normalizedSessionId = sessionId.trim();
  const realtime = getRealtimeClient();
  if (!normalizedSessionId || !realtime) return () => undefined;

  let entry = subscriptions.get(normalizedSessionId);
  if (!entry) {
    const listeners = new Set<Listener>();
    const channelName = `spectra-observations:${Buffer.from(normalizedSessionId).toString('base64url').slice(0, 80)}`;
    const channel = realtime
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'spectra_location_observations',
          filter: `session_id=eq.${normalizedSessionId}`,
        },
        payload => {
          const row = payload.new as SpectraRealtimeObservationRow;
          for (const subscriber of [...listeners]) {
            try {
              subscriber(row);
            } catch {
              // One SSE subscriber must never break the shared Realtime channel.
            }
          }
        },
      );

    void channel.subscribe();
    entry = { channel, listeners };
    subscriptions.set(normalizedSessionId, entry);
  }

  entry.listeners.add(listener);

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;

    const current = subscriptions.get(normalizedSessionId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;

    subscriptions.delete(normalizedSessionId);
    void getRealtimeClient()?.removeChannel(current.channel);
  };
}
