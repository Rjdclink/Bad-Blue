import maplibregl, {
  Map as MapLibreMap,
  NavigationControl as MapLibreNavigationControl,
  Popup as MapLibrePopup,
  ScaleControl as MapLibreScaleControl,
  type MapOptions as MapLibreMapOptions,
} from 'maplibre-gl';

export type GeoconsoleRendererId = 'maplibre' | 'mapbox-global' | (string & {});

export interface GeoconsoleMapRendererAdapter {
  id: GeoconsoleRendererId;
  label: string;
  available(): boolean;
  createMap(options: MapLibreMapOptions): MapLibreMap;
  createNavigationControl(options?: Record<string, unknown>): any;
  createScaleControl(options?: Record<string, unknown>): any;
  createPopup(options?: Record<string, unknown>): any;
}

const mapLibreAdapter: GeoconsoleMapRendererAdapter = {
  id: 'maplibre',
  label: 'MapLibre GL',
  available: () => true,
  createMap: options => new MapLibreMap(options),
  createNavigationControl: options => new MapLibreNavigationControl(options as any),
  createScaleControl: options => new MapLibreScaleControl(options as any),
  createPopup: options => new MapLibrePopup(options as any),
};

function globalMapboxRuntime(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).mapboxgl || null;
}

const mapboxGlobalAdapter: GeoconsoleMapRendererAdapter = {
  id: 'mapbox-global',
  label: 'Mapbox GL global runtime',
  available: () => Boolean(globalMapboxRuntime()?.Map),
  createMap: options => {
    const runtime = globalMapboxRuntime();
    if (!runtime?.Map) throw new Error('Mapbox GL global runtime is not available.');

    const token = String(import.meta.env?.VITE_MAPBOX_ACCESS_TOKEN || '').trim();
    if (token && 'accessToken' in runtime) runtime.accessToken = token;
    return new runtime.Map(options) as MapLibreMap;
  },
  createNavigationControl: options => {
    const runtime = globalMapboxRuntime();
    if (!runtime?.NavigationControl) {
      throw new Error('Mapbox NavigationControl is unavailable.');
    }
    return new runtime.NavigationControl(options);
  },
  createScaleControl: options => {
    const runtime = globalMapboxRuntime();
    if (!runtime?.ScaleControl) throw new Error('Mapbox ScaleControl is unavailable.');
    return new runtime.ScaleControl(options);
  },
  createPopup: options => {
    const runtime = globalMapboxRuntime();
    if (!runtime?.Popup) throw new Error('Mapbox Popup is unavailable.');
    return new runtime.Popup(options);
  },
};

const adapters = new Map<string, GeoconsoleMapRendererAdapter>([
  ['maplibre', mapLibreAdapter],
  ['mapbox-global', mapboxGlobalAdapter],
]);

export function registerGeoconsoleMapRenderer(
  adapter: GeoconsoleMapRendererAdapter,
): () => void {
  const id = String(adapter.id || '').trim();
  if (!id) throw new Error('Map renderer adapter ID is required.');
  if (id === 'maplibre') throw new Error('The canonical MapLibre adapter cannot be replaced.');
  adapters.set(id, adapter);
  return () => {
    if (adapters.get(id) === adapter) adapters.delete(id);
  };
}

export function getConfiguredGeoconsoleRendererId(): GeoconsoleRendererId {
  const configured = String(import.meta.env?.VITE_MAP_RENDERER || 'maplibre')
    .trim()
    .toLowerCase();

  if (configured === 'mapbox') return 'mapbox-global';
  return adapters.has(configured) ? configured : 'maplibre';
}

export function resolveGeoconsoleMapRenderer(): {
  requested: GeoconsoleRendererId;
  active: GeoconsoleRendererId;
  adapter: GeoconsoleMapRendererAdapter;
  fallbackApplied: boolean;
} {
  const requested = getConfiguredGeoconsoleRendererId();
  const requestedAdapter = adapters.get(requested) || mapLibreAdapter;
  if (requestedAdapter.available()) {
    return {
      requested,
      active: requested,
      adapter: requestedAdapter,
      fallbackApplied: false,
    };
  }

  return {
    requested,
    active: 'maplibre',
    adapter: mapLibreAdapter,
    fallbackApplied: requested !== 'maplibre',
  };
}

export function getGeoconsoleRendererCapabilities() {
  return [...adapters.values()].map(adapter => ({
    id: adapter.id,
    label: adapter.label,
    available: adapter.available(),
  }));
}
