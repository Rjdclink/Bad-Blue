/**
 * EXIF Geolocation Mapper Demo
 * 
 * This demo shows how to use the IceEngine EXIF Geolocation Mapper
 * for consent-based evidence mapping.
 * 
 * NOTE: This is a demonstration file. To run with real images,
 * replace the mock data with actual JPEG files containing GPS EXIF data.
 */

import { generateEvidenceMap, exifExtractor } from './index';
import type { ConsentedUpload } from './exif/ExifExtractor';

async function demoConsentValidation() {
  console.log('\n=== DEMO 1: Consent Validation ===\n');

  const uploads: ConsentedUpload[] = [
    {
      file: Buffer.from('mock-image-1'),
      filename: 'evidence-001.jpg',
      uploadedBy: 'officer-smith',
      consentGiven: true,
      purpose: 'legal-evidence',
      caseId: 'CASE-2024-001',
    },
    {
      file: Buffer.from('mock-image-2'),
      filename: 'evidence-002.jpg',
      uploadedBy: 'witness-jones',
      consentGiven: false,
      purpose: 'legal-evidence',
      caseId: 'CASE-2024-001',
    },
  ];

  const { valid, invalid } = exifExtractor.validateConsent(uploads);
  console.log(`✓ Valid uploads (with consent): ${valid.length}`);
  console.log(`✗ Invalid uploads (no consent): ${invalid.length}`);
  console.log('\nConsent validation ensures only authorized files are processed.');
}

async function demoConsentError() {
  console.log('\n=== DEMO 2: Consent Error Protection ===\n');

  const uploadWithoutConsent: ConsentedUpload = {
    file: Buffer.from('mock-image'),
    filename: 'unauthorized.jpg',
    uploadedBy: 'unknown',
    consentGiven: false,
    purpose: 'legal-evidence',
  };

  try {
    await exifExtractor.extractLocation(uploadWithoutConsent);
    console.log('✗ ERROR: Should have thrown consent error');
  } catch (error) {
    if (error instanceof Error) {
      console.log('✓ Consent error correctly thrown:');
      console.log(`  "${error.message}"`);
    }
  }
}

async function demoDataStructures() {
  console.log('\n=== DEMO 3: Expected Data Structures ===\n');

  console.log('ConsentedUpload Structure:');
  console.log({
    file: 'Buffer',
    filename: 'evidence.jpg',
    uploadedBy: 'user-id',
    consentGiven: true,
    purpose: 'legal-evidence',
    caseId: 'CASE-2024-001',
  });

  console.log('\nLocationData Structure (expected output):');
  console.log({
    latitude: 40.7128,
    longitude: -74.0060,
    altitude: 10,
    direction: 180,
    speed: 0,
    timestamp: new Date(),
    device: {
      make: 'Apple',
      model: 'iPhone 12',
    },
    source: {
      filename: 'evidence.jpg',
      uploadedBy: 'user-id',
      consentGiven: true,
    },
  });
}

async function demoWorkflow() {
  console.log('\n=== DEMO 4: Complete Workflow (Mock) ===\n');

  console.log('Step 1: Prepare consented uploads');
  console.log('  - Load image files as Buffers');
  console.log('  - Verify user consent is obtained');
  console.log('  - Assign case ID and purpose\n');

  console.log('Step 2: Generate evidence map');
  console.log('  - Extract EXIF data from all images');
  console.log('  - Filter images with GPS coordinates');
  console.log('  - Generate interactive Leaflet.js map');
  console.log('  - Render screenshot with Puppeteer\n');

  console.log('Step 3: Review output');
  console.log('  - HTML map: evidence-maps/map-{caseId}.html');
  console.log('  - Screenshot: evidence-maps/map-{caseId}.png');
  console.log('  - Location count and metadata\n');

  console.log('Example usage:');
  console.log(`
  const result = await generateEvidenceMap({
    caseId: 'CASE-2024-001',
    uploads: [/* ConsentedUpload[] */],
  });
  
  console.log('Map generated:', result.screenshotPath);
  console.log('Locations found:', result.locationCount);
  `);
}

async function demoUseCases() {
  console.log('\n=== DEMO 5: Use Cases ===\n');

  console.log('1. Police Investigation:');
  console.log('   - Map crime scene photos with timestamps');
  console.log('   - Track movement patterns of suspects');
  console.log('   - Create timeline reconstructions\n');

  console.log('2. Legal Proceedings:');
  console.log('   - Generate court-ready evidence exhibits');
  console.log('   - Verify photo authenticity via metadata');
  console.log('   - Show consent compliance to judge\n');

  console.log('3. Journalism & Public Interest:');
  console.log('   - Map protest or event locations');
  console.log('   - Verify source credibility');
  console.log('   - Protect source consent rights\n');

  console.log('4. Insurance Claims:');
  console.log('   - Verify accident locations');
  console.log('   - Timeline damage documentation');
  console.log('   - Cross-reference multiple reports\n');
}

async function demoSecurityFeatures() {
  console.log('\n=== DEMO 6: Security & Privacy Features ===\n');

  console.log('✓ Consent Enforcement:');
  console.log('  - Mandatory consent flag on all uploads');
  console.log('  - Runtime validation before processing');
  console.log('  - Visual consent badge on outputs\n');

  console.log('✓ Error Handling:');
  console.log('  - Graceful degradation for corrupted files');
  console.log('  - Null return for missing GPS data');
  console.log('  - Detailed error logging\n');

  console.log('✓ Data Integrity:');
  console.log('  - Original consent status preserved');
  console.log('  - Audit trail via source metadata');
  console.log('  - No modification of original files\n');
}

async function runAllDemos() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║      EXIF GEOLOCATION MAPPER - DEMONSTRATION SUITE        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  await demoConsentValidation();
  await demoConsentError();
  await demoDataStructures();
  await demoWorkflow();
  await demoUseCases();
  await demoSecurityFeatures();

  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    DEMO COMPLETE                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\nFor production use with real images:');
  console.log('1. Load JPEG files with GPS EXIF data');
  console.log('2. Obtain explicit user consent');
  console.log('3. Call generateEvidenceMap() with real uploads');
  console.log('4. Review generated HTML map and screenshot\n');
}

// Run demos if executed directly
runAllDemos().catch(console.error);

export { runAllDemos };
