import { exifExtractor, type ConsentedUpload, type LocationData } from './exif/ExifExtractor';
import { leafletMapper } from './exif/LeafletMapper';
import { mapRenderer } from './exif/MapRenderer';
import path from 'path';

interface EvidenceMapRequest {
  uploads: ConsentedUpload[];
  caseId: string;
}

interface EvidenceMapResult {
  screenshotPath: string;
  htmlPath: string;
  locationCount: number;
  caseId: string;
}

export async function generateEvidenceMap(request: EvidenceMapRequest): Promise<EvidenceMapResult> {
  const { uploads, caseId } = request;

  // Validate consent
  const { valid, invalid } = exifExtractor.validateConsent(uploads);
  if (invalid.length > 0) {
    throw new Error(`Cannot process ${invalid.length} files without consent`);
  }

  console.log(`[IceEngine] Extracting EXIF from ${valid.length} files...`);
  const locations = await exifExtractor.extractBatch(valid);

  if (locations.length === 0) {
    throw new Error('No GPS data found in uploaded files');
  }

  console.log(`[IceEngine] Found ${locations.length} locations`);

  const outputPath = path.join(process.cwd(), 'evidence-maps');
  const htmlPath = await leafletMapper.generateMapHTML({
    locations,
    caseId,
    outputPath,
  });

  const screenshotPath = await mapRenderer.renderMapScreenshot({
    htmlPath,
    outputPath,
    caseId,
  });

  return {
    screenshotPath,
    htmlPath,
    locationCount: locations.length,
    caseId,
  };
}

export { exifExtractor, leafletMapper, mapRenderer };
export type { ConsentedUpload, LocationData, EvidenceMapRequest, EvidenceMapResult };
