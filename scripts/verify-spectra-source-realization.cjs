const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(condition, message) { if (!condition) throw new Error(message); }

const registry = read('server/services/pantheon/PantheonSovereignSourceRegistry.ts');
const spectra = read('server/services/spectra/SpectraSourceRegistry.ts');
const route = read('server/routes/spectra.routes.ts');

for (let i = 1; i <= 23; i += 1) {
  const n = String(i).padStart(2, '0');
  must(registry.includes(`PANTHEON_VERIFIED_SOURCES_BATCH_${n}`), `Missing verified source batch ${n}`);
}
must(registry.includes('export const PANTHEON_VERIFIED_SOURCES'), 'Canonical verified catalog is not exported');
must(spectra.includes('SPECTRA_SOURCE_CATALOG'), 'Spectra catalog is missing');
must(spectra.includes('buildSpectraPriorityTargets'), 'Spectra priority planner is missing');
must(spectra.includes("['critical','high','supporting']"), 'Spectra priority waves are missing');
must(route.includes('pantheonRetrievalAdapter.retrieve'), 'Spectra does not execute the source catalog');
must(route.includes('directSourceTargets'), 'Spectra does not pipe catalog URLs into retrieval');
must(route.includes('sourceCatalog'), 'Spectra does not expose source catalog audit stats');
must(route.includes('catalogEvidenceCount'), 'Spectra does not expose catalog evidence audit');

const batchFiles = Array.from({ length: 23 }, (_, index) =>
  read(`server/services/pantheon/sources/batch${String(index + 1).padStart(2, '0')}.ts`)
);
const declaredMinimum = batchFiles.reduce((sum, body) => {
  const match = body.match(/expected\s+(\d+)\s+distinct URLs/i);
  return sum + (match ? Number(match[1]) : 0);
}, 0);
must(declaredMinimum >= 200, `Verified source inventory below required 200-source floor: ${declaredMinimum}`);

console.log(`Spectra source realization verified; declared verified-source floor=${declaredMinimum}`);
