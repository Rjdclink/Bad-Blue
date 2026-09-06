'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const requirePattern = (source, pattern, description) => {
  if (!pattern.test(source)) throw new Error(`[production-pressure-evidence] missing invariant: ${description}`);
};
const forbidPattern = (source, pattern, description) => {
  if (pattern.test(source)) throw new Error(`[production-pressure-evidence] forbidden regression: ${description}`);
};

const logger = read('server/logger.ts');
const poolWorker = read('server/services/cryptocrawl/integration/cryptara-supabase-admission-worker.ts');
const stream = read('server/services/cryptocrawl/intelligence/cex-order-book-stream.ts');
const evidence = read('server/services/cryptocrawl/integration/dynamic-profitability-admission-wiring.ts');

// Railway console protection is narrowly scoped to repetitive production INFO.
requirePattern(logger, /HIGH_FREQUENCY_PRODUCTION_SUMMARIES/, 'bounded high-frequency summary allowlist exists');
requirePattern(logger, /NODE_ENV[^\n]{0,120}production/, 'sampling is production-only');
requirePattern(logger, /String\(info\.level\)\.toLowerCase\(\)\s*!==\s*'info'/, 'warnings/errors bypass the sampler');
requirePattern(logger, /new winston\.transports\.Console\(\{\s*format:\s*consoleFormat\s*\}\)/, 'sampler is attached to console transport');
requirePattern(logger, /new winston\.transports\.File\([\s\S]{0,180}error\.log/, 'error file transport remains present');
requirePattern(logger, /new winston\.transports\.File\([\s\S]{0,180}combined\.log/, 'combined file transport remains present');
requirePattern(logger, /consoleSuppressedSinceLastEmit/, 'sampled summaries retain suppression counts');

// Autonomous Supabase custodian: zero extra pool, no operator loop, measured pressure only.
forbidPattern(poolWorker, /\bnew\s+Pool\s*\(/, 'custodian creating a second pool');
forbidPattern(poolWorker, /pool_saturation/, 'healthy full utilization being labeled pressure');
forbidPattern(poolWorker, /stats\.total\s*>=\s*ceiling[\s\S]{0,120}stats\.idle\s*===\s*0/, 'full utilization alone triggering contraction');
requirePattern(poolWorker, /operatorPromptsRequired:\s*false/, 'custodian requires no operator questions');
requirePattern(poolWorker, /interventionPolicy:\s*'measured_pressure_only'/, 'custodian is dormant outside measured pressure');
requirePattern(poolWorker, /if\s*\(stats\.waiting\s*>\s*0\)[\s\S]{0,100}this\.contract\('pool_waiters'\)/, 'real node-postgres waiters trigger contraction');
requirePattern(poolWorker, /if\s*\(acquireMs\s*>=\s*PRESSURE_ACQUIRE_MS\)[\s\S]{0,100}this\.contract\('slow_admission'\)/, 'slow connection acquisition triggers contraction');
requirePattern(poolWorker, /PRESSURE_HOLD_MS/, 'long checkout pressure remains detected');
requirePattern(poolWorker, /AGE_PROMOTION_MS/, 'priority aging prevents starvation');

// Quote freshness must never masquerade as websocket transport failure.
requirePattern(stream, /const\s+transportStaleMs\s*=\s*this\.staleMs\(\)/, 'independent transport-health clock exists');
requirePattern(stream, /state\.book\.isStale\(transportStaleMs\)/, 'stream reset uses transport-health threshold');
forbidPattern(stream, /state\.book\.isStale\(maxAgeMs\)/, 'caller execution freshness resetting the websocket');
requirePattern(stream, /state\.book\.isFresh\(maxAgeMs\)/, 'strict caller quote freshness remains enforced');
requirePattern(stream, /serveStandby\(key,\s*venue,\s*state\.symbol,\s*standby,\s*true\)/, 'actual transport degradation is explicitly marked');
requirePattern(stream, /serveStandby\(key,\s*venue,\s*state\.symbol,\s*standby,\s*false\)/, 'freshness-only standby selection is explicitly non-degradation');
requirePattern(stream, /if\s*\(!primaryTransportDegraded\)\s*return\s+quote/, 'freshness-only standby selection cannot emit failure handover telemetry');

// Blocked paper maker evidence must not be a dead end, but it can never gain authority.
requirePattern(evidence, /candidate\.topology\s*!==\s*'MAKER_CEX'/, 'maker topology is explicitly recognized by reacquisition');
requirePattern(evidence, /fully_measured_canonical_maker_plan/, 'missing canonical maker plan is an acquisition target');
requirePattern(evidence, /Paper maker proof accelerates calibration/, 'only the known paper-evidence block is reopened for measurement');
requirePattern(evidence, /makerEvidenceQueue/, 'maker acquisition is queued rather than unbounded');
requirePattern(evidence, /makerEvidenceConcurrency\(\)/, 'maker acquisition has bounded concurrency');
requirePattern(evidence, /evidenceReacquisitionInFlight/, 'maker acquisition shares single-flight protection');
requirePattern(evidence, /resolveCexFeeEvidence\([\s\S]{0,120}forceRefresh:\s*true/, 'maker acquisition requests direct authenticated fee refresh');
requirePattern(evidence, /evaluateMakerRecoveryCandidate\(/, 'existing canonical maker evaluator is reused');
requirePattern(evidence, /paperEvidenceExecutionAuthority:\s*false/, 'paper evidence never receives execution authority');
requirePattern(evidence, /shadowPriorityExecutionAuthority:\s*false/, 'shadow prioritization never receives execution authority');
requirePattern(evidence, /hotPathExecutionAuthority:\s*false/, 'evidence worker cannot execute');
forbidPattern(evidence, /paperEvidenceExecutionAuthority:\s*true/, 'paper evidence promoted to execution authority');
forbidPattern(evidence, /shadowPriorityExecutionAuthority:\s*true/, 'shadow score promoted to execution authority');

console.log('[production-pressure-evidence] Railway console budget, autonomous Supabase custody, CEX transport/freshness separation, and bounded maker evidence reacquisition invariants passed');
