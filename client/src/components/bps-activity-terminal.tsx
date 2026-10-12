import { useEffect, useRef, useState } from 'react';
import type { BpsActivitySnapshot } from '@shared/bps-activity';
import { getInternalAuthHeaders } from '@/lib/queryClient';

const formatBps = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(6).replace(/\.?0+$/, '')} BPS`;

export default function BpsActivityTerminal({ running = false }: { running?: boolean }) {
  const [snapshot, setSnapshot] = useState<BpsActivitySnapshot | null>(null);
  const [error, setError] = useState(false);
  const [follow, setFollow] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch('/api/crypto/bps-activity', {
          credentials: 'include', headers: getInternalAuthHeaders(), signal: controller.signal,
        });
        if (!response.ok) throw new Error('BPS activity unavailable');
        const data = await response.json() as BpsActivitySnapshot;
        if (!stopped) { setSnapshot(data); setError(false); }
        if (!data.running) stopped = true;
      } catch {
        if (!stopped) setError(true);
      } finally {
        if (!stopped) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [running]);
  useEffect(() => {
    if (follow && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [snapshot, follow]);

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 p-3" aria-label="BPS reduction activity">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">BPS reduction terminal</h2>
        <button type="button" onClick={() => setFollow(value => !value)} aria-pressed={follow}
          className="rounded border border-white/20 px-3 py-1 text-xs text-gray-200">
          {follow ? 'Pause scrolling' : 'Follow latest'}
        </button>
      </div>
      <p className="mb-3 text-xs text-gray-400">
        {!running ? 'System off — polling stopped.' : error ? 'Connection interrupted — showing last received activity.' : !snapshot ? 'Loading measured activity…' : snapshot.running ? 'Live measured quote comparisons' : 'System off — waiting for measured activity.'}
        {' '}Latest {snapshot?.capacity ?? 300} measurements. +5 BPS goal. Quotes are not completed trades.
      </p>
      <div ref={viewport} className="h-64 overflow-auto font-mono text-[10px] sm:text-xs" tabIndex={0} role="region" aria-label="Scrolling BPS measurements">
        <table className="w-full min-w-[480px] text-left">
          <thead className="sticky top-0 bg-gray-950 text-gray-400">
            <tr><th className="p-2">Time / Asset</th><th className="p-2 text-right">Starting BPS</th><th className="p-2 text-right">Measured BPS</th><th className="p-2">Result</th></tr>
          </thead>
          <tbody>
            {snapshot?.rows.map(row => (
              <tr key={row.sequence} title={row.opportunityId} className="border-t border-white/5">
                <td className="p-2 text-gray-200">{new Date(row.observedAt).toLocaleTimeString()} {row.asset}</td>
                <td className="p-2 text-right text-gray-300">{formatBps(row.beforeBps)}</td>
                <td className={`p-2 text-right ${row.afterBps > 0 ? 'text-green-400' : 'text-orange-300'}`}>→ {formatBps(row.afterBps)}</td>
                <td className="p-2 text-gray-400">{row.improved ? 'Improved' : 'No improvement'} · {row.stage}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!snapshot?.rows.length && <p className="p-3 text-gray-500">No measured BPS activity yet.</p>}
      </div>
    </section>
  );
}
