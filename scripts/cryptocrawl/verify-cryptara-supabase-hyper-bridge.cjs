'use strict';

const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(file, 'utf8');
const requirePattern = (source, pattern, description) => {
  if (!pattern.test(source)) throw new Error(`[supabase-hyper-bridge] missing invariant: ${description}`);
};
const forbidPattern = (source, pattern, description) => {
  if (pattern.test(source)) throw new Error(`[supabase-hyper-bridge] forbidden regression: ${description}`);
};

const cryptoRoot = 'server/services/cryptocrawl';
const bridge = read(`${cryptoRoot}/integration/cryptara-supabase-hyper-bridge.ts`);
const overflowWorker = read(`${cryptoRoot}/integration/cryptara-overflow-super-worker.ts`);
const gateway = read(`${cryptoRoot}/integration/cryptara-overflow-primary-gateway.ts`);
const overflow = read(`${cryptoRoot}/integration/cryptara-supabase-overflow-worker.ts`);
const superWorker = read(`${cryptoRoot}/integration/cryptara-super-worker.ts`);
const archiveWorker = read(`${cryptoRoot}/integration/cryptara-primary-archive-worker.ts`);
const sourceLedger = read(`${cryptoRoot}/compensation/rainbow-profit-source-ledger.ts`);
const observability = read(`${cryptoRoot}/compensation/rainbow-profit-observability.ts`);
const calibration = read(`${cryptoRoot}/validation/monte-carlo-calibration-store.ts`);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

// One logical information fabric. Overflow is hot runtime/control state. Primary
// is cold archive memory and may be reached only through the explicit archive
// worker and the observable Bridge/gateway boundary.
requirePattern(bridge, /baseOfOperations:\s*'cryptara_local_shared_information_fabric'/, 'local shared-information fabric remains operational base');
requirePattern(bridge, /hotRuntimeAuthority:\s*'overflow'/, 'Bridge snapshot must name Overflow as hot runtime authority');
requirePattern(bridge, /primaryRole:\s*'cold_archive_only'/, 'Bridge snapshot must restrict Primary to cold archive');
requirePattern(bridge, /routing:\s*'application_to_shared_worker_to_overflow_then_explicit_primary_archive_on_miss'/, 'Bridge routing must describe explicit archive-only Primary lookup');
requirePattern(bridge, /primary\?:\s*\(\)\s*=>\s*Promise<T \| null>/, 'Primary loader must be optional rather than a live-read requirement');
requirePattern(bridge, /requestCryptaraOverflowSuperWorker/, 'all bridge reads are delegated to Overflow worker');
requirePattern(bridge, /loadPrimaryUpstream:\s*input\.primary/, 'optional archive loader is handed to the worker instead of called directly');
requirePattern(bridge, /shareCryptaraOverflowInformationWithPrimaryWorker/, 'Overflow results remain shared through common coherence directory');
forbidPattern(bridge, /runReadLane\('primary',\s*input\.primary\)/, 'direct Bridge-to-Primary read branch must not exist');
forbidPattern(bridge, /Promise\.race\s*\(\s*\[?\s*primary|primaryPromise[\s\S]{0,240}overflowPromise[\s\S]{0,240}Promise\.race/, 'Primary and Overflow lanes must never be hedged');
forbidPattern(bridge, /\bnew\s+Pool\s*\(/, 'HyperBridge must not create a database pool');
forbidPattern(bridge, /from\s+['"][^'"]*\/db(?:\.js)?['"]|\bpool\.query\s*\(|\bfetch\s*\(|axios|https?\.request/, 'HyperBridge must not own a database/network origin');
forbidPattern(bridge, /setInterval\s*\(/, 'HyperBridge must not add polling');

// Overflow worker remains bounded and can invoke an archive upstream loader only
// after local/shared + Overflow miss, through the gateway.
requirePattern(overflowWorker, /requestCryptaraSharedInformation/, 'Overflow worker uses shared local broker');
requirePattern(overflowWorker, /primeCryptaraSharedInformation/, 'workers publish into one coherence directory');
requirePattern(overflowWorker, /request\.loadOverflow\(\)[\s\S]{0,2200}request\.loadPrimaryUpstream[\s\S]{0,700}runThroughCryptaraOverflowPrimaryGateway/, 'archive upstream is reachable only after Overflow miss through gateway');
requirePattern(overflowWorker, /directApplicationPrimaryCalls:\s*0\s+as\s+const/, 'worker must expose zero direct application Primary calls');
requirePattern(overflowWorker, /createsDuplicateCache:\s*false\s+as\s+const/, 'worker must reuse shared broker');
requirePattern(overflowWorker, /const\s+inFlight\s*=\s*new\s+Map/, 'upstream acquisitions remain single-flight');
forbidPattern(overflowWorker, /\bnew\s+Pool\s*\(|from\s+['"][^'"]*\/db(?:\.js)?['"]|\bpool\.query\s*\(/, 'Overflow worker must not directly own Primary DB');
forbidPattern(overflowWorker, /setInterval\s*\(|setTimeout\s*\(/, 'Overflow worker must not poll');

// Sole Primary DB consumer inside CryptoCrawler: cold archive worker, no pool of
// its own and no independent runtime authority.
requirePattern(archiveWorker, /pool as primaryPool[\s\S]*from '\.\.\/\.\.\/\.\.\/db\.js'/, 'archive worker must reuse existing Primary pool');
requirePattern(archiveWorker, /runThroughCryptaraOverflowPrimaryGateway/, 'archive worker must route through Bridge/gateway');
requirePattern(archiveWorker, /role:\s*'primary_cold_archive_worker'/, 'archive worker role must be explicit');
requirePattern(archiveWorker, /hotRuntimeAuthority:\s*false/, 'archive worker must have no hot runtime authority');
requirePattern(archiveWorker, /executionAuthority:\s*false/, 'archive worker must have no execution authority');
requirePattern(archiveWorker, /financialAuthority:\s*false/, 'archive worker must have no financial authority');
requirePattern(archiveWorker, /governanceAuthority:\s*false/, 'archive worker must have no governance authority');
forbidPattern(archiveWorker, /\bnew\s+Pool\s*\(/, 'archive worker must not create a second Primary pool');

// Live payout/settlement observability is Overflow-only. It may use the bounded
// Overflow artifact read model, then the canonical Overflow runtime DB; it must
// never supply a Primary loader to the Bridge.
requirePattern(observability, /from '\.\.\/runtime\/cryptocrawl-runtime-database\.js'/, 'payout observability must use Overflow runtime DB');
requirePattern(observability, /readOverflowAuthoritySnapshot/, 'payout observability must expose an Overflow authority read');
requirePattern(observability, /overflow:\s*async\s*\(\)\s*=>/, 'payout observability must provide only Overflow live loader');
forbidPattern(observability, /readPrimarySnapshot|primary:\s*\(\)\s*=>/, 'payout observability must not retain Primary fallback');

// Rainbow source metadata is historical evidence: write hot state to Overflow,
// archive it asynchronously to Primary, and allow exactly one explicit archive
// lookup on a true Overflow miss. An archive hit is rehydrated into Overflow.
requirePattern(sourceLedger, /cryptara-primary-archive-worker\.js/, 'source ledger must use explicit archive worker');
requirePattern(sourceLedger, /queueMicrotask\(\(\)\s*=>\s*\{[\s\S]{0,220}persistPrimaryArchiveSource/, 'source archive write must be asynchronous');
requirePattern(sourceLedger, /queryCryptaraPrimaryArchive\([\s\S]{0,1200}'rainbow_profit_source_write'/, 'source archive write must use archive worker');
requirePattern(sourceLedger, /queryCryptaraPrimaryArchive\([\s\S]{0,700}'rainbow_profit_source_lookup'/, 'historical lookup must use archive worker');
requirePattern(sourceLedger, /primary:\s*\(\)\s*=>\s*readPrimaryArchiveSource\(eventId\)/, 'source ledger may provide explicit archive loader');
requirePattern(sourceLedger, /enqueueOverflowSourceMirror\(source\);[\s\S]{0,120}return source;/, 'archive hit must rehydrate Overflow');

// Prevent future live callers from quietly gaining a Primary loader. Today only
// the historical source ledger is allowed to pass `primary:` to HyperBridge.
const primaryLoaderCallers = walk(cryptoRoot)
  .filter(file => file !== `${cryptoRoot}/integration/cryptara-supabase-hyper-bridge.ts`)
  .filter(file => /readCryptaraHyperBridge(?:<[^>]+>)?\s*\([\s\S]{0,1200}?\bprimary\s*:/.test(read(file)))
  .map(file => file.replaceAll('\\', '/'));
if (primaryLoaderCallers.length !== 1 || primaryLoaderCallers[0] !== `${cryptoRoot}/compensation/rainbow-profit-source-ledger.ts`) {
  throw new Error(`[supabase-hyper-bridge] Primary archive loader callers must equal only Rainbow source ledger; observed ${JSON.stringify(primaryLoaderCallers)}`);
}

// Bridge itself is transport, never a competing authority.
requirePattern(bridge, /authority:\s*'transport_only'/, 'HyperBridge must remain transport-only');
requirePattern(bridge, /writeAuthority:\s*false/, 'HyperBridge has no independent write authority');
requirePattern(bridge, /executionAuthority:\s*false/, 'HyperBridge has no execution authority');
requirePattern(bridge, /financialAuthorityAllowed:\s*false/, 'HyperBridge has no financial authority');
requirePattern(bridge, /governanceAuthorityAllowed:\s*false/, 'HyperBridge has no governance authority');
requirePattern(superWorker, /private readonly inFlight = new Map<string, Promise<CacheEntry>>\(\)/, 'shared worker single-flight remains intact');
requirePattern(superWorker, /execution_truth:\s*0/, 'shared cache retains zero execution truth');

requirePattern(calibration, /enqueueCryptaraHyperBridgeEvent/, 'Monte Carlo calibration still publishes through HyperBridge');
requirePattern(overflow, /SUPABASE_DATABASE_URL_OVERFLOW/, 'single Overflow database variable remains canonical');
forbidPattern(overflow, /CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL|CRYPTOCRAWL_OVERFLOW_DATABASE_URL/, 'legacy Overflow aliases remain forbidden');
requirePattern(gateway, /createsDatabasePool:\s*false\s+as\s+const/, 'gateway creates no pool');
requirePattern(gateway, /directApplicationPrimaryCalls:\s*0\s+as\s+const/, 'gateway reports zero direct application Primary calls');

for (const [name, source] of Object.entries({ bridge, overflowWorker, archiveWorker, sourceLedger, observability, calibration })) {
  forbidPattern(source, /\bhyperscope\b/i, `${name} embeds reference-framework vocabulary into runtime code`);
  forbidPattern(source, /\benhancements\s+list\b/i, `${name} embeds enhancement-list vocabulary into runtime code`);
}

console.log('[supabase-hyper-bridge] PASS: Overflow is the hot runtime/control plane; live payout observability is Overflow-only; the sole Primary loader is explicit historical source archive access through the archive worker/Bridge gateway; no direct Primary lane, duplicate pool, hedge, or polling exists');
