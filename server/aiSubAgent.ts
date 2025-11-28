/**
 * server/aiSubAgent. ts
 *
 * Standalone Sub-Agent module — completely independent from the Worker. 
 *
 * Exports all named functions required by server/routes.ts:
 *   - processSubAgentCommand
 *   - trackUsage
 *   - runComprehensiveDiagnostic
 *   - undoLastSubAgentChange
 *   - getLastSubAgentChange
 *   - setAutonomousExecution
 *   - getAutonomousExecutionStatus
 *   - resetRateLimiter
 *   - applyTrainingToSubAgent
 *
 * Also exports:
 *   - executeAdvancedReasoning (used by server/efficientAI.ts)
 *   - getConfiguredGeminiModel (helper)
 *
 * Implementation notes:
 * - Uses only fs/path/os — safe for minimal build environments (Railway). 
 * - All state is persisted to data/subagent/* so it survives restarts. 
 * - No imports from worker files or external AI SDKs at module load time.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// ─────────────────────────────────────────────────────────────
// Paths & Constants
// ─────────────────────────────────────────────────────────────
const SUBAGENT_DATA_DIR = path.join(process.cwd(), 'data', 'subagent');
const COMMAND_LOG = path.join(SUBAGENT_DATA_DIR, 'commands.log');
const TRAINING_QUEUE = path.join(SUBAGENT_DATA_DIR, 'trainingQueue.json');
const USAGE_LOG = path.join(SUBAGENT_DATA_DIR, 'usage.json');
const CHANGE_HISTORY = path.join(SUBAGENT_DATA_DIR, 'changeHistory.json');
const STATE_FILE = path.join(SUBAGENT_DATA_DIR, 'state.json');

// In-memory state (loaded from disk on first access)
let autonomousExecutionEnabled = false;
let stateLoaded = false;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(SUBAGENT_DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

async function safeReadJson<T = any>(file: string, defaultValue: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

async function atomicWriteJson(file: string, data: any): Promise<void> {
  await ensureDataDir();
  const tmp = `${file}.${Date.now()}. tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  try {
    await fs.rename(tmp, file);
  } catch {
    await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
    try { await fs.unlink(tmp); } catch { /* ignore */ }
  }
}

async function appendLog(record: Record<string, any>): Promise<void> {
  try {
    await ensureDataDir();
    const entry = { timestamp: new Date().toISOString(), ... record };
    await fs.appendFile(COMMAND_LOG, JSON.stringify(entry) + os.EOL, 'utf-8');
  } catch {
    // swallow logging errors
  }
}

async function loadState(): Promise<void> {
  if (stateLoaded) return;
  try {
    const state = await safeReadJson<{ autonomousExecutionEnabled?: boolean }>(STATE_FILE, {});
    autonomousExecutionEnabled = !!state.autonomousExecutionEnabled;
  } catch {
    autonomousExecutionEnabled = false;
  }
  stateLoaded = true;
}

async function saveState(): Promise<void> {
  await atomicWriteJson(STATE_FILE, { autonomousExecutionEnabled });
}

// ─────────────────────────────────────────────────────────────
// Exported Functions
// ─────────────────────────────────────────────────────────────

/**
 * processSubAgentCommand
 * Logs a command request and returns a conservative response.
 */
export async function processSubAgentCommand(opts: {
  command: string;
  category?: string;
  [key: string]: any;
}): Promise<{ success: boolean; response?: string; packagesToInstall?: string[]; fixedCount?: number }> {
  await ensureDataDir();
  await appendLog({ type: 'processCommand', command: opts. command, category: opts.category || 'general' });

  const lowered = (opts.command || '').toLowerCase();
  const packagesToInstall: string[] = [];
  let fixedCount = 0;

  if (lowered.includes('fix') || lowered.includes('patch') || lowered.includes('modify')) {
    return {
      success: true,
      response: 'Sub-Agent: Request logged. Automated repo modifications disabled in this environment.',
      packagesToInstall,
      fixedCount,
    };
  }

  return {
    success: true,
    response: 'Sub-Agent: Command logged.  No automated action taken.',
    packagesToInstall,
    fixedCount,
  };
}

/**
 * executeAdvancedReasoning
 * Placeholder architect-level reasoning (used by efficientAI.ts).
 */
export async function executeAdvancedReasoning(prompt: string, includePlan = false): Promise<{ analysis: string; plan?: any }> {
  await appendLog({ type: 'advancedReasoning', prompt: String(prompt). slice(0, 2000) });

  const analysis = 'Sub-Agent placeholder: advanced reasoning not executed (no AI provider configured).  Request logged for operator review.';

  const plan = includePlan
    ? { strategicPlan: { steps: ['Collect logs', 'Sandbox test', 'Operator review'], confidence: 0.4 } }
    : undefined;

  return { analysis, plan };
}

/**
 * trackUsage
 * Records a usage event to the usage log.
 */
export async function trackUsage(event: { action: string; tokens?: number; provider?: string; [key: string]: any }): Promise<void> {
  await ensureDataDir();
  const usage = await safeReadJson<any[]>(USAGE_LOG, []);
  usage.push({ timestamp: new Date().toISOString(), ... event });
  // Keep last 5000 entries
  if (usage. length > 5000) usage.splice(0, usage.length - 5000);
  await atomicWriteJson(USAGE_LOG, usage);
  await appendLog({ type: 'trackUsage', ... event });
}

/**
 * runComprehensiveDiagnostic
 * Runs a lightweight diagnostic and returns a summary object.
 */
export async function runComprehensiveDiagnostic(): Promise<{ status: string; checks: any[]; timestamp: string }> {
  await appendLog({ type: 'runComprehensiveDiagnostic' });

  const checks: any[] = [];

  // Check data dir writable
  try {
    await ensureDataDir();
    const testFile = path.join(SUBAGENT_DATA_DIR, '. diagtest');
    await fs.writeFile(testFile, 'ok', 'utf-8');
    await fs.unlink(testFile);
    checks.push({ name: 'dataDir', status: 'ok' });
  } catch (err: any) {
    checks.push({ name: 'dataDir', status: 'fail', error: err?. message });
  }

  // Check env keys
  checks.push({ name: 'GEMINI_API_KEY', status: process.env.GEMINI_API_KEY ?  'configured' : 'missing' });
  checks.push({ name: 'GROQ_API_KEY', status: process. env.GROQ_API_KEY ?  'configured' : 'missing' });

  return { status: 'complete', checks, timestamp: new Date(). toISOString() };
}

/**
 * undoLastSubAgentChange
 * Pops the last change from history and returns it (or null).
 */
export async function undoLastSubAgentChange(): Promise<any | null> {
  await ensureDataDir();
  const history = await safeReadJson<any[]>(CHANGE_HISTORY, []);
  if (history.length === 0) return null;
  const last = history. pop();
  await atomicWriteJson(CHANGE_HISTORY, history);
  await appendLog({ type: 'undoLastSubAgentChange', undone: last });
  return last;
}

/**
 * getLastSubAgentChange
 * Returns the most recent change entry (or null).
 */
export async function getLastSubAgentChange(): Promise<any | null> {
  const history = await safeReadJson<any[]>(CHANGE_HISTORY, []);
  return history.length > 0 ?  history[history.length - 1] : null;
}

/**
 * setAutonomousExecution
 * Enables or disables autonomous execution mode.
 */
export async function setAutonomousExecution(enabled: boolean): Promise<void> {
  await loadState();
  autonomousExecutionEnabled = !!enabled;
  await saveState();
  await appendLog({ type: 'setAutonomousExecution', enabled: autonomousExecutionEnabled });
}

/**
 * getAutonomousExecutionStatus
 * Returns the current autonomous execution state.
 */
export async function getAutonomousExecutionStatus(): Promise<{ enabled: boolean }> {
  await loadState();
  return { enabled: autonomousExecutionEnabled };
}

/**
 * resetRateLimiter
 * Logs a rate-limiter reset request.
 */
export async function resetRateLimiter(reason?: string): Promise<boolean> {
  await appendLog({ type: 'resetRateLimiter', reason: reason || '' });
  return true;
}

/**
 * applyTrainingToSubAgent
 * Queues a training payload for later processing. 
 */
export async function applyTrainingToSubAgent(trainingPayload: any): Promise<boolean> {
  try {
    await ensureDataDir();
    const queue = await safeReadJson<any[]>(TRAINING_QUEUE, []);
    queue. push({ receivedAt: new Date().toISOString(), payload: trainingPayload });
    await atomicWriteJson(TRAINING_QUEUE, queue);
    await appendLog({ type: 'trainingQueued' });
    return true;
  } catch {
    await appendLog({ type: 'trainingFailed' });
    return false;
  }
}

/**
 * getConfiguredGeminiModel
 * Returns the Gemini model from env or defaults to gemini-2.5-flash. 
 */
export function getConfiguredGeminiModel(): string {
  return (process.env. GEMINI_MODEL || 'gemini-2.5-flash'). trim();
}

// ─────────────────────────────────────────────────────────────
// Default Export
// ─────────────────────────────────────────────────────────────
export default {
  processSubAgentCommand,
  executeAdvancedReasoning,
  trackUsage,
  runComprehensiveDiagnostic,
  undoLastSubAgentChange,
  getLastSubAgentChange,
  setAutonomousExecution,
  getAutonomousExecutionStatus,
  resetRateLimiter,
  applyTrainingToSubAgent,
  getConfiguredGeminiModel,
};
