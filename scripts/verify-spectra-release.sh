#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if (process.versions.node.split(".")[0] !== "20") throw new Error("Use production Node 20")'

echo 'GROUP 1/3: focused types and regression checks'
: "${SPECTRA_CRAWL4AI_PYTHON:?Configure the local Crawl4AI runtime before release verification}"
"$SPECTRA_CRAWL4AI_PYTHON" scripts/verify-spectra-crawl4ai.py
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2020 --lib ES2021,DOM,DOM.Iterable --module ESNext --moduleResolution bundler --types node server/lexara/TavilyBudget.ts shared/spectraTimestampClues.ts server/lexara/DiscoveryDiagnostics.ts server/services/spectra/SpectraPipelineDiagnostics.ts server/services/spectra/SpectraRetrievalDiagnostics.ts server/services/spectra/SpectraEnrolledDeviceRegistry.ts server/services/spectra/SpectraExternalSourceHttp.ts server/services/spectra/SpectraOwnTracksAdapter.ts server/services/spectra/SpectraTraccarAdapter.ts server/services/spectra/SpectraCarrierLocationAdapters.ts server/services/spectra/SpectraPhoneInfoga.ts server/services/spectra/SpectraEnrolledAcquisition.ts server/services/spectra/SpectraRecursiveClues.ts server/services/spectra/SpectraActiveAcquisition.ts client/src/lib/spectraFeedStatus.ts
node --import tsx scripts/verify-spectra-keyless-providers.ts
node --import tsx scripts/verify-spectra-tavily-budget.ts
node scripts/verify-spectra-unresolved-repairs.cjs
node --import tsx scripts/verify-spectra-publication-dates.ts
node scripts/verify-spectra-retrieval-diagnostics.cjs
node scripts/verify-spectra-feed-diagnostics.cjs
node scripts/verify-spectra-pipeline.cjs
node --import tsx scripts/verify-spectra-enrolled-acquisition.ts
node --import tsx scripts/verify-spectra-external-live-sources.ts
node scripts/verify-spectra-provider-runtime.cjs
node scripts/verify-spectra-provider-smoke.cjs
echo 'GROUP 1/3 PASSED'

echo 'GROUP 2/3: complete Spectra and shared Lexara regressions'
npm run verify:spectra
node scripts/test-lexara-research-routing.cjs
node scripts/test-lexara-native-background-investigation.cjs
echo 'GROUP 2/3 PASSED'

echo 'GROUP 3/3: complete production build and patch validation'
npm run build
git diff --check
echo 'GROUP 3/3 PASSED'
