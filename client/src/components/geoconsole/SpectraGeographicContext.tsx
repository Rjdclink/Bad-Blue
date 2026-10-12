import type { ReactNode } from 'react';

export interface SpectraPhotoScene {
  imageUrl: string;
  sourcePostUrl: string;
  sourcePlatform: string;
  contentSha256: string;
  capturedAt: string | null;
  captureGps: { latitude: number; longitude: number } | null;
  recencyWeight: number;
  ageDays: number | null;
  priorityBand: 'recent_scene' | 'historical_scene' | 'undated_scene' | 'no_geotag';
  currentPositionVerified: false;
  subjectPresenceVerified: false;
}

export interface SpectraGeographicContextEvidence {
  anchor?: { latitude: number; longitude: number; basis: 'timestamped_observation' | 'regional_candidate';
    observedAt?: string };
  places: Array<{ id?: string; name?: string; provider?: string }>;
  cameras: Array<{ id?: string; name?: string; provider?: string; observedAt?: string;
    latitude: number; longitude: number; imageUrl?: string; status?: { qualityWarning?: boolean } }>;
  geotaggedMedia: Array<{ id?: string; title?: string; provider?: string; capturedAt?: string;
    latitude: number; longitude: number; pageUrl?: string }>;
  weather?: { provider?: string; stationId?: string; stationName?: string;
    observedAt?: string; textDescription?: string; temperatureC?: number | null };
  earthObservation: Array<{ id?: string; provider?: string; observedAt?: string;
    cloudCover?: number | null; platform?: string; links?: Array<{ rel?: string; href?: string }> }>;
  sourceFamilies: string[];
}

function timestamp(value?: string): string {
  if (!value) return 'Source time unknown';
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : 'Source time unknown';
}

function isStale(value?: string, hours = 24): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && Date.now() - time > hours * 3_600_000;
}

function publicLink(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined;
  } catch { return undefined; }
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return <details className="mt-2 rounded border border-slate-800 p-2">
    <summary className="cursor-pointer text-cyan-200">{title} ({count})</summary>
    {children}
  </details>;
}

/** Public geographic context describes cameras, weather stations, scenes and satellite acquisitions.
 * It never identifies who was present at the place or implies current subject location. */
export function SpectraGeographicContext({ value, photoScenes = [] }: {
  value: SpectraGeographicContextEvidence | null; photoScenes?: SpectraPhotoScene[];
}) {
  if (!value?.anchor && !photoScenes.length) return null;
  const cameras = value?.cameras || [];
  const media = value?.geotaggedMedia || [];
  const satellite = value?.earthObservation || [];
  const weather = value?.weather;
  return <details className="mt-2 text-xs text-slate-300" data-testid="spectra-geographic-context">
    <summary className="cursor-pointer font-medium">
      Public geographic context · {cameras.length} cameras · {satellite.length} satellite records
      {weather ? ' · weather available' : ' · weather unavailable'} · {photoScenes.length} inspected photo scenes
    </summary>
    <p className="mt-1 text-amber-200">
      These records describe an area, public cameras, media capture scenes and satellite acquisitions.
      They are not sightings or measurements of the investigated person.
    </p>
    <p className="mt-1 text-slate-400">
      {value?.anchor
        ? value.anchor.basis === 'regional_candidate'
          ? 'Context anchor: provisional regional estimate.'
          : 'Context anchor: dated location observation.'
        : 'No regional context anchor available.'}
      {' '}Nearby places indexed: {value?.places?.length || 0}.
    </p>
    <Section title="Photograph capture scenes (not a person's location)" count={photoScenes.length}>
      <div className="mt-2 max-h-44 space-y-2 overflow-auto">
        {photoScenes.length === 0 && <p>No images with inspectable source metadata were returned.</p>}
        {photoScenes.slice(0, 24).map(scene => <p key={scene.contentSha256}>
          <strong>{scene.sourcePlatform}</strong> · {scene.priorityBand.replace(/_/g, ' ')}
          {scene.capturedAt ? ' · captured ' + timestamp(scene.capturedAt)
            : ' · original capture time unknown'}
          {scene.captureGps
            ? ' · GPS capture coordinates available'
            : ' · capture GPS absent'}
          {' · '}<a href={scene.sourcePostUrl} target="_blank" rel="noopener noreferrer"
            className="underline">Public post</a>
        </p>)}
      </div>
      <p className="mt-1 text-slate-400">
        Dated and geotagged photo scenes are shown first. Recency weight describes a
        photograph's age, not evidence that a person visited or currently occupies its capture site.
      </p>
    </Section>
    <Section title="Public cameras" count={cameras.length}>
      <div className="mt-2 max-h-44 space-y-2 overflow-auto">
        {cameras.length === 0 && <p>No camera records were returned by configured or available feeds.</p>}
        {cameras.slice(0, 30).map((camera, index) => <p key={(camera.provider || '') + ':' + (camera.id || index)}>
          <strong>{camera.name || 'Public camera'}</strong> · {camera.provider || 'Unknown provider'} ·
          {' '}{timestamp(camera.observedAt)}
          {isStale(camera.observedAt) && ' · old image/feed timestamp'}
          {camera.status?.qualityWarning && ' · quality warning'}
          {publicLink(camera.imageUrl) && <> · <a href={publicLink(camera.imageUrl)} target="_blank" rel="noopener noreferrer" className="underline">Image source</a></>}
        </p>)}
        {cameras.length > 30 && <p>Showing 30 of {cameras.length} camera records.</p>}
      </div>
    </Section>
    <Section title="Environmental observations" count={weather ? 1 : 0}>
      <div className="mt-2">
        {weather ? <p>
          National Weather Service · {weather.stationName || weather.stationId || 'Weather station'} ·
          {' '}{timestamp(weather.observedAt)}
          {isStale(weather.observedAt) && ' · historical observation'}
          {weather.textDescription ? ' · ' + weather.textDescription : ''}
          {typeof weather.temperatureC === 'number' ? ' · ' + weather.temperatureC.toFixed(1) + ' °C' : ''}
        </p> : <p>No observation was returned for this area and acquisition window.</p>}
      </div>
    </Section>
    <Section title="Satellite acquisitions" count={satellite.length}>
      <div className="mt-2 max-h-44 space-y-2 overflow-auto">
        {satellite.length === 0 && <p>No matching Copernicus acquisition was returned for the search window.</p>}
        {satellite.slice(0, 20).map((item, index) => <p key={String(item.id || index)}>
          <strong>{item.platform || item.provider || 'Copernicus'}</strong> ·
          {' '}Acquired {timestamp(item.observedAt)}
          {typeof item.cloudCover === 'number' && Number.isFinite(item.cloudCover)
            ? ' · cloud cover ' + item.cloudCover.toFixed(0) + '%' : ''}
          {publicLink(item.links?.find(link => link.rel === 'preview')?.href)
            && <> · <a href={publicLink(item.links?.find(link => link.rel === 'preview')?.href)} target="_blank" rel="noopener noreferrer" className="underline">Preview</a></>}
        </p>)}
      </div>
    </Section>
    <Section title="Public geotagged media scenes" count={media.length}>
      <div className="mt-2 max-h-44 space-y-2 overflow-auto">
        {media.length === 0 && <p>No independently catalogued geographic media returned.</p>}
        {media.slice(0, 20).map((item, index) => <p key={(item.provider || '') + ':' + (item.id || index)}>
          <strong>{item.title || 'Public image'}</strong> · {item.provider || 'Media source'} ·
          {' '}Capture {timestamp(item.capturedAt)}
          {publicLink(item.pageUrl) && <> · <a href={publicLink(item.pageUrl)} target="_blank" rel="noopener noreferrer" className="underline">Source</a></>}
        </p>)}
      </div>
    </Section>
  </details>;
}
