import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PANTHEON_BACKGROUND_CATEGORIES,
  PANTHEON_EXECUTABLE_SOURCE_INVENTORY,
  PANTHEON_SOURCE_EXCLUSION_LEDGER,
  PANTHEON_SOURCE_REGISTRY_DIAGNOSTICS,
  PANTHEON_VERIFIED_SOURCE_INVENTORY,
  buildPantheonCategoryTargets,
  preflightPantheonSourceTargets,
} from '../server/services/pantheon/PantheonSovereignSourceRegistry';
import {
  createPantheonRegistrationAuthority,
  ensurePantheonContactRegistration,
} from '../server/services/pantheon/PantheonContactRegistrationBroker';

assert.equal(PANTHEON_VERIFIED_SOURCE_INVENTORY.length, 4_500);
assert.equal(PANTHEON_SOURCE_REGISTRY_DIAGNOSTICS.rawEntries, 4_500);
assert.equal(PANTHEON_SOURCE_REGISTRY_DIAGNOSTICS.accountedRawEntries, 4_500);
assert.equal(
  PANTHEON_SOURCE_REGISTRY_DIAGNOSTICS.canonicalUrls,
  PANTHEON_EXECUTABLE_SOURCE_INVENTORY.length + PANTHEON_SOURCE_EXCLUSION_LEDGER.length,
);
assert(PANTHEON_SOURCE_EXCLUSION_LEDGER.length > 0, 'Access-controlled registry entries must be excluded explicitly.');

const executableUrls = new Set(PANTHEON_EXECUTABLE_SOURCE_INVENTORY.map(source => source.url));
assert.equal(executableUrls.size, PANTHEON_EXECUTABLE_SOURCE_INVENTORY.length, 'Executable registry must be canonical and deduplicated.');
for (const source of PANTHEON_EXECUTABLE_SOURCE_INVENTORY) {
  assert(source.sourceIds.length > 0 && source.originalUrls.length > 0, 'Executable source lost provenance.');
  assert(source.categories.length > 0, 'Executable source lost category routing.');
  assert.equal(source.accessMode, 'public', 'Executable sources must require neither API credentials nor registration.');
}
for (const exclusion of PANTHEON_SOURCE_EXCLUSION_LEDGER) {
  assert(exclusion.sourceIds.length > 0 && exclusion.originalUrls.length > 0, 'Excluded source lost provenance.');
  assert(exclusion.reason.trim(), 'Excluded source requires a persisted reason.');
  if (exclusion.canonicalUrl) assert(!executableUrls.has(exclusion.canonicalUrl), 'Excluded source leaked into executable registry.');
}

const blockedUrls = new Set(PANTHEON_SOURCE_EXCLUSION_LEDGER
  .map(exclusion => exclusion.canonicalUrl)
  .filter((value): value is string => Boolean(value)));
const analysisOnlyCategories = new Set([
  'contradictions', 'provenance', 'confidence', 'false-positive', 'crawler-audit',
]);
for (const category of PANTHEON_BACKGROUND_CATEGORIES) {
  const targets = buildPantheonCategoryTargets(category, 'Taylor Example', 'Iowa', 300);
  const preflight = preflightPantheonSourceTargets(targets, category, 'Taylor Example', 'Iowa');
  if (analysisOnlyCategories.has(category)) {
    assert.equal(preflight.targets.length, 0, `${category} must operate on collected evidence without injecting generic sources.`);
    continue;
  }
  assert(preflight.targets.length > 0, `${category} has no executable targets after compilation.`);
  for (const target of preflight.targets) {
    assert(!blockedUrls.has(target.url), `${category} reintroduced excluded URL ${target.url}.`);
  }
}

const disabledAuthority = createPantheonRegistrationAuthority();
assert.equal(disabledAuthority.enabled, false);
const disabledAttempt = await ensurePantheonContactRegistration({
  sourceUrl: 'https://example.com/register',
  authority: disabledAuthority,
  deadlineAt: Date.now() + 1_000,
});
assert.equal(disabledAttempt.ok, false, 'Registration must fail closed without secure runtime authority.');

const sourceText = [
  readFileSync('server/services/pantheon/PantheonSourceRegistryCompiler.ts', 'utf8'),
  readFileSync('server/services/pantheon/PantheonContactRegistrationBroker.ts', 'utf8'),
].join('\n');
for (const forbidden of ['Robert Clinkenbeard', '712-209-8254', 'brclink1985@gmail.com']) {
  assert(!sourceText.includes(forbidden), 'Personal contact information must never be hardcoded.');
}

console.log(JSON.stringify({
  status: 'passed',
  rawEntries: PANTHEON_SOURCE_REGISTRY_DIAGNOSTICS.rawEntries,
  executableCanonicalUrls: PANTHEON_SOURCE_REGISTRY_DIAGNOSTICS.executableCanonicalUrls,
  excludedCanonicalUrls: PANTHEON_SOURCE_REGISTRY_DIAGNOSTICS.excludedCanonicalUrls,
  duplicateReferences: PANTHEON_SOURCE_REGISTRY_DIAGNOSTICS.duplicateReferences,
}));
