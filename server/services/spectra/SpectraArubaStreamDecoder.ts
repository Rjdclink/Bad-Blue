export interface SpectraArubaDecodedLocation {
  eventId?: string;
  eventType?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get done() { return this.offset >= this.bytes.length; }

  readVarint(): number {
    let value = 0;
    let shift = 0;
    while (this.offset < this.bytes.length && shift <= 56) {
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
    const out = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  readString(): string {
    return new TextDecoder().decode(this.readBytes());
  }

  readDouble(): number {
    if (this.offset + 8 > this.bytes.length) throw new Error('Invalid protobuf double');
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8);
    const value = view.getFloat64(0, true);
    this.offset += 8;
    return value;
  }

  skip(wire: number): void {
    if (wire === 0) {
      this.readVarint();
      return;
    }
    if (wire === 1) {
      this.offset = Math.min(this.bytes.length, this.offset + 8);
      return;
    }
    if (wire === 2) {
      const length = this.readVarint();
      this.offset = Math.min(this.bytes.length, this.offset + length);
      return;
    }
    if (wire === 5) {
      this.offset = Math.min(this.bytes.length, this.offset + 4);
      return;
    }
    throw new Error('Unsupported protobuf wire type');
  }
}

function parseTimestamp(bytes: Uint8Array): string | null {
  const reader = new Reader(bytes);
  let seconds = 0;
  let nanos = 0;
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1 && wire === 0) seconds = reader.readVarint();
    else if (field === 2 && wire === 0) nanos = reader.readVarint();
    else reader.skip(wire);
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const millis = seconds * 1000 + Math.floor(nanos / 1_000_000);
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseAny(bytes: Uint8Array): Uint8Array | null {
  const reader = new Reader(bytes);
  let value: Uint8Array | null = null;
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 2 && wire === 2) value = reader.readBytes();
    else reader.skip(wire);
  }
  return value;
}

function parseCloudEvent(bytes: Uint8Array): {
  id?: string;
  type?: string;
  time?: string;
  data?: Uint8Array;
} {
  const reader = new Reader(bytes);
  let id: string | undefined;
  let type: string | undefined;
  let time: string | undefined;
  let data: Uint8Array | undefined;

  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1 && wire === 2) id = reader.readString();
    else if (field === 4 && wire === 2) type = reader.readString();
    else if (field === 6 && wire === 2) data = reader.readBytes();
    else if (field === 8 && wire === 2) data = parseAny(reader.readBytes()) || undefined;
    else if (field === 9 && wire === 2) time = parseTimestamp(reader.readBytes()) || undefined;
    else reader.skip(wire);
  }

  return { id, type, time, data };
}

function parseZoneEntry(bytes: Uint8Array): Record<string, unknown> {
  const reader = new Reader(bytes);
  let zoneId: string | undefined;
  let dwellTimeSeconds: number | undefined;
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1 && wire === 2) zoneId = reader.readString();
    else if (field === 2 && wire === 0) dwellTimeSeconds = reader.readVarint();
    else reader.skip(wire);
  }
  return { zoneId, dwellTimeSeconds };
}

function parseWifiClientLocation(bytes: Uint8Array): Record<string, unknown> {
  const reader = new Reader(bytes);
  const result: Record<string, unknown> = { providerKind: 'aruba-location-json' };
  const reportingAps: string[] = [];
  const zones: Record<string, unknown>[] = [];

  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1 && wire === 1) result.x = reader.readDouble();
    else if (field === 2 && wire === 1) result.y = reader.readDouble();
    else if (field === 3 && wire === 1) result.error_level = reader.readDouble();
    else if (field === 4 && wire === 2) result.sta_eth_mac = reader.readString();
    else if (field === 5 && wire === 1) result.longitude = reader.readDouble();
    else if (field === 6 && wire === 1) result.latitude = reader.readDouble();
    else if (field === 7 && wire === 2) result.site_id = reader.readString();
    else if (field === 8 && wire === 2) result.building_id = reader.readString();
    else if (field === 9 && wire === 2) result.floor_id = reader.readString();
    else if (field === 10 && wire === 2) reportingAps.push(reader.readString());
    else if (field === 11 && wire === 0) result.associated = Boolean(reader.readVarint());
    else if (field === 12 && wire === 2) result.assoc_bssid = reader.readString();
    else if (field === 13 && wire === 0) result.connected = Boolean(reader.readVarint());
    else if (field === 14 && wire === 2) zones.push(parseZoneEntry(reader.readBytes()));
    else reader.skip(wire);
  }

  if (reportingAps.length) result.reporting_ap_serial = reportingAps;
  if (zones.length) result.enteredZones = zones;
  return result;
}

function parseAssetLocation(bytes: Uint8Array): Record<string, unknown> {
  const reader = new Reader(bytes);
  const result: Record<string, unknown> = { providerKind: 'aruba-location-json' };
  const zones: Record<string, unknown>[] = [];
  const labels: string[] = [];

  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1 && wire === 1) result.x = reader.readDouble();
    else if (field === 2 && wire === 1) result.y = reader.readDouble();
    else if (field === 3 && wire === 2) result.device_id = reader.readString();
    else if (field === 4 && wire === 2) result.device_mac = reader.readString();
    else if (field === 5 && wire === 2) zones.push(parseZoneEntry(reader.readBytes()));
    else if (field === 6 && wire === 1) result.longitude = reader.readDouble();
    else if (field === 7 && wire === 1) result.latitude = reader.readDouble();
    else if (field === 8 && wire === 2) result.site_id = reader.readString();
    else if (field === 9 && wire === 2) result.building_id = reader.readString();
    else if (field === 10 && wire === 2) result.floor_id = reader.readString();
    else if (field === 11 && wire === 1) result.battery_level = reader.readDouble();
    else if (field === 12 && wire === 2) result.name = reader.readString();
    else if (field === 13 && wire === 2) result.custom_id = reader.readString();
    else if (field === 14 && wire === 2) labels.push(reader.readString());
    else if (field === 15 && wire === 2) result.notes = reader.readString();
    else reader.skip(wire);
  }

  if (zones.length) result.enteredZones = zones;
  if (labels.length) result.labels = labels;
  return result;
}

function parseStreamLocationMessage(bytes: Uint8Array): Record<string, unknown> | null {
  const reader = new Reader(bytes);
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1 && wire === 2) return parseWifiClientLocation(reader.readBytes());
    if (field === 2 && wire === 2) return parseAssetLocation(reader.readBytes());
    reader.skip(wire);
  }
  return null;
}

export function decodeSpectraArubaLocationFrame(
  input: Uint8Array,
): SpectraArubaDecodedLocation | null {
  if (!input.length || input.length > 8_000_000) return null;
  try {
    const cloudEvent = parseCloudEvent(input);
    if (!cloudEvent.data) return null;

    const eventType = String(cloudEvent.type || '');
    if (
      eventType
      && !eventType.includes('wifi-client-locations')
      && !eventType.includes('asset-tags.last-known-location')
    ) {
      return null;
    }

    const payload = parseStreamLocationMessage(cloudEvent.data);
    if (!payload) return null;
    const timestamp = cloudEvent.time || new Date().toISOString();

    return {
      eventId: cloudEvent.id,
      eventType: cloudEvent.type,
      timestamp,
      payload: {
        ...payload,
        timestamp,
        eventId: cloudEvent.id,
        eventType: cloudEvent.type,
      },
    };
  } catch {
    return null;
  }
}
