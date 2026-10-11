import type { StyleSpecification } from 'maplibre-gl';

// NASA Worldview and this map use the same GIBS imagery service. Blue Marble
// is the cloud-free August 2004 composite, not a live satellite observation.
// https://github.com/nasa-gibs/worldview/tree/main/config/default/common/config/metadata/layers/reference/blue_marble
export const NASA_BASEMAP = {
  tiles: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
  maxNativeZoom: 8,
  attribution: '<a href="https://www.earthdata.nasa.gov/centers/gibs-daac">NASA GIBS</a> / Blue Marble, August 2004',
  label: 'NASA Blue Marble · August 2004 composite',
};

export const SATELLITE_FALLBACK = {
  tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  maxNativeZoom: 19,
  attribution: 'Tiles © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  label: 'Satellite imagery · dates vary',
};

export const PLACE_LABELS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

export function satelliteBasemap(customTiles?: string, customAttribution?: string) {
  return customTiles ? {
    tiles: customTiles,
    maxNativeZoom: 19,
    attribution: customAttribution || 'Satellite imagery',
    label: 'Satellite imagery · dates vary',
  } : NASA_BASEMAP;
}

export function satelliteStyle(base = NASA_BASEMAP): StyleSpecification {
  return {
    version: 8,
    sources: {
      'spectra-satellite': {
        type: 'raster', tiles: [base.tiles], tileSize: 256,
        maxzoom: base.maxNativeZoom, attribution: base.attribution,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#132235' } },
      { id: 'spectra-satellite', type: 'raster', source: 'spectra-satellite', paint: { 'raster-opacity': 1 } },
    ],
  };
}

/** A cancellable deadline shared by startup, style swaps and context recovery. */
export function mapDeadline(onTimeout: () => void, delayMs = 10_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  return {
    cancel,
    isPending: () => timer !== undefined,
    arm() {
      cancel();
      timer = setTimeout(() => { timer = undefined; onTimeout(); }, delayMs);
    },
  };
}
