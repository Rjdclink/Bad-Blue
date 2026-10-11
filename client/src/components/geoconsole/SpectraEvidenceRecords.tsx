import { useEffect, useState } from 'react';

interface EvidenceRecord {
  id: string;
  provider: string;
  title?: string;
  sourceUrl?: string;
  recordType?: string;
  observedAt?: string | null;
  sourceUpdatedAt?: string | null;
  retrievedAt: string;
  rawSha256?: string;
  contentSha256?: string;
  limitations?: string[];
  rawRecord?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

interface FeedStatus {
  id: string;
  label: string;
  status: string;
  enabled?: boolean;
  lastSuccessAt?: string | null;
  lastRecordCount?: number;
  errorCode?: string | null;
}

interface RecordResponse {
  success: boolean;
  persistenceAvailable: boolean;
  records: EvidenceRecord[];
  feeds?: FeedStatus[];
}

function displayTime(value?: string | null): string {
  if (!value) return 'Not supplied';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not supplied';
}

function sourceLink(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href : undefined;
  } catch { return undefined; }
}

export function SpectraEvidenceRecords({ sessionId, refreshKey }: { sessionId: string | null; refreshKey?: string }) {
  const [scope, setScope] = useState<'session' | 'public'>('public');
  const [records, setRecords] = useState<EvidenceRecord[]>([]);
  const [feeds, setFeeds] = useState<FeedStatus[]>([]);
  const [provider, setProvider] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { setScope(sessionId ? 'session' : 'public'); }, [sessionId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setRecords([]);
    setFeeds([]);
    setError('');
    setLoading(true);
    const load = async () => {
      if (scope === 'session' && !sessionId) { setLoading(false); return; }
      const url = scope === 'session'
        ? `/api/spectra/sessions/${encodeURIComponent(sessionId!)}/records`
        : `/api/spectra/public-records?limit=25${provider ? `&provider=${encodeURIComponent(provider)}` : ''}`;
      try {
        const response = await fetch(url, { credentials: 'include', signal: controller.signal, cache: 'no-store' });
        const result = await response.json() as RecordResponse;
        if (controller.signal.aborted) return;
        if (!response.ok || !result.success || !result.persistenceAvailable) {
          throw new Error('Saved records are temporarily unavailable.');
        }
        setRecords(Array.isArray(result.records) ? result.records : []);
        setFeeds(Array.isArray(result.feeds) ? result.feeds : []);
        setError('');
      } catch {
        if (!controller.signal.aborted) setError('Saved records are temporarily unavailable. Displayed records may be stale.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(() => void load(), 60_000);
        }
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [scope, sessionId, refreshKey, provider]);

  return <details className="border-b border-slate-800 px-4 py-2 text-xs text-slate-300" data-testid="spectra-evidence-records">
    <summary className="cursor-pointer font-medium text-cyan-200">Collected records{records.length ? ` (${records.length} shown)` : ''}</summary>
    <div className="mt-2 flex gap-3" role="group" aria-label="Record collection">
      <button type="button" disabled={!sessionId} aria-pressed={scope === 'session'} onClick={() => setScope('session')}
        className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40 aria-pressed:border-cyan-400">This investigation</button>
      <button type="button" aria-pressed={scope === 'public'} onClick={() => setScope('public')}
        className="rounded border border-slate-700 px-2 py-1 aria-pressed:border-cyan-400">Public geographic feeds</button>
    </div>
    {scope === 'public' && <label className="mt-2 block">Source
      <select aria-label="Public feed source" value={provider} onChange={event => setProvider(event.target.value)}
        className="ml-2 max-w-full rounded border border-slate-700 bg-slate-950 p-1">
        <option value="">All sources</option>
        <option value="usgs-earthquakes">USGS earthquakes</option>
        <option value="nasa-eonet">NASA EONET events</option>
        <option value="nws-alerts">NWS alerts</option>
      </select>
    </label>}
    <p className="mt-2 text-[11px] text-slate-400">{scope === 'public'
      ? 'Automatic collection of public events and affected areas. These records do not establish a person’s location.'
      : 'Retrieved documents and geographic context retained from this investigation. Open a record to inspect the saved content.'}</p>
    {error && <p role="status" className="mt-2 text-amber-300">{error}</p>}
    {loading && <p className="mt-2">Loading saved records…</p>}
    <div className="mt-2 max-h-72 overflow-y-auto space-y-2">
      {feeds.map(feed => <p key={feed.id} className="text-[11px]">
        <strong>{feed.label}</strong>: {feed.status.replace(/_/g, ' ')}
        {feed.enabled === false && <> · Automatic collection disabled</>}
        {feed.lastSuccessAt && <> · Last successful check {displayTime(feed.lastSuccessAt)}</>}
        {feed.errorCode && <> · {feed.errorCode.replace(/_/g, ' ').toLowerCase()}</>}
      </p>)}
      {!loading && !error && !records.length && <p>No saved records are available for this selection yet.</p>}
      {records.map(record => {
        const link = sourceLink(record.sourceUrl);
        const title = record.title || String(record.payload?.title || record.recordType?.replace(/_/g, ' ') || record.provider);
        return <details key={record.id} className="rounded border border-slate-800 p-2">
          <summary className="cursor-pointer break-words">{title}</summary>
          <p className="mt-2">Source: {record.provider}</p>
          <p>Downloaded: {displayTime(record.retrievedAt)}</p>
          {record.payload?.snapshotKind === 'extracted_document' && <p className="mt-1 text-slate-400">Saved text and metadata extracted from the document.</p>}
          {record.payload?.structuredRecordOmitted === true && <p className="mt-1 text-amber-200">The source JSON exceeded the archive size limit. Only this retrieval’s metadata or extracted content was retained.</p>}
          {record.observedAt && <p>Source event time: {displayTime(record.observedAt)}</p>}
          {record.sourceUpdatedAt && <p>Source update: {displayTime(record.sourceUpdatedAt)}</p>}
          {link && <a className="underline text-cyan-300" href={link} target="_blank" rel="noopener noreferrer">Open original source</a>}
          {(record.limitations || []).map(note => <p key={note} className="mt-1 text-amber-200">{note}</p>)}
          <p className="mt-2 break-all text-[10px] text-slate-500">SHA-256: {record.rawSha256 || record.contentSha256 || 'Unavailable'}</p>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words text-[10px] text-slate-300">{JSON.stringify(record.rawRecord || record.payload || {}, null, 2)}</pre>
        </details>;
      })}
    </div>
  </details>;
}
