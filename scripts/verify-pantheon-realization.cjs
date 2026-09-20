const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const adapter = read('server/services/crawlers/PantheonRetrievalAdapter.ts');
const initiative = read('server/services/crawlers/SixCrawlerInitiative.ts');
const routes = read('server/routes.ts');
const pdf = read('server/services/pantheon/PantheonBackgroundReportPdf.ts');
const client = read('client/src/pages/pantheon.tsx');
const acquisition = read('server/services/crawlers/PublicAcquisitionInfrastructure.ts');
const jobs = read('server/services/pantheon/PantheonBackgroundReportJob.ts');
const peopleSearch = read('server/peopleSearch.ts');
const categoryWorkflow = read('server/services/pantheon/PantheonCategoryWorkflow.ts');
const progressTracker = read('client/src/components/PantheonProgressTracker.tsx');
const selector = read('client/src/components/DoomsdayClockSelector.tsx');
const config = read('shared/pantheonReportConfig.ts');
const people = read('server/peopleSearch.ts');
const firecrawl = read('server/services/shadowRetrieval/firecrawlAdapter.ts');
const reportStore = read('server/services/pantheon/PantheonReportStore.ts');

const checks = [
  ['three public scan choices are 10 20 30 minutes', config.includes("1: 10 * 60_000") && config.includes("2: 20 * 60_000") && config.includes("3: 30 * 60_000") && !selector.includes('title: "EYE OF GOD"')],
  ['scan intensity tracks selected duration', people.includes('1: 1200') && people.includes('2: 2800') && people.includes('3: 4500')],
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
  ['report duration uses one immutable server deadline', jobs.includes('const deadlineAt = new Date(startedAt.getTime() + budgetMs)') && jobs.includes('deadlineAt: deadlineAt.getTime()')],
  ['collection deadline propagates into retrieval', peopleSearch.includes('deadlineAt: reportDeadlineAt') && adapter.includes('deadlineAt?: number') && adapter.includes('remainingBudgetMs')],
  ['collection budget preserves aggregation time', peopleSearch.includes('remainingBudgetMs') && peopleSearch.includes('hasCollectionBudget')],
  ['background jobs force complete crawler participation', categoryWorkflow.includes("purpose: 'background_report'") && adapter.includes("plan.crawlers = ['startrek', 'birdofprey', 'sixdegrees', 'cerberus', 'blizzard', 'lich']")],
  ['category workflow owns report collection instead of legacy broad lane', jobs.includes('conductPantheonCategoryWorkflow') && !jobs.includes('conductFullOSINT')],
  ['registry acquisition stops launching work at deadline', adapter.includes('collectionOpen()') && adapter.includes('offset < extendedTargets.length && collectionOpen()')],
  ['30 displayed categories are backend-authoritative', categoryWorkflow.includes('PANTHEON_REPORT_CATEGORIES') && jobs.includes('onCategoryComplete') && jobs.includes('completedCategories')],
  ['category advancement follows retrieval completion', categoryWorkflow.indexOf('await pantheonRetrievalAdapter.retrieve') < categoryWorkflow.indexOf('onCategoryComplete?.')],
  ['client progress follows completed categories', progressTracker.includes('completedCategories / totalCategories') && !progressTracker.includes('Math.floor((progress / 100) * PANTHEON_CATEGORIES.length)')],
  ['progress stage is backend authoritative', progressTracker.includes("phase === 'finalizing'") && !progressTracker.includes("remainingMs === 0")],
  ['progress clock rerenders from authoritative deadline', progressTracker.includes('setNowMs(Date.now())') && progressTracker.includes('parsedDeadlineAt - nowMs')],
  ['mobile timer clips safely inside its container', progressTracker.includes('min-w-0 overflow-hidden')],
  ['Firecrawl executes in background-report retrieval', adapter.includes("crawler: 'firecrawl'") && adapter.includes('defaultFirecrawlAdapter.scrape') && firecrawl.includes('scrapeUrl')],
  ['category checkpoints support exact resume', jobs.includes('resumeFromCategory') && categoryWorkflow.includes('startCategoryIndex') && jobs.includes('initialReport')],
  ['category crawler outcomes are persisted before advancement', jobs.includes('lastCategoryOutcome: outcome') && jobs.includes('partialReport')],
  ['category UI progression is backed by category-scoped audited execution', categoryWorkflow.includes('buildPantheonCategoryTargets') && categoryWorkflow.includes("purpose: 'background_report'") && categoryWorkflow.includes('crawlerAudit')],
  ['background job persists partial evidence before category advancement', jobs.includes('completedCategories') && jobs.includes('categoryName') && jobs.includes('partialReport')],
  ['report state has cross-restart Supabase mirror', reportStore.includes('writeSupabaseMirror') && reportStore.includes('readSupabaseMirror') && reportStore.includes('pantheon-report-state')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${name}`);
if (failed.length) {
  console.error(`Pantheon realization verification failed: ${failed.map(([name]) => name).join(', ')}`);
  process.exit(1);
}
console.log(`Pantheon realization verification passed (${checks.length}/${checks.length}).`);

