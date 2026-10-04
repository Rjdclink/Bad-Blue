import type { Request, Response, NextFunction } from 'express';

export const SPECTRA_API_VERSION = '1';
export const SPECTRA_SCHEMA_VERSION = '2026-10-03';

export function spectraApiVersionHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('X-Spectra-Api-Version', SPECTRA_API_VERSION);
  res.setHeader('X-Spectra-Schema-Version', SPECTRA_SCHEMA_VERSION);
  next();
}

export function getSpectraOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'LegalWhat SPECTRA API',
      version: SPECTRA_API_VERSION,
      summary: 'Versioned SPECTRA acquisition and telemetry contract.',
      description:
        'Stable v1 contract for SPECTRA acquisition, lifecycle control, telemetry history, telemetry streaming, health and capability discovery.',
    },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    servers: [
      { url: '/api', description: 'LegalWhat API root' },
    ],
    paths: {
      '/spectra/v1/acquire': {
        post: {
          operationId: 'spectraAcquire',
          summary: 'Run one bounded SPECTRA acquisition pass',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AcquireRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Acquisition pass completed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AcquireResponse' },
                },
              },
            },
            '400': { description: 'Invalid request' },
            '401': { description: 'Authentication required' },
            '429': { description: 'Resource budget temporarily exhausted' },
          },
        },
      },
      '/spectra/v1/acquisition/stop': {
        post: {
          operationId: 'spectraStopAcquisition',
          summary: 'Hard-stop recursive acquisition for a session',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['sessionId'],
                  properties: {
                    sessionId: { type: 'string', minLength: 1, maxLength: 200 },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Session stopped' },
            '400': { description: 'Invalid session ID' },
            '401': { description: 'Authentication required' },
          },
        },
      },
      '/spectra/v1/live': {
        get: {
          operationId: 'spectraLive',
          summary: 'Lightweight liveness probe with no dependency checks',
          responses: { '200': { description: 'Process is live' } },
        },
      },
      '/spectra/v1/ready': {
        get: {
          operationId: 'spectraReady',
          summary: 'Readiness probe for critical persistence dependency',
          responses: {
            '200': { description: 'Ready to accept SPECTRA work' },
            '503': { description: 'Critical persistence dependency unavailable' },
          },
        },
      },
      '/spectra/v1/health': {
        get: {
          operationId: 'spectraHealth',
          summary: 'Read current SPECTRA health and live capability state',
          responses: {
            '200': {
              description: 'Health snapshot',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                },
              },
            },
          },
        },
      },
      '/spectra/v1/openapi.json': {
        get: {
          operationId: 'spectraOpenApi',
          summary: 'Read this OpenAPI contract',
          responses: { '200': { description: 'OpenAPI 3.1 document' } },
        },
      },
      '/geoconsole/v1/telemetry-history/{sessionId}': {
        get: {
          operationId: 'spectraTelemetryHistory',
          summary: 'Read cursor-paged durable location observations for an owned session',
          parameters: [
            {
              name: 'sessionId',
              in: 'path',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 200 },
            },
            {
              name: 'after',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'date-time' },
            },
            {
              name: 'before',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'date-time' },
            },
            {
              name: 'cursor',
              in: 'query',
              required: false,
              schema: { type: 'string', minLength: 1, maxLength: 1000 },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 2000, default: 500 },
            },
          ],
          responses: {
            '200': { description: 'Newest-first durable telemetry page with opaque nextCursor' },
            '400': { description: 'Invalid range or cursor' },
            '404': { description: 'Session not found for tenant' },
          },
        },
      },
      '/geoconsole/v1/telemetry-stream/{sessionId}': {
        get: {
          operationId: 'spectraTelemetryStream',
          summary: 'Subscribe to server-sent observation events',
          parameters: [{
            name: 'sessionId',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 200 },
          }],
          responses: {
            '200': {
              description: 'text/event-stream observation feed',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
          },
        },
      },
      '/geoconsole/v1/telemetry-capabilities': {
        get: {
          operationId: 'spectraTelemetryCapabilities',
          summary: 'Read configured adapters, transports and stream health',
          responses: { '200': { description: 'Capability snapshot' } },
        },
      },
      '/spectra/v1/metrics': {
        get: {
          operationId: 'spectraMetrics',
          summary: 'Prometheus text exposition for SPECTRA runtime metrics',
          responses: {
            '200': {
              description: 'Prometheus text metrics',
              content: {
                'text/plain': { schema: { type: 'string' } },
              },
            },
          },
        },
      },
      '/geoconsole/v1/process': {
        post: {
          operationId: 'spectraProcessLocationData',
          summary: 'Run the canonical bounded location fusion pipeline',
          responses: {
            '200': { description: 'Fused location pipeline result' },
            '400': { description: 'Invalid location input' },
            '429': { description: 'Resource budget temporarily exhausted' },
          },
        },
      },
      '/geoconsole/v1/report': {
        post: {
          operationId: 'spectraGenerateReport',
          summary: 'Generate a report by rehydrating tenant-owned durable observations',
          responses: {
            '200': { description: 'Durable-history report result' },
            '404': { description: 'No owned durable observations for session/range' },
            '429': { description: 'Resource budget temporarily exhausted' },
          },
        },
      },
      '/geoconsole/v1/interpolate': {
        post: {
          operationId: 'spectraInterpolate',
          summary: 'Run bounded path interpolation',
          responses: {
            '200': { description: 'Interpolation result' },
            '429': { description: 'Resource budget temporarily exhausted' },
          },
        },
      },
      '/geoconsole/v1/futurecast': {
        post: {
          operationId: 'spectraFuturecast',
          summary: 'Run bounded future-position prediction',
          responses: {
            '200': { description: 'Futurecast result' },
            '429': { description: 'Resource budget temporarily exhausted' },
          },
        },
      },
    },
    components: {
      schemas: {
        DirectEvidence: {
          type: 'object',
          additionalProperties: true,
          required: ['latitude', 'longitude', 'timestamp', 'source', 'confidence'],
          properties: {
            latitude: { type: 'number', minimum: -90, maximum: 90 },
            longitude: { type: 'number', minimum: -180, maximum: 180 },
            accuracy: { type: 'number', exclusiveMinimum: 0 },
            timestamp: { type: 'string', format: 'date-time' },
            source: {
              type: 'string',
              enum: ['exif_photo', 'exif_video', 'xmp_sidecar', 'json_sidecar'],
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
        AcquireRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['target', 'details'],
          properties: {
            target: { type: 'string', minLength: 1, maxLength: 500 },
            details: { type: 'string', minLength: 1, maxLength: 12000 },
            sessionId: { type: 'string', minLength: 1, maxLength: 200 },
            originSessionId: { type: 'string', minLength: 1, maxLength: 200 },
            queryStartedAt: { type: 'string', format: 'date-time' },
            recursivePass: { type: 'integer', minimum: 0 },
            directEvidence: {
              type: 'array',
              maxItems: 20,
              items: { $ref: '#/components/schemas/DirectEvidence' },
            },
          },
        },
        AcquireResponse: {
          type: 'object',
          required: ['success'],
          properties: {
            success: { type: 'boolean' },
            sessionId: { type: 'string' },
            resolvedTargetLabel: { type: 'string' },
            locationObservations: { type: 'array', items: { type: 'object' } },
            candidateLocations: { type: 'array', items: { type: 'object' } },
            acquisition: { type: 'object' },
          },
        },
        HealthResponse: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              required: ['status', 'apiVersion', 'schemaVersion'],
              properties: {
                status: { type: 'string', enum: ['operational', 'degraded'] },
                apiVersion: { type: 'string' },
                schemaVersion: { type: 'string' },
              },
            },
          },
        },
      },
    },
  };
}
