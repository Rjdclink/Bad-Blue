import type { IntelligenceLayerState } from './MapLibreIntelligenceMap';

/** Spectra keeps its evidence overlays on a street basemap. */
export function spectraStreetLayers(layers: IntelligenceLayerState): IntelligenceLayerState {
  return {
    ...layers,
    satellite: false,
    earthObservation: false,
    weather: false,
    terrain: false,
    buildings: false,
    streetImagery: false,
  };
}
