import * as cheerio from 'cheerio';

export interface SpectraHootenannyFeature {
  id: string;
  type: 'node' | 'way';
  latitude?: number;
  longitude?: number;
  tags: Record<string, string>;
  provider: 'Hootenanny';
  contextOnly: true;
}

export interface SpectraHootenannyConflationRequest {
  input1: string;
  input2: string;
  outputName: string;
  inputType1?: string;
  inputType2?: string;
  outputType?: string;
  referenceLayer?: string;
  conflationType?: string;
  collectStats?: boolean;
  bounds?: string;
}

function configuredBaseUrl(): string | null {
  const raw = String(process.env.SPECTRA_HOOTENANNY_BASE_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function configuredHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json,application/xml,text/xml;q=0.9,*/*;q=0.1',
    'User-Agent': 'LegalWhat-SPECTRA/1.0',
  };
  const tokenEnv = String(process.env.SPECTRA_HOOTENANNY_TOKEN_ENV || '').trim();
  const token = tokenEnv ? String(process.env[tokenEnv] || '').trim() : '';
  if (token) headers.Authorization = /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
  return headers;
}

function bbox(
  latitude: number,
  longitude: number,
  radiusMeters: number,
): string {
  const boundedRadius = Math.max(100, Math.min(50_000, radiusMeters));
  const latDelta = boundedRadius / 111_320;
  const lonScale = Math.max(0.1, Math.cos(latitude * Math.PI / 180));
  const lonDelta = boundedRadius / (111_320 * lonScale);
  const left = Math.max(-180, longitude - lonDelta);
  const bottom = Math.max(-90, latitude - latDelta);
  const right = Math.min(180, longitude + lonDelta);
  const top = Math.min(90, latitude + latDelta);
  return [left, bottom, right, top].map(value => value.toFixed(7)).join(',');
}

function numeric(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function usefulTags(tags: Record<string, string>): boolean {
  return Boolean(
    tags.highway
    || tags.building
    || tags.amenity
    || tags.shop
    || tags.office
    || tags.leisure
    || tags.tourism
    || tags.place
    || tags.name
    || tags.railway
    || tags.waterway
    || tags.landuse
  );
}

function parseOsmXml(xml: string): SpectraHootenannyFeature[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const nodes = new Map<string, { latitude: number; longitude: number }>();

  $('node').each((_, element) => {
    const node = $(element);
    const id = String(node.attr('id') || '').trim();
    const latitude = numeric(node.attr('lat'));
    const longitude = numeric(node.attr('lon'));
    if (!id || latitude === null || longitude === null) return;
    nodes.set(id, { latitude, longitude });
  });

  const features: SpectraHootenannyFeature[] = [];

  $('node').each((_, element) => {
    const node = $(element);
    const id = String(node.attr('id') || '').trim();
    const coordinates = nodes.get(id);
    if (!id || !coordinates) return;

    const tags: Record<string, string> = {};
    node.children('tag').each((__, tagElement) => {
      const tag = $(tagElement);
      const key = String(tag.attr('k') || '').trim();
      const value = String(tag.attr('v') || '').trim();
      if (key && value) tags[key] = value;
    });
    if (!usefulTags(tags)) return;

    features.push({
      id,
      type: 'node',
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      tags,
      provider: 'Hootenanny',
      contextOnly: true,
    });
  });

  $('way').each((_, element) => {
    const way = $(element);
    const id = String(way.attr('id') || '').trim();
    if (!id) return;

    const tags: Record<string, string> = {};
    way.children('tag').each((__, tagElement) => {
      const tag = $(tagElement);
      const key = String(tag.attr('k') || '').trim();
      const value = String(tag.attr('v') || '').trim();
      if (key && value) tags[key] = value;
    });
    if (!usefulTags(tags)) return;

    const coordinates = way.children('nd').toArray().flatMap(nd => {
      const ref = String($(nd).attr('ref') || '').trim();
      const point = nodes.get(ref);
      return point ? [point] : [];
    });
    const centroid = coordinates.length
      ? {
          latitude: coordinates.reduce((sum, point) => sum + point.latitude, 0) / coordinates.length,
          longitude: coordinates.reduce((sum, point) => sum + point.longitude, 0) / coordinates.length,
        }
      : null;

    features.push({
      id,
      type: 'way',
      latitude: centroid?.latitude,
      longitude: centroid?.longitude,
      tags,
      provider: 'Hootenanny',
      contextOnly: true,
    });
  });

  return features.slice(0, 1_000);
}

export function spectraHootenannyConfigured(): boolean {
  return Boolean(
    configuredBaseUrl()
    && String(process.env.SPECTRA_HOOTENANNY_MAP_ID || '').trim()
  );
}

export async function acquireSpectraHootenannyContext(
  latitude: number,
  longitude: number,
  radiusMeters = 5_000,
): Promise<SpectraHootenannyFeature[]> {
  const baseUrl = configuredBaseUrl();
  const mapId = String(process.env.SPECTRA_HOOTENANNY_MAP_ID || '').trim();
  if (
    !baseUrl
    || !mapId
    || !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90
    || longitude < -180 || longitude > 180
  ) return [];

  const endpoint = new URL(
    `${baseUrl}/osm/api/0.6/map/${encodeURIComponent(mapId)}/${bbox(latitude, longitude, radiusMeters)}`,
  );

  try {
    const response = await fetch(endpoint, {
      headers: configuredHeaders(),
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];
    const xml = await response.text();
    if (!xml || xml.length > 12_000_000) return [];
    return parseOsmXml(xml);
  } catch {
    return [];
  }
}

export async function submitSpectraHootenannyConflation(
  request: SpectraHootenannyConflationRequest,
): Promise<Record<string, unknown> | null> {
  const baseUrl = configuredBaseUrl();
  if (!baseUrl) return null;

  const input1 = request.input1.trim();
  const input2 = request.input2.trim();
  const outputName = request.outputName.trim();
  if (!input1 || !input2 || !outputName) return null;

  const endpoint = new URL(`${baseUrl}/conflation/execute`);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...configuredHeaders(),
      'Content-Type': 'application/json',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      INPUT1_TYPE: request.inputType1 || 'DB',
      INPUT2_TYPE: request.inputType2 || 'DB',
      INPUT1: input1,
      INPUT2: input2,
      REFERENCE_LAYER: request.referenceLayer || input1,
      OUTPUT_NAME: outputName,
      OUTPUT_TYPE: request.outputType || 'DB',
      COLLECT_STATS: request.collectStats ?? true,
      CONFLATION_TYPE: request.conflationType || 'Reference',
      bounds: request.bounds,
    }),
  });
  if (!response.ok) {
    throw new Error(`Hootenanny conflation returned HTTP ${response.status}.`);
  }

  const payload: unknown = await response.json();
  return payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};
}
