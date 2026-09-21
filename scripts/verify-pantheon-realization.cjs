const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const adapter = read('server/services/crawlers/PantheonRetrievalAdapter.ts');
const orchestrator = read('server/services/pantheonCrawlerOrchestrator.ts');
const initiative = read('server/services/crawlers/SixCrawlerInitiative.ts');
const routes = read('server/routes.ts');
const pdf = read('server/services/pantheon/PantheonBackgroundReportPdf.ts');
const client = read('client/src/pages/pantheon.tsx');
const acquisition = read('server/services/crawlers/PublicAcquisitionInfrastructure.ts');
const jobs = read('server/services/pantheon/PantheonBackgroundReportJob.ts');
const peopleSearch = read('server/peopleSearch.ts');
const categoryWorkflow = read('server/services/pantheon/PantheonCategoryWorkflow.ts');

const checks = [
  ['durable report status is retryable', routes.includes('report_store_converging') && routes.includes("Retry-After")],
  ['client retries transient report-store status', client.includes('[404, 429, 502, 503, 504]')],
  ['downloadable PDF route exists', routes.includes('/api/osint/report-jobs/:reportId/download')],
  ['PDF includes provenance/crawler audit', pdf.includes('crawlerAudit') && pdf.includes('Source Provenance')],
  ['all primary crawler execution isolated', adapter.includes('searchAllIsolatedWithAudit')],
  ['razor extraction participates', adapter.includes('deployBackgroundReport')],
  ['Cain/Reaper supervision participates', adapter.includes('cainReaperSupervisor.supervise')],
  ['seven-crawler evidence analysis participates', adapter.includes('SixCrawlerInitiative') && adapter.includes('seven-crawler-initiative')],
  ['USC has real executor dispatch', initiative.includes('registerExecutor') && initiative.includes('await executor(task.task)')],
  ['credential-free public acquisition participates', adapter.includes('acquirePublicResources') && acquisition.includes('Private-network acquisition is not permitted')],
  ['external failures are route-local', adapter.includes('Promise.allSettled')],
  ['discovery expressions are separated from URL acquisition', adapter.includes('new URL(firstTarget)') && adapter.includes('const urlTargets = request.targets.filter')],
  ['report duration uses one immutable server deadline', jobs.includes('deadlineAt') && jobs.includes('deadlineAt: deadlineAt.getTime()')],
  ['canonical report job uses sequential category controller', jobs.includes('conductPantheonCategoryWorkflow') && categoryWorkflow.includes('PANTHEON_REPORT_CATEGORIES')],
  ['category controller passes subject context to crawler orchestration', categoryWorkflow.includes('subject: input.name') && categoryWorkflow.includes('location: input.location')],
  ['deadline finalizes unrun categories explicitly', categoryWorkflow.includes('remaining categories are explicitly marked timed out')],
  ['collection deadline propagates into retrieval', categoryWorkflow.includes('deadlineAt: Math.min(input.deadlineAt') && adapter.includes('deadlineAt?: number') && adapter.includes('remainingBudgetMs')],
  ['collection budget preserves aggregation time', categoryWorkflow.includes('finalizationReserveMs') && categoryWorkflow.includes('categoryBudgetMs')],
  ['background categories force complete crawler participation', categoryWorkflow.includes("purpose: 'background_report'") && adapter.includes("plan.crawlers = ['startrek', 'birdofprey', 'sixdegrees', 'cerberus', 'blizzard', 'lich']")],
  ['category controller is the report-job collection authority', jobs.includes('conductPantheonCategoryWorkflow') && !jobs.includes('conductFullOSINT')],
  ['registry acquisition stops launching work at deadline', adapter.includes('collectionOpen()') && adapter.includes('offset < extendedTargets.length && collectionOpen()')],
  ['category retrieval failures are localized', categoryWorkflow.includes("crawler: 'category-orchestrator'") && categoryWorkflow.includes("status: 'failed'")],
  ['reportable evidence is subject-gated', categoryWorkflow.includes('isReportableEvidence') && categoryWorkflow.includes('subjectMatches')],
  ['zero-confidence crawler attempts are excluded from evidence', adapter.includes('result.confidence > 0') && adapter.includes('result.content?.trim()')],
  ['isolated crawler retries obey collection deadline', orchestrator.includes('const deadlineAt = options.timeout ? Date.now()') && orchestrator.includes("Crawler collection deadline reached") && orchestrator.includes('deadlineAt - Date.now()')],
  ['orchestrator initialization honors requested investigation budget', orchestrator.includes('Math.max(1, options.timeout || 600000)') && !orchestrator.includes('Math.max(600000, options.timeout || 0)')],
  ['isolated crawler evidence requires finite positive confidence', orchestrator.includes('Number.isFinite(result.confidence)') && orchestrator.includes('result.content?.trim()')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${name}`);
if (failed.length) {
  console.error(`Pantheon realization verification failed: ${failed.map(([name]) => name).join(', ')}`);
  process.exit(1);
}
console.log(`Pantheon realization verification passed (${checks.length}/${checks.length}).`);
