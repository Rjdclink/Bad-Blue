const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const esbuild = require('esbuild');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const route = read('server/routes/spectra.routes.ts');
const retrieval = read('server/services/spectra/SpectraPublicRetrieval.ts');
const images = read('server/services/spectra/SpectraPublicImageRecords.ts');
// TypeScript transpileModule alone does not reject same-scope duplicate lexical
// declarations. Run the real bundler's parser on the source modules too.
for (const file of [
  'server/routes/spectra.routes.ts',
  'server/lexara/LegalProviderMesh.ts',
  'server/lexara/LexaraBackgroundInvestigation.ts',
  'server/lexara/LexaraRetrievalBoundary.ts',
  'server/services/spectra/SpectraSourceRegistry.ts',
  'server/services/spectra/SpectraEnrolledDeviceRegistry.ts',
  'server/services/spectra/SpectraEnrolledAcquisition.ts',
  'server/services/spectra/SpectraOwnTracksAdapter.ts',
  'server/services/spectra/SpectraTraccarAdapter.ts',
  'server/services/spectra/SpectraCarrierLocationAdapters.ts',
  'server/services/spectra/SpectraVonageAuth.ts',
  'server/services/spectra/SpectraPhoneInfoga.ts',
  'server/services/spectra/SpectraRecursiveClues.ts',
  'server/services/spectra/SpectraExternalSourceHttp.ts',
  'server/services/spectra/SpectraPublicRetrieval.ts',
  'server/services/spectra/SpectraPublicImageRecords.ts',
  'server/services/spectra/SpectraVisualSceneAnalysis.ts',
  'server/services/spectra/SpectraXPostMedia.ts',
  'server/services/spectra/SpectraCameraDirectoryAdapters.ts',
  'scripts/verify-spectra-public-image-pipeline.ts',
  'scripts/verify-spectra-x-media.ts',
  'scripts/verify-spectra-visual-scene.ts',
  'scripts/verify-spectra-camera-validation.ts',
]) {
  assert.doesNotThrow(
    () => esbuild.transformSync(read(file), { loader: 'ts', target: 'es2022', format: 'esm' }),
    file + ' must be accepted by the production bundler',
  );
}
const cameras = read('server/services/spectra/SpectraCameraDirectoryAdapters.ts');
const geo = read('server/routes/geoconsole.routes.ts');
const page = read('client/src/pages/spectra.tsx');
const panel = read('client/src/components/geoconsole/SpectraGeographicContext.tsx');

for (const file of [
  'server/routes/spectra.routes.ts',
  'server/routes/geoconsole.routes.ts',
  'server/services/spectra/SpectraPublicRetrieval.ts',
  'server/services/spectra/SpectraPublicImageRecords.ts',
  'server/services/spectra/SpectraXPostMedia.ts',
  'server/services/spectra/SpectraVisualSceneAnalysis.ts',
  'server/services/spectra/SpectraCameraDirectoryAdapters.ts',
  'server/services/spectra/SpectraPublicEvidenceProvenance.ts',
  'server/services/spectra/SpectraAcquisitionRecords.ts',
  'client/src/pages/spectra.tsx',
  'client/src/components/geoconsole/SpectraGeographicContext.tsx',
]) {
  const result = ts.transpileModule(read(file), {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX },
  });
  const syntactic = (result.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
  assert.equal(syntactic.length, 0, file + ': ' +
    syntactic.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('; '));
}

// A repeated page poll must reuse already persisted evidence. Paid SerpApi
// and ScrapingBee fallback require explicit SPECTRA operator opt-in.
const mesh = read('server/lexara/LegalProviderMesh.ts');
const background = read('server/lexara/LexaraBackgroundInvestigation.ts');
const registry = read('server/services/spectra/SpectraSourceRegistry.ts');
const pdfBoundary = read('server/lexara/LexaraRetrievalBoundary.ts');
assert.match(route, /SPECTRA_REFRESH_REUSE_MS = 30 \* 60_000/);
assert.match(route, /refreshOnly && refreshKey/);
assert.match(route, /reusedRecentEvidence: true/);
assert.match(route, /SPECTRA_PAID_SEARCH_ENABLED === 'true'/);
assert.match(route, /attemptedRetrievalUrls\.add\(url\)/);
assert.match(mesh, /if \(options\.allowPaidSearch === false\) return \[\]/);
assert.match(mesh, /allowPaidSearch \? tavily\(query, controller\.signal/);
assert.match(mesh, /firstUsefulSearchVariants\(uniqueVariants,signal,options\.allowPaidSearch !== false\)/);
assert.match(background, /firstUseful: !deepAcquisitionRequested,\s*allowPaidSearch: context\.allowPaidSearch/);
assert.match(route, /queryAlreadyPlanned: true,\s*allowClaudePlanning: context\.useClaude !== false,\s*allowPaidSearch: context\.allowPaidSearch === true/);
assert.match(background, /allowPaidSearch: context\.allowPaidSearch/);
assert.match(registry, /maxPasses: 8,\s*maxQueries: 48,/);
assert.match(retrieval, /contentType === 'application\/pdf'/);
assert.match(pdfBoundary, /export async function textFromPdf/);

// An acquisition's environmental result has to reach the Spectra UI.
assert.match(route, /locationObservations,\s*candidateLocations,\s*mediaCaptureScenes,\s*contextEvidence,\s*liveLocationAssessment/);
assert.match(page, /setContextEvidence\(payload\.contextEvidence\?\.anchor/);
assert.match(page, /<SpectraGeographicContext value=\{contextEvidence\} photoScenes=\{photoScenes\}/);
assert.match(panel, /Photograph metadata by capture date/);
assert.doesNotMatch(panel, /not sightings or measurements of the investigated person/);
assert.match(panel, /Source time unknown/);

// Existing spatial observations must remain separate from source-scene/context records.
assert.match(route, /contextEvidence = contextOutcome\.value/);
assert.match(route, /buildSpectraAcquisitionRecords\([\s\S]*contextEvidence\)/);
assert.match(images, /observations: \[\]/);
assert.match(images, /captureLocationIsSubjectPosition: false/);
assert.match(images, /currentPositionVerified: false/);
assert.doesNotMatch(route, /observations\.push\(\.\.\.contextEvidence/);

// Weather chaining shares one end-to-end deadline instead of up to 18 seconds.
const weather = geo.slice(geo.indexOf('export async function nwsLatestObservation'),
  geo.indexOf('export async function copernicusItems'));
assert.match(weather, /const signal = AbortSignal\.timeout\(7_000\)/);
assert.equal((weather.match(/signal: AbortSignal\.timeout\(6_000\)/g) || []).length, 0);

// Satellite items use a source-observed time; an acquisition-day-only window
// would often return nothing where valid older images exist.
assert.match(route, /21 \* 86_400_000/);
assert.match(geo, /'properties\.datetime'/);
assert.match(panel, /Acquired \{timestamp\(item\.observedAt\)\}/);

// Cap configured camera feeds and response bytes; invalid/missing positions
// cannot be treated as (0, 0). Cache repeated independent area-context reads.
assert.match(cameras, /parsed\.slice\(0, 8\)/);
assert.match(cameras, /publicCoordinate\(readPath\(row, config\.latitudePath\)\)/);
assert.match(cameras, /length > 5_000_000/);
assert.match(geo, /cameraPositionNumber\(coordinate\?\.lat\)/);
assert.match(route, /spectraContextCache\.get\(key\)/);
assert.match(route, /spectraContextCache\.set\(key/);
assert.match(route, /collectSpectraEarthSearchScenes\(input\.latitude, input\.longitude, earthFrom, earthTo\)/);
assert.match(geo, /collectSpectraEarthSearchScenes\(validation\.data\.lat, validation\.data\.lng, from, to\)/);
assert.match(route, /basis === 'timestamped_observation'/);
assert.match(route, /candidateLocations\[0\]\.confidence >= 0\.1/);
assert.match(panel, /Photograph metadata by capture date/);
assert.match(route, /camera\.status\?\.disabled === true/);

// Only actual retrieved HTML can supply social post media URLs.
assert.match(retrieval, /spectraSocialPageImageLeads\(sourceUrl, ogImages\)/);
assert.match(route, /const xPostMedia = await collectSpectraXPostMedia\(retrievedEvidence\)/);
assert.match(route, /collectSpectraPublicSocialPageImages\(\[\s*\.\.\.xPostMedia\.posts, \.\.\.retrievedEvidence,\s*\]\)/,
  'only validated X post-media leads and retrieved post HTML enter image acquisition');
assert.match(route, /retrievedEvidence\.push\(\.\.\.publicSocialImages\.records\)/,
  'actual downloaded image records must reach the evidence archive');
assert.match(route, /sceneOverlapSummary = summarizeSpectraSceneOverlap\(inspectedImageRecords\)/,
  'scene comparisons must use the same inspected image batch');
assert.match(route, /state: \{\s*pipelineDiagnostics,\s*sceneOverlapSummary/,
  'scene summary is persisted privately rather than changing the map');
assert.match(route, /collectSpectraPublicMastodonImages/);
assert.match(images, /redirect: 'manual'/);
assert.match(images, /MAX_IMAGES_PER_PLATFORM = 4/);
console.log('SPECTRA public geographic context and media wiring checks passed.');
