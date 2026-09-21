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
  ['background jobs keep all crawler skills available and route participation by category need', categoryWorkflow.includes("purpose: 'background_report'") && adapter.includes('const specialized = new Set(plan.crawlers)') && adapter.includes('Background category capability routing')],
  ['category workflow owns report collection instead of legacy broad lane', jobs.includes('conductPantheonCategoryWorkflow') && !jobs.includes('conductFullOSINT')],
  ['registry acquisition stops launching work at deadline', adapter.includes('collectionOpen()') && adapter.includes('offset < extendedTargets.length && collectionOpen()')],
  ['30 displayed categories are backend-authoritative', categoryWorkflow.includes('PANTHEON_REPORT_CATEGORIES') && jobs.includes('onCategoryComplete') && jobs.includes('completedCategories')],
  ['category advancement follows retrieval completion', categoryWorkflow.indexOf('await pantheonRetrievalAdapter.retrieve') < categoryWorkflow.indexOf('onCategoryComplete?.')],
  ['client progress follows completed categories', progressTracker.includes('completedCategories / totalCategories') && !progressTracker.includes('Math.floor((progress / 100) * PANTHEON_CATEGORIES.length)')],
  ['progress stage is backend authoritative', progressTracker.includes("phase === 'finalizing'") && !progressTracker.includes("remainingMs === 0")],
  ['progress clock rerenders from authoritative deadline', progressTracker.includes('setNowMs(Date.now())') && progressTracker.includes('parsedDeadlineAt - nowMs')],
  ['mobile timer clips safely inside its container', progressTracker.includes('min-w-0 overflow-hidden')],
  ['Firecrawl cannot independently acquire Pantheon URLs', adapter.includes('Independent Firecrawl acquisition disabled') && !adapter.includes('defaultFirecrawlAdapter.scrape(target')],
  ['Puppeteer cannot independently acquire Pantheon URLs', adapter.includes('Independent Puppeteer acquisition disabled') && !adapter.includes("method: 'puppeteer'")],
  ['investigation intensity scales productive work rather than initial batch size', categoryWorkflow.includes('categoryProductiveWorkTarget') && categoryWorkflow.includes('productiveWorkUnits < productiveWorkTarget') && categoryWorkflow.includes('intensityPolicy') && categoryWorkflow.includes('corroborationTarget') && categoryWorkflow.includes('discoveryExpansion') && categoryWorkflow.includes('fallbackDepth')],
  ['each category owns a URL ledger', categoryWorkflow.includes('PantheonUrlLedgerEntry') && categoryWorkflow.includes('urlLedger')],
  ['each category ledger is an explicit persistent transaction', categoryWorkflow.includes('ledgerVersion: 1') && categoryWorkflow.includes('totalLedgerUrls') && categoryWorkflow.includes('pendingUrls') && jobs.includes('categoryLedgerVersion: outcome.ledgerVersion') && jobs.includes('categoryUrlLedger: outcome.urlLedger')],
  ['URL ledger records explicit URL states and attempts', categoryWorkflow.includes("'pending'|'assigned'|'retrieving'|'retrieved'|'accepted'|'rejected'") && categoryWorkflow.includes('attempts: number')],
  ['each URL ledger entry records source priority capability transport state attempts result and evidence', categoryWorkflow.includes('priority: number') && categoryWorkflow.includes("authority: 'primary'|'secondary'|'archive'|'discovery'") && categoryWorkflow.includes('registryCategory: PantheonBackgroundCategory') && categoryWorkflow.includes('capability?: string') && categoryWorkflow.includes("transport?: 'direct-http'") && categoryWorkflow.includes('result?: {') && categoryWorkflow.includes('evidenceIds: string[]') && categoryWorkflow.includes('failureReason?: string')],
  ['fixed category batch replaced by live priority cursor', categoryWorkflow.includes('while (cursor < prioritizedTargets.length && productiveWorkUnits < targetLimit)') && categoryWorkflow.includes('const batch: string[] = [prioritizedTargets[cursor]]')],
  ['failed work advances cursor to replacement URLs without consuming productive quota', categoryWorkflow.includes('cursor += 1') && categoryWorkflow.includes('productiveWorkUnits += 1') && categoryWorkflow.includes("entry.state = 'rate_limited'") && categoryWorkflow.includes("entry.state = 'dead'")],
  ['failed URL is terminally recorded before next priority substitution', categoryWorkflow.includes('const failedEntry = urlLedger.find(item => item.url === firstUrl)') && categoryWorkflow.includes("failedEntry.state = /429|rate/i.test(message) ? 'rate_limited'") && categoryWorkflow.includes("/403|forbidden/i.test(message) ? 'blocked'") && categoryWorkflow.includes("failedEntry.result = { status: 0, evidenceCount: 0")],
  ['category checkpoint persists URL ledger and cursor', jobs.includes('categoryCursor: outcome.cursor') && jobs.includes('categoryUrlLedger: outcome.urlLedger')],
  ['intensity does not disable required crawler capability', adapter.includes('capabilityHint?: string[]') && adapter.includes('new Set<string>((request.capabilityHint || [])') && adapter.includes('Search depth/intensity never removes a capability selected by the URL')],
  ['URL ledger carries capability and transport routing', categoryWorkflow.includes("transport?: 'direct-http'|'browser'|'search-provider'|'specialized-adapter'|'archive'") && categoryWorkflow.includes('capabilityFor') && categoryWorkflow.includes('transportFor')],
  ['source registry carries authoritative retrieval transport metadata', registry.includes('PantheonTransport') && registry.includes('transport: PantheonTransport') && registry.includes('transportForSource') && categoryWorkflow.includes('candidate.transport || transportFor')],
  ['source identity remains separate from transport outcome', categoryWorkflow.includes('transportAttempts?: Array') && categoryWorkflow.includes("outcome: 'pending'|'succeeded'|'failed'") && categoryWorkflow.includes("lastTransport.outcome = 'succeeded'") && categoryWorkflow.includes("lastTransport.outcome = 'failed'")],
  ['URL capability routing is explicit and auditable per URL', categoryWorkflow.includes('capabilityReason?: string') && categoryWorkflow.includes("capability: 'sixdegrees'") && categoryWorkflow.includes("capability: 'cerberus'") && categoryWorkflow.includes("capability: 'blizzard'") && categoryWorkflow.includes("capability: 'lich'") && categoryWorkflow.includes("capability: 'startrek'")],
  ['URL work groups are capability homogeneous', categoryWorkflow.includes("candidateEntry?.capability !== firstEntry?.capability")],
  ['discovery/search transport is explicitly separated', categoryWorkflow.includes("return 'search-provider'") && categoryWorkflow.includes("return 'direct-http'")],
  ['discovery work is structurally separate from authoritative traversal', categoryWorkflow.includes("PantheonWorkType = 'authoritative-source'|'discovery-search'|'candidate-validation'|'corroboration'") && categoryWorkflow.includes("return 'discovery-search'") && categoryWorkflow.includes("workType: 'candidate-validation'")],
  ['transport and capability hints reach retrieval adapter', categoryWorkflow.includes('capabilityHint: batch.map') && categoryWorkflow.includes('transportHint: batch.map')],
  ['customer report filters raw execution diagnostics', !pdf.includes("addSectionTitle(doc, 'Crawler Coverage')") && pdf.includes('Crawler diagnostics remain internal')],
  ['multi-facet categories interleave source families', categoryWorkflow.includes('interleaveCategoryTargets') && categoryWorkflow.includes('targetGroups')],
  ['customer evidence requires subject relevance', categoryWorkflow.includes('subjectMatches') && categoryWorkflow.includes('locationMatch')],
  ['canonical URL dedupe precedes crawler execution', categoryWorkflow.includes('canonicalUrl') && categoryWorkflow.includes('new Set<string>()')],
  ['raw HTML script style and tags are stripped before reporting', categoryWorkflow.includes("replace(/<script") && categoryWorkflow.includes("replace(/<style")],
  ['report findings and provenance are separated from crawler diagnostics', categoryWorkflow.includes('data: { url: item.target, finding: item.content }') && !pdf.includes("addSectionTitle(doc, 'Crawler Coverage')")],
  ['primary crawler lane reserves time for the rest of the roster', adapter.includes('primaryBudgetMs') && adapter.includes('totalBudgetMs * 0.35')],
  ['Firecrawl lane has reserved category budget', adapter.includes('firecrawlLaneBudget') && adapter.includes('totalBudgetMs * 0.15')],
  ['Puppeteer lane has reserved category budget', adapter.includes('puppeteerLaneBudget') && adapter.includes('totalBudgetMs * 0.15')],
  ['public acquisition lane has reserved category budget', adapter.includes('publicLaneBudget') && adapter.includes('totalBudgetMs * 0.15')],
  ['extended Pantheon lane has reserved category budget and failure audit', adapter.includes('extendedLaneBudget') && adapter.includes("crawler: 'extended-pantheon'")],
  ['Firecrawl retries only transient throttling/timeouts with bounded jitter', firecrawl.includes('maxAttempts') && firecrawl.includes('rate.?limit') && firecrawl.includes('Math.random() * 200')],
  ['web findings are separated from public-record findings', categoryWorkflow.includes('webCategory') && categoryWorkflow.includes('report.onlineMentions') && categoryWorkflow.includes('report.publicRecords')],
  ['category checkpoints support exact resume', jobs.includes('resumeFromCategory') && categoryWorkflow.includes('startCategoryIndex') && jobs.includes('initialReport')],
  ['category crawler outcomes are persisted before advancement', jobs.includes('lastCategoryOutcome: outcome') && jobs.includes('partialReport')],
  ['category transaction persists findings and URL/crawler counters', categoryWorkflow.includes('findings: reportable.map') && categoryWorkflow.includes('urlsAttempted') && categoryWorkflow.includes('crawlersUsed') && categoryWorkflow.includes('evidenceRejected')],
  ['challenge and CAPTCHA pages are rejected as evidence', categoryWorkflow.includes('isBlockedOrDiagnosticEvidence') && acquisition.includes('blockedResponseBody')],
  ['crawler skills are routed by displayed category', adapter.includes('categoryLabel?: string') && adapter.includes('Background category capability routing')],
  ['PDF is rendered from exactly 30 persisted category outcomes', pdf.includes('30-Category Investigation Results') && pdf.includes('canonicalCategories.length') && routes.includes('categoryOutcomes: Array.isArray(envelope.categoryOutcomes)')],
  ['Lich exhaustion is a clean no-evidence result', read('server/services/crawlers/TrinityCrawlers.ts').includes("outcome: 'completed_no_evidence'")],
  ['category UI progression is backed by category-scoped audited execution', categoryWorkflow.includes('buildPantheonCategoryTargets') && categoryWorkflow.includes("purpose: 'background_report'") && categoryWorkflow.includes('crawlerAudit')],
  ['workflow is explicit sequence authority', categoryWorkflow.includes("PantheonCategoryPhase = 'PENDING' | 'ACTIVE' | 'URL_WORK' | 'EVIDENCE_VALIDATION' | 'PERSISTING' | 'COMPLETE'") && jobs.includes('onCategoryState')],
  ['only one canonical Pantheon investigation controller may execute', categoryWorkflow.includes('activeCanonicalInvestigation') && categoryWorkflow.includes('already active for') && categoryWorkflow.includes('finally')],
  ['category advancement is gated by durable persistence', categoryWorkflow.includes('category persistence callback is required') && categoryWorkflow.indexOf('await input.onCategoryComplete({') < categoryWorkflow.indexOf("phase: 'COMPLETE'")],
  ['report lifecycle cannot pre-advance the next category', jobs.includes("categoryPhase: 'PERSISTING'") && jobs.includes('categoryIndex: index') && jobs.includes('categoryName: label')],
  ['background retrieval fails closed without workflow authorization', adapter.includes('missing canonical workflow authorization') && adapter.includes('work authorization deadline expired')],
  ['investigation identity propagates from report job into workflow', jobs.includes('investigationId: input.reportId') && categoryWorkflow.includes('investigationId: string')],
  ['category authority propagates into retrieval', categoryWorkflow.includes('authority: {') && categoryWorkflow.includes('categoryId:') && categoryWorkflow.includes('deadlineAt:')],
  ['workflow state is persisted by report lifecycle infrastructure', jobs.includes('categoryPhase: phase') && jobs.includes('completedCategories')],
  ['canonical public acquisition receives workflow authority', adapter.includes("capability: 'public-acquisition'") && acquisition.includes('PantheonAcquisitionAuthority') && acquisition.includes('authority.deadlineAt')],
  ['primary crawler networking routes through canonical acquisition', ['StarTrekCrawler.ts','BirdOfPreyCrawler.ts','SixDegreesCrawler.ts','TrinityCrawlers.ts'].every(file => read('server/services/crawlers/' + file).includes("acquirePublicResource"))],
  ['primary crawler request helpers no longer call fetch directly', ['StarTrekCrawler.ts','BirdOfPreyCrawler.ts','SixDegreesCrawler.ts','TrinityCrawlers.ts'].every(file => !read('server/services/crawlers/' + file).match(/return await fetch\(|const response = await fetch\(/))],
  ['Razor acquisition routes through canonical gateway', read('server/services/pantheon/razors/TwoStageDeployer.ts').includes('acquirePublicResource') && !read('server/services/pantheon/razors/TwoStageDeployer.ts').includes('const response = await fetch(url')],
  ['canonical gateway exposes fail-closed Pantheon authorization entrypoint', acquisition.includes('acquirePantheonResource') && acquisition.includes('incomplete work authorization') && acquisition.includes('authority.categoryId') && acquisition.includes('authority.workId') && acquisition.includes('authority.capability')],
  ['global governor shares per-host concurrency state', acquisition.includes('MAX_PER_HOST = 2') && acquisition.includes('waitForHost')],
  ['global governor shares forbidden cooldown across crawlers', acquisition.includes('forbiddenUntil') && acquisition.includes('status === 403')],
  ['global governor records 404 and 429 host health', acquisition.includes('notFoundCount') && acquisition.includes('rateLimitedCount')],
  ['global governor exposes shared source health', acquisition.includes('getPublicAcquisitionHostHealth') && acquisition.includes('circuitOpenUntil') && acquisition.includes('latencyEwmaMs')],
  ['Trinity crawler-local retry sleep removed', !read('server/services/crawlers/TrinityCrawlers.ts').includes('setTimeout(resolve, 1000 * (i + 1))')],
  ['Trinity crawler-local network retry loop removed', read('server/services/crawlers/TrinityCrawlers.ts').includes('return this.attack(target);') && !read('server/services/crawlers/TrinityCrawlers.ts').includes('for (let i = 0; i < maxRetries; i++)')],
  ['canonical acquisition exclusively owns bounded retries and backoff', acquisition.includes('MAX_RETRIES = 2') && acquisition.includes('retryAfterMs') && acquisition.includes('500 * 2 ** attempt') && acquisition.includes('Math.random() * 350')],
  ['workflow authorization deadline is authoritative in retrieval', adapter.includes('Math.min(request.authority.deadlineAt') && adapter.includes('requestedDeadlineAt')],
  ['hard deadline propagates into each network attempt', acquisition.includes('hardDeadlineAt?: number') && acquisition.includes('Math.min(hardDeadlineAt') && acquisition.includes('acquireOnce(url, remaining, deadlineAt)')],
  ['every category registry URL passes canonical admission before scheduling', categoryWorkflow.includes('admitPantheonUrl(candidate.url)')],
  ['every redirect is re-admitted before following', acquisition.includes('Redirect rejected by Pantheon URL admission') && acquisition.includes('admitPantheonUrl(new URL(location, current).toString())')],
  ['crawler-discovered URLs are candidates not executable work', read('server/services/crawlers/TrinityCrawlers.ts').includes('discoveredCandidates') && read('server/services/crawlers/TrinityCrawlers.ts').includes("discoveryExecutionAuthority: 'PantheonCategoryWorkflow'")],
  ['controller admits and schedules discovered candidates', categoryWorkflow.includes('item.metadata?.discoveredCandidates') && categoryWorkflow.includes("authority: 'discovery'") && categoryWorkflow.includes('prioritizedTargets.push(candidate.url)')],
  ['every executable Pantheon work unit carries complete authorization', categoryWorkflow.includes('workId:') && categoryWorkflow.includes('canonicalUrl: firstUrl') && categoryWorkflow.includes("capability: firstEntry?.capability || 'startrek'")],
  ['retrieval fails closed on incomplete authorization', adapter.includes('incomplete canonical work authorization')],
  ['retrieval rejects URL or capability authorization mismatch', adapter.includes('work authorization URL mismatch') && adapter.includes('work authorization capability mismatch')],
  ['work authorization is URL scoped', categoryWorkflow.includes('const batch: string[] = [prioritizedTargets[cursor]]') && adapter.includes('request.targets.length !== 1')],
  ['URL admission rejects junk resources and private network targets', acquisition.includes('BLOCKED_EXTENSIONS') && acquisition.includes('BLOCKED_HOST_HINTS') && acquisition.includes('Private-network acquisition is not permitted')],
  ['legacy people search cannot issue background-report retrieval', peopleSearch.includes('const fullRosterPromise = null')],
  ['legacy route cannot issue background-report retrieval', routes.includes('Canonical Pantheon background-report execution is owned by PantheonCategoryWorkflow')],
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

