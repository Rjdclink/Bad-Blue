import type { SpectraPublicFeedRecord } from './SpectraPublicFeedRegistry';

export interface SpectraGtfsVehiclePosition {
  feedId: string;
  provider: string;
  vehicleId?: string;
  vehicleLabel?: string;
  tripId?: string;
  routeId?: string;
  latitude: number;
  longitude: number;
  bearing?: number;
  speedMps?: number;
  timestamp?: string;
  sourceUrl: string;
  contextOnly: true;
}

class ProtobufReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  readVarint(): number {
    let value = 0;
    let shift = 0;
    while (this.offset < this.bytes.length && shift < 56) {
      const byte = this.bytes[this.offset++];
      value += (byte & 0x7f) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
    throw new Error('Invalid protobuf varint');
  }

  readTag(): { field: number; wire: number } {
    const tag = this.readVarint();
    return { field: tag >>> 3, wire: tag & 7 };
  }

  readBytes(): Uint8Array {
    const length = this.readVarint();
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error('Invalid protobuf length');
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readString(): string {
    return new TextDecoder().decode(this.readBytes());
  }

  readFloat32(): number {
    if (this.offset + 4 > this.bytes.length) throw new Error('Invalid protobuf float');
    const view = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + this.offset,
      4,
    );
    const value = view.getFloat32(0, true);
    this.offset += 4;
    return value;
  }

  readFloat64(): number {
    if (this.offset + 8 > this.bytes.length) throw new Error('Invalid protobuf double');
    const view = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + this.offset,
      8,
    );
    const value = view.getFloat64(0, true);
    this.offset += 8;
    return value;
  }

  skip(wire: number): void {
    switch (wire) {
      case 0:
        this.readVarint();
        return;
      case 1:
        this.offset = Math.min(this.bytes.length, this.offset + 8);
        return;
      case 2: {
        const length = this.readVarint();
        this.offset = Math.min(this.bytes.length, this.offset + length);
        return;
      }
      case 5:
        this.offset = Math.min(this.bytes.length, this.offset + 4);
        return;
      default:
        throw new Error('Unsupported protobuf wire type');
    }
  }
}

function parseTripDescriptor(bytes: Uint8Array): { tripId?: string; routeId?: string } {
  const reader = new ProtobufReader(bytes);
  const result: { tripId?: string; routeId?: string } = {};
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1 && wire === 2) result.tripId = reader.readString();
    else if (field === 5 && wire === 2) result.routeId = reader.readString();
    else reader.skip(wire);
  }
  return result;
}

function parseVehicleDescriptor(bytes: Uint8Array): { id?: string; label?: string } {
  const reader = new ProtobufReader(bytes);
  const result: { id?: string; label?: string } = {};
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1 && wire === 2) result.id = reader.readString();
    else if (field === 2 && wire === 2) result.label = reader.readString();
    else reader.skip(wire);
  }
  return result;
}

function parsePosition(bytes: Uint8Array): {
  latitude?: number;
  longitude?: number;
  bearing?: number;
  speed?: number;
} {
  const reader = new ProtobufReader(bytes);
  const result: {
    latitude?: number;
    longitude?: number;
    bearing?: number;
    speed?: number;
  } = {};
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1 && wire === 5) result.latitude = reader.readFloat32();
    else if (field === 2 && wire === 5) result.longitude = reader.readFloat32();
    else if (field === 3 && wire === 5) result.bearing = reader.readFloat32();
    else if (field === 5 && wire === 5) result.speed = reader.readFloat32();
    else reader.skip(wire);
  }
  return result;
}

function parseVehiclePosition(
  bytes: Uint8Array,
  feed: SpectraPublicFeedRecord,
): SpectraGtfsVehiclePosition | null {
  const reader = new ProtobufReader(bytes);
  let tripId: string | undefined;
  let routeId: string | undefined;
  let vehicleId: string | undefined;
  let vehicleLabel: string | undefined;
  let latitude: number | undefined;
  let longitude: number | undefined;
  let bearing: number | undefined;
  let speedMps: number | undefined;
  let timestampSeconds: number | undefined;

  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1 && wire === 2) {
      const trip = parseTripDescriptor(reader.readBytes());
      tripId = trip.tripId;
      routeId = trip.routeId;
    } else if (field === 2 && wire === 2) {
      const position = parsePosition(reader.readBytes());
      latitude = position.latitude;
      longitude = position.longitude;
      bearing = position.bearing;
      speedMps = position.speed;
    } else if (field === 5 && wire === 0) {
      timestampSeconds = reader.readVarint();
    } else if (field === 8 && wire === 2) {
      const vehicle = parseVehicleDescriptor(reader.readBytes());
      vehicleId = vehicle.id;
      vehicleLabel = vehicle.label;
    } else {
      reader.skip(wire);
    }
  }

  if (
    !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Number(latitude) < -90 || Number(latitude) > 90
    || Number(longitude) < -180 || Number(longitude) > 180
  ) return null;

  return {
    feedId: feed.id,
    provider: feed.provider,
    vehicleId,
    vehicleLabel,
    tripId,
    routeId,
    latitude: Number(latitude),
    longitude: Number(longitude),
    bearing: Number.isFinite(bearing) ? Number(bearing) : undefined,
    speedMps: Number.isFinite(speedMps) ? Number(speedMps) : undefined,
    timestamp: Number.isFinite(timestampSeconds)
      ? new Date(Number(timestampSeconds) * 1000).toISOString()
      : undefined,
    sourceUrl: feed.directUrl,
    contextOnly: true,
  };
}

function parseFeedEntity(
  bytes: Uint8Array,
  feed: SpectraPublicFeedRecord,
): SpectraGtfsVehiclePosition | null {
  const reader = new ProtobufReader(bytes);
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 4 && wire === 2) {
      return parseVehiclePosition(reader.readBytes(), feed);
    }
    reader.skip(wire);
  }
  return null;
}

export function parseGtfsRealtimeVehiclePositions(
  bytes: Uint8Array,
  feed: SpectraPublicFeedRecord,
  maxVehicles = 500,
): SpectraGtfsVehiclePosition[] {
  const reader = new ProtobufReader(bytes);
  const positions: SpectraGtfsVehiclePosition[] = [];
  while (!reader.done && positions.length < maxVehicles) {
    const { field, wire } = reader.readTag();
    if (field === 2 && wire === 2) {
      const vehicle = parseFeedEntity(reader.readBytes(), feed);
      if (vehicle) positions.push(vehicle);
    } else {
      reader.skip(wire);
    }
  }
  return positions;
}

export async function fetchSpectraGtfsRealtimeVehiclePositions(
  feed: SpectraPublicFeedRecord,
  maxVehicles = 500,
): Promise<SpectraGtfsVehiclePosition[]> {
  if (
    !feed.active
    || feed.authenticationType !== 0
    || !feed.entityTypes.includes('vp')
  ) return [];

  try {
    const response = await fetch(feed.directUrl, {
      headers: {
        Accept: 'application/x-protobuf,application/octet-stream;q=0.9,*/*;q=0.1',
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return [];

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 8_000_000) return [];
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 8_000_000) return [];

    return parseGtfsRealtimeVehiclePositions(bytes, feed, maxVehicles);
  } catch {
    return [];
  }
}
