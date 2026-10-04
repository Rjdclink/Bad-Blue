import {
  findSpectraPublicGtfsRealtimeFeeds,
  type SpectraPublicFeedRecord,
} from './SpectraPublicFeedRegistry';
import {
  fetchSpectraGtfsRealtimeVehiclePositions,
  type SpectraGtfsVehiclePosition,
} from './SpectraGtfsRealtimeContext';

export interface SpectraPublicMobilityContext {
  feeds: SpectraPublicFeedRecord[];
  vehicles: SpectraGtfsVehiclePosition[];
}

function haversineMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const radius = 6_371_008.8;
  const phi1 = latitudeA * Math.PI / 180;
  const phi2 = latitudeB * Math.PI / 180;
  const deltaPhi = (latitudeB - latitudeA) * Math.PI / 180;
  const deltaLambda = (longitudeB - longitudeA) * Math.PI / 180;
  const a =
    Math.sin(deltaPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

export async function acquireSpectraPublicMobilityContext(
  latitude: number,
  longitude: number,
  radiusMeters = 25_000,
): Promise<SpectraPublicMobilityContext> {
  if (
    !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90
    || longitude < -180 || longitude > 180
  ) {
    return { feeds: [], vehicles: [] };
  }

  const boundedRadius = Math.max(1_000, Math.min(100_000, radiusMeters));
  const feeds = await findSpectraPublicGtfsRealtimeFeeds(latitude, longitude, 12);
  const boundedFeeds = feeds.slice(0, 6);

  const outcomes = await Promise.allSettled(
    boundedFeeds.map(feed =>
      fetchSpectraGtfsRealtimeVehiclePositions(feed, 500)
    ),
  );

  const vehicles = outcomes
    .flatMap(outcome =>
      outcome.status === 'fulfilled' ? outcome.value : []
    )
    .filter(vehicle =>
      haversineMeters(
        latitude,
        longitude,
        vehicle.latitude,
        vehicle.longitude,
      ) <= boundedRadius
    );

  const seen = new Set<string>();
  return {
    feeds: boundedFeeds,
    vehicles: vehicles.filter(vehicle => {
      const key = [
        vehicle.feedId,
        vehicle.vehicleId || vehicle.vehicleLabel || '',
        vehicle.tripId || '',
        vehicle.timestamp || '',
        vehicle.latitude.toFixed(5),
        vehicle.longitude.toFixed(5),
      ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 1_000),
  };
}
