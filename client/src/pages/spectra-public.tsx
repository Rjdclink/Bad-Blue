/**
 * Public, read-only SPECTRA map.
 *
 * This route makes the general map available without a login, subscription,
 * browser geolocation or access to stored investigations. Person-specific
 * acquisition, telemetry and saved records retain their server-side access
 * checks; no public handler receives an investigation session identifier.
 */
import { useState } from 'react';
import { SEOHead } from '@/components/SEOHead';
import MapLibreIntelligenceMap, {
  type IntelligenceLayerState,
  type IntelligenceMapMode,
} from '@/components/geoconsole/MapLibreIntelligenceMap';
import type { GeoFrame } from '@/hooks/useGeoRuntime';

const NO_OBSERVATIONS: GeoFrame[] = [];

const PUBLIC_LAYERS: IntelligenceLayerState = {
  satellite: true,
  earthObservation: false,
  trail: false,
  heatmap: false,
  markers: false,
  futurecast: false,
  reticle: false,
  weather: false,
  terrain: false,
  buildings: false,
  uncertainty: false,
  streetImagery: false,
};

export default function SpectraPublicPage() {
  const [mapMode, setMapMode] = useState<IntelligenceMapMode>('street');

  return (
    <main className="flex h-[100dvh] min-h-[420px] flex-col bg-slate-950 text-white">
      <SEOHead
        title="SPECTRA Map | LegalWhat"
        description="Explore the general SPECTRA map without an account."
      />
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950 px-4 py-3">
        <div>
          <h1 className="text-base font-semibold tracking-wide text-cyan-300">SPECTRA</h1>
          <p className="text-xs text-slate-400">General map explorer</p>
        </div>
        <div className="flex flex-wrap gap-1" aria-label="Map style">
          {(['street', 'satellite', 'hybrid', 'dark'] as IntelligenceMapMode[]).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setMapMode(mode)}
              aria-pressed={mapMode === mode}
              className={`rounded-md border px-3 py-2 text-xs capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                mapMode === mode
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </header>
      <section
        className="relative min-h-0 flex-1"
        aria-label="Interactive general map"
      >
        <MapLibreIntelligenceMap
          currentFrame={null}
          trail={NO_OBSERVATIONS}
          futurecast={NO_OBSERVATIONS}
          mapMode={mapMode}
          layers={PUBLIC_LAYERS}
          isLive={false}
          lockOnTarget={false}
        />
      </section>
      <p className="border-t border-slate-800 px-4 py-2 text-xs text-slate-400">
        Public map only. No device location is requested and no personal investigation data is displayed.
      </p>
    </main>
  );
}
