const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function must(condition, message) {
  if (!condition) {
    console.error('LEXARA CANONICAL RUNTIME VERIFY FAIL:', message);
    process.exitCode = 1;
  } else {
    console.log('✓', message);
  }
}

const genie = read('server/services/genie-controller/index.ts');
const genieRoutes = read('server/routes/genie.routes.ts');
const maintenance = read('server/maintenanceWorker.ts');
const crawlerRegistry = read('server/lexara/LexaraCrawlerCapabilityRegistry.ts');
const neuralFacade = read('server/lexara/LexaraNeuralModule.ts');
const fourJi = read('server/fourJIOrchestrator.ts');
const cognitive = read('server/cognitiveCore.ts');
const legalWhat = read('server/services/4ji-orchestrator/legalwhat-orchestrator.ts');
const canonicalService = read('server/services/lexara/index.ts');
const legacyService = read('server/services/alexara/index.ts');
const legacyNeural = read('server/alexaraModule.ts');
const backgroundBoundary = read('server/lexara/LexaraBackgroundResearchBoundary.ts');
const serverIndex = read('server/index.ts');
const conversationOrchestrator = read('server/lexara/LexaraConversationOrchestrator.ts');
const lexaraChatRoutes = read('server/routes/lexara.chat.routes.ts');
const consultationRoutes = read('server/routes/consultation.routes.ts');

must(
  canonicalService.includes("from '../alexara'") &&
    canonicalService.includes('Lexara') &&
    canonicalService.includes('getLexara') &&
    canonicalService.includes('LexaraConfig'),
  'one canonical Lexara service entry point exposes the existing legal capabilities',
);

must(
  genie.includes("from '../lexara'") &&
    genie.includes('private lexara: Lexara | null = null') &&
    genie.includes('this.lexara = getLexara()') &&
    genie.includes('routeToLexara') &&
    genie.includes("canonicalRoutedTo = 'LEXARA'") &&
    genie.includes("routedTo = 'ALEXARA'; // compatibility label only") &&
    genie.includes('getLexara(): Lexara | null'),
  'Genie routes active legal work through canonical Lexara names and service entry point',
);

must(
  genieRoutes.includes("router.get('/lexara/status', lexaraStatusHandler)") &&
    genieRoutes.includes("router.post('/lexara/research', lexaraResearchHandler)") &&
    genieRoutes.includes("router.post('/lexara/document', lexaraDocumentHandler)") &&
    genieRoutes.includes("router.get('/alexara/status', lexaraStatusHandler)") &&
    genieRoutes.includes("router.post('/alexara/research', lexaraResearchHandler)") &&
    genieRoutes.includes("router.post('/alexara/document', lexaraDocumentHandler)"),
  'canonical Lexara Genie routes are live while historical routes remain no-break aliases',
);

must(
  maintenance.includes("import('./services/lexara/index')") &&
    !maintenance.includes("import('./services/alexara/index')"),
  'maintenance validates the canonical Lexara service instead of the historical path',
);

must(
  crawlerRegistry.includes('server/services/lexara/instantLegalCrawler.ts') &&
    !crawlerRegistry.includes('server/services/alexara/instantLegalCrawler.ts'),
  'Lexara crawler capability metadata points at the canonical service path',
);

must(
  neuralFacade.includes("from '../alexaraModule'") &&
    neuralFacade.includes('getLexaraNeuralModule') &&
    fourJi.includes("from './lexara/LexaraNeuralModule'") &&
    cognitive.includes("from './lexara/LexaraNeuralModule'") &&
    !fourJi.includes("from './alexaraModule'") &&
    !cognitive.includes("from './alexaraModule'"),
  'active neural consumers use the canonical Lexara facade while the old module remains compatibility-only',
);

must(
  legalWhat.includes('initializeLexara') &&
    legalWhat.includes("DomainFirewall.storeState(Domain.LEGAL_WHAT, 'lexara'") &&
    legalWhat.includes('lexaraOnline') &&
    !legalWhat.includes('initializeAlexara') &&
    !legalWhat.includes("DomainFirewall.storeState(Domain.LEGAL_WHAT, 'alexara'"),
  'active LegalWhat orchestration stores and reports Lexara under the canonical identity',
);

must(
  backgroundBoundary.includes("from './LexaraBackgroundInvestigation'") &&
    !backgroundBoundary.includes('LexaraPantheonInvestigation') &&
    !backgroundBoundary.includes('PantheonDiscoveryCoordinator') &&
    !backgroundBoundary.includes('discoverPantheonSourcesParallel'),
  'legacy Lexara background imports cannot silently reconnect the live runtime to Pantheon',
);

must(
  legacyService.includes('export const getAlexara = getLexara') &&
    legacyService.includes('export { Lexara as Alexara }') &&
    legacyNeural.includes('export class LexaraNeuralModule extends EventEmitter') &&
    legacyNeural.includes('export const getALEXARA = getLexaraNeuralModule') &&
    legacyNeural.includes('Compatibility exports for historical callers'),
  'old Alexara names are compatibility shims only, not separate runtime authorities',
);

for (const [name, source] of [
  ['server/index.ts', serverIndex],
  ['LexaraConversationOrchestrator.ts', conversationOrchestrator],
  ['lexara.chat.routes.ts', lexaraChatRoutes],
  ['consultation.routes.ts', consultationRoutes],
  ['fourJIOrchestrator.ts', fourJi],
  ['cognitiveCore.ts', cognitive],
  ['maintenanceWorker.ts', maintenance],
  ['genie-controller/index.ts', genie],
]) {
  must(
    !/from ['"][^'"]*(?:services\/alexara|alexaraModule)['"]|import\(['"][^'"]*(?:services\/alexara|alexaraModule)/.test(source),
    `active runtime does not bypass the canonical Lexara boundary: ${name}`,
  );
}

console.log('PASS: active LegalWhat runtime uses one canonical Lexara identity with bounded compatibility aliases.');
