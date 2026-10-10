/**
 * Keep independently published, broadly geocoded city context separate from
 * coordinates in individual historical files and from live telemetry.
 * Presence of a photo geotag must never hide a separately supported city.
 */
import {
  inferCorroboratedRegionalCity,
  type RegionalSourceExcerpt,
} from './SpectraRegionalInference';

export interface SpectraRegionalGeocode {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  displayName: string;
}

export interface SpectraRegionalContextCandidate {
  latitude: number;
  longitude: number;
  label: string;
  confidence: number;
  basis: 'regional_context';
  accuracyMeters: number;
}

interface SpectraRegionalContextInput {
  subject: string;
  sources: readonly RegionalSourceExcerpt[];
  locationInputs: readonly string[];
  hasLocationObservations: boolean;
  geocodeCorroboratedCity: (cityState: string) => Promise<SpectraRegionalGeocode | null>;
  geocodeSuppliedClue: (clue: string) => Promise<SpectraRegionalGeocode | null>;
  asOf?: Date;
}

function validGeocode(value: SpectraRegionalGeocode | null): value is SpectraRegionalGeocode {
  return Boolean(
    value &&
    Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180
  );
}

function cityRadiusMeters(value: SpectraRegionalGeocode): number {
  const radius = Number(value.accuracyMeters);
  return Number.isFinite(radius) && radius > 0
    ? Math.max(1_000, radius) : 25_000;
}

function clueRadiusMeters(value: SpectraRegionalGeocode): number {
  const radius = Number(value.accuracyMeters);
  return Number.isFinite(radius) && radius > 0
    ? Math.max(1_000, radius) : 25_000;
}

/**
 * A corroborated public city is independently meaningful even when another
 * evidence stream contains historical photo, video, or location observations.
 * A user-provided geographic hint remains fallback search context only when
 * the location-observation stream is empty.
 */
export async function resolveSpectraRegionalContextCandidates(
  input: SpectraRegionalContextInput,
): Promise<SpectraRegionalContextCandidate[]> {
  const city = inferCorroboratedRegionalCity(input.subject, input.sources, input.asOf);
  if (city) {
    try {
      const location = await input.geocodeCorroboratedCity(`${city.city}, ${city.state}`);
      if (validGeocode(location)) {
        return [{
          latitude: location.latitude,
          longitude: location.longitude,
          label: `${city.city}, ${city.state} (corroborated public residence; not a live location)`,
          confidence: 0.35,
          basis: 'regional_context',
          accuracyMeters: cityRadiusMeters(location),
        }];
      }
    } catch {
      // An unavailable geocoder must not manufacture coordinates.
    }
  }

  if (input.hasLocationObservations) return [];

  for (const hint of input.locationInputs) {
    if (typeof hint !== 'string' || !hint.trim()) continue;
    try {
      const location = await input.geocodeSuppliedClue(hint);
      if (validGeocode(location)) {
        return [{
          latitude: location.latitude,
          longitude: location.longitude,
          label: `${location.displayName} (supplied search clue; current city not verified)`,
          confidence: 0.05,
          basis: 'regional_context',
          accuracyMeters: clueRadiusMeters(location),
        }];
      }
    } catch {
      // Try the next supplied geographic context clue.
    }
  }
  return [];
}
