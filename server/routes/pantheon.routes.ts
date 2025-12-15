/**
 * Pantheon API Routes
 * 
 * Provides endpoints for:
 * - Data normalization
 * - Storage with provenance
 * - Query with filters
 * - Provenance tracking
 */

import { Router } from 'express';
import { z } from 'zod';
import { createLogger } from '../logger';
import { PantheonBeamConnector, PantheonOperationType } from '../services/computationalBeam/pantheonConnector';
import { isPantheonAvailable } from '../services/pantheonCrawlerOrchestrator';

const log = createLogger('PantheonRoutes');
const router = Router();

// ============================================================================
// SCHEMAS
// ============================================================================

const NormalizeDataSchema = z.object({
  rawData: z.any(),
  dataType: z.enum(['gps', 'entity', 'relationship', 'document', 'image', 'generic']),
  source: z.string(),
  metadata: z.record(z.any()).optional(),
});

const StoreDataSchema = z.object({
  data: z.any(),
  dataType: z.string(),
  source: z.string(),
  provenance: z.object({
    origin: z.string(),
    timestamp: z.string(),
    collector: z.string(),
    method: z.string(),
    confidence: z.number().min(0).max(1),
  }),
});

const QueryDataSchema = z.object({
  dataType: z.string().optional(),
  source: z.string().optional(),
  filters: z.record(z.any()).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

const ProvenanceQuerySchema = z.object({
  dataId: z.string(),
});

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/pantheon/normalize
 * Normalize raw data into standard format
 */
router.post('/normalize', async (req, res) => {
  try {
    const body = NormalizeDataSchema.parse(req.body);

    if (!isPantheonAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Pantheon system is currently unavailable (cryptocrawler active)',
      });
    }

    log.info('Normalizing data', { dataType: body.dataType, source: body.source });

    // Normalize based on data type
    const normalized = await normalizeData(body.rawData, body.dataType, body.source);

    res.json({
      success: true,
      data: {
        normalized,
        dataType: body.dataType,
        source: body.source,
        normalizedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    log.error('Normalization error:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Normalization failed',
    });
  }
});

/**
 * POST /api/pantheon/store
 * Store data with provenance tracking
 */
router.post('/store', async (req, res) => {
  try {
    const body = StoreDataSchema.parse(req.body);

    if (!isPantheonAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Pantheon system is currently unavailable (cryptocrawler active)',
      });
    }

    log.info('Storing data with provenance', { 
      dataType: body.dataType, 
      source: body.source 
    });

    // Store data with provenance
    const stored = await storeDataWithProvenance(body.data, body.dataType, body.source, body.provenance);

    res.json({
      success: true,
      data: {
        id: stored.id,
        dataType: body.dataType,
        source: body.source,
        storedAt: new Date().toISOString(),
        provenance: body.provenance,
      },
    });
  } catch (error) {
    log.error('Storage error:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Storage failed',
    });
  }
});

/**
 * POST /api/pantheon/query
 * Query stored data with filters
 */
router.post('/query', async (req, res) => {
  try {
    const body = QueryDataSchema.parse(req.body);

    if (!isPantheonAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Pantheon system is currently unavailable (cryptocrawler active)',
      });
    }

    log.info('Querying data', { 
      dataType: body.dataType, 
      source: body.source,
      filters: Object.keys(body.filters || {}).length 
    });

    // Query data
    const results = await queryData(
      body.dataType,
      body.source,
      body.filters,
      body.limit || 100,
      body.offset || 0
    );

    res.json({
      success: true,
      data: {
        results,
        count: results.length,
        filters: body.filters,
        limit: body.limit || 100,
        offset: body.offset || 0,
      },
    });
  } catch (error) {
    log.error('Query error:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Query failed',
    });
  }
});

/**
 * GET /api/pantheon/provenance/:dataId
 * Get provenance information for a data record
 */
router.get('/provenance/:dataId', async (req, res) => {
  try {
    const { dataId } = req.params;

    if (!isPantheonAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Pantheon system is currently unavailable (cryptocrawler active)',
      });
    }

    log.info('Retrieving provenance', { dataId });

    // Get provenance
    const provenance = await getProvenance(dataId);

    if (!provenance) {
      return res.status(404).json({
        success: false,
        error: 'Provenance not found',
      });
    }

    res.json({
      success: true,
      data: {
        dataId,
        provenance,
      },
    });
  } catch (error) {
    log.error('Provenance query error:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Provenance query failed',
    });
  }
});

/**
 * GET /api/pantheon/status
 * Get Pantheon system status
 */
router.get('/status', async (req, res) => {
  try {
    const available = isPantheonAvailable();
    const beamStatus = PantheonBeamConnector.getStatus();

    res.json({
      success: true,
      data: {
        available,
        system: 'PANTHEON',
        timestamp: new Date().toISOString(),
        beam: beamStatus,
        operations: {
          normalize: available,
          store: available,
          query: available,
          provenance: available,
        },
      },
    });
  } catch (error) {
    log.error('Status error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Status check failed',
    });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Normalize raw data into standard format
 */
async function normalizeData(rawData: any, dataType: string, source: string): Promise<any> {
  // Use Pantheon Beam for data collection
  const result = await PantheonBeamConnector.executeDataCollection(
    Array.isArray(rawData) ? rawData.map((d: any) => d.id || String(d)) : [String(rawData)],
    1
  );

  switch (dataType) {
    case 'gps':
      return normalizeGPSData(rawData);
    case 'entity':
      return normalizeEntityData(rawData);
    case 'relationship':
      return normalizeRelationshipData(rawData);
    case 'document':
      return normalizeDocumentData(rawData);
    case 'image':
      return normalizeImageData(rawData);
    default:
      return normalizeGenericData(rawData);
  }
}

function normalizeGPSData(data: any): any {
  return {
    type: 'gps',
    latitude: parseFloat(data.latitude || data.lat || 0),
    longitude: parseFloat(data.longitude || data.lng || data.lon || 0),
    altitude: data.altitude || data.alt || null,
    accuracy: data.accuracy || data.acc || null,
    timestamp: data.timestamp || new Date().toISOString(),
    source: data.source || 'unknown',
    confidence: parseFloat(data.confidence || '0.5'),
    metadata: data.metadata || {},
  };
}

function normalizeEntityData(data: any): any {
  return {
    type: 'entity',
    id: data.id || data._id || data.entityId || generateId(),
    name: data.name || data.entityName || 'Unknown',
    entityType: data.entityType || data.type || 'generic',
    attributes: data.attributes || data.properties || {},
    relationships: data.relationships || [],
    metadata: data.metadata || {},
  };
}

function normalizeRelationshipData(data: any): any {
  return {
    type: 'relationship',
    id: data.id || generateId(),
    source: data.source || data.from || data.sourceId,
    target: data.target || data.to || data.targetId,
    relationType: data.relationType || data.type || 'related_to',
    strength: parseFloat(data.strength || data.weight || '0.5'),
    bidirectional: data.bidirectional || false,
    metadata: data.metadata || {},
  };
}

function normalizeDocumentData(data: any): any {
  return {
    type: 'document',
    id: data.id || generateId(),
    title: data.title || 'Untitled',
    content: data.content || data.text || '',
    contentType: data.contentType || data.mimeType || 'text/plain',
    author: data.author || 'Unknown',
    created: data.created || data.createdAt || new Date().toISOString(),
    metadata: data.metadata || {},
  };
}

function normalizeImageData(data: any): any {
  return {
    type: 'image',
    id: data.id || generateId(),
    url: data.url || data.src || '',
    width: data.width || null,
    height: data.height || null,
    format: data.format || data.mimeType || 'image/jpeg',
    exif: data.exif || {},
    metadata: data.metadata || {},
  };
}

function normalizeGenericData(data: any): any {
  return {
    type: 'generic',
    id: generateId(),
    data,
    metadata: {
      normalizedAt: new Date().toISOString(),
    },
  };
}

/**
 * Store data with provenance tracking
 */
async function storeDataWithProvenance(
  data: any,
  dataType: string,
  source: string,
  provenance: any
): Promise<{ id: string }> {
  const id = data.id || generateId();

  // Use Pantheon Beam for entity enrichment
  await PantheonBeamConnector.executeEntityEnrichment([id]);

  // In production, would store to database with provenance
  // For now, simulate storage
  log.info('Data stored with provenance', { id, dataType, source });

  return { id };
}

/**
 * Query stored data
 */
async function queryData(
  dataType?: string,
  source?: string,
  filters?: Record<string, any>,
  limit: number = 100,
  offset: number = 0
): Promise<any[]> {
  // Use Pantheon Beam for dashboard queries
  await PantheonBeamConnector.executeDashboardQuery({ 
    dataType, 
    source, 
    filters 
  });

  // In production, would query database
  // For now, return mock data
  const mockResults = [];
  for (let i = 0; i < Math.min(limit, 10); i++) {
    mockResults.push({
      id: generateId(),
      type: dataType || 'generic',
      source: source || 'unknown',
      data: { sample: true, index: i },
      createdAt: new Date().toISOString(),
    });
  }

  return mockResults;
}

/**
 * Get provenance for a data record
 */
async function getProvenance(dataId: string): Promise<any | null> {
  // In production, would query provenance database
  // For now, return mock provenance
  return {
    dataId,
    origin: 'api_ingestion',
    timestamp: new Date().toISOString(),
    collector: 'pantheon_crawler',
    method: 'direct_api',
    confidence: 0.95,
    chain: [
      {
        step: 1,
        action: 'collection',
        timestamp: new Date(Date.now() - 60000).toISOString(),
        agent: 'crawler',
      },
      {
        step: 2,
        action: 'normalization',
        timestamp: new Date(Date.now() - 30000).toISOString(),
        agent: 'normalizer',
      },
      {
        step: 3,
        action: 'storage',
        timestamp: new Date().toISOString(),
        agent: 'storage_engine',
      },
    ],
  };
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export default router;
