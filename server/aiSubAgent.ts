/**
 * server/aiSubAgent.ts
 *
 * Restored and safe-stubbed AI Sub-Agent implementation with the named exports
 * expected by the rest of the codebase (routes, worker, etc).
 *
 * Purpose:
 * - Provide deterministic, build-safe, single-source exports for the Sub-Agent API.
 * - Restore all named exports referenced by other files (trackUsage, runComprehensiveDiagnostic,
 *   undoLastSubAgentChange, getLastSubAgentChange, setAutonomousExecution, getAutonomousExecutionStatus,
 *   resetRateLimiter, processSubAgentCommand, initializeAutomatedSystems, groqChat, getGroqClientWithGovernor, etc).
 * - Keep implementations conservative and safe for Railway builds (no heavy 3rd-party network calls at init).
 *
 * Important:
 * - This file is a pragmatic, minimal implementation to unblock builds and provide runtime stubs.
 * - Replace stub bodies with real integrations when you are ready to wire actual AI providers.
 */

import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(execCb);

// --- Basic runtime configuration (env overrides) ---
const WEB_SEARCH_ENABLED = process.env.WEB_SEARCH_ENABLED !== 'false';
const BING_API_KEY = process.env.BING_API_KEY || process.env.BING_SEARCH_KEY || '';
const DATA_DIR = path.join(process.cwd(), 'data');
const SUBAGENT_STATE_FILE = path.join(DATA_DIR, 'subagent_state.json');

// Ensure data dir exists (best-effort)
(async () => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }
})();

// --- In-memory state (persisted best-effort) ---
let _initialized = false;
let _lastChange: { timestamp: string; description: string } | null = null;
let _autonomousExecutionEnabled = process.env.AUTONOMOUS_EXECUTION !== 'false';
let _usageCounters: Record<string, number> = {};
let _rateLimiterState: { lastReset: number } = { lastReset: Date.now() };

// Persist/restore minimal state
async function _loadState() {
  try {
    const s = await fs.readFile(SUBAGENT_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(s || '{}');
    _lastChange = parsed._lastChange || _lastChange;
    _autonomousExecutionEnabled = typeof parsed._autonomousExecutionEnabled === 'boolean' ? parsed._autonomousExecutionEnabled : _autonomousExecutionEnabled;
    _usageCounters = parsed._usageCounters || _usageCounters;
    _rateLimiterState = parsed._rateLimiterState || _rateLimiterState;
  } catch {
    // no file yet - fine
  }
}

async function _saveState() {
  try {
    const payload = {
      _lastChange,
      _autonomousExecutionEnabled,
      _usageCounters,
      _rateLimiterState,
    };
    await fs.writeFile(SUBAGENT_STATE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch {
    // ignore write errors
  }
}

// --- Safety helpers (simple, same shape as earlier) ---
const APP_DELETION_PATTERNS = [
  /rm\s+-rf\s+\//,
  /rm\s+-rf\s+\*/,
  /mkfs/i,
];

const NETWORK_ATTACK_PATTERNS = [
  /nc\s+.*\s+-e\s+/i,
  /bash\s+-i\s+>&\s+\/dev\/tcp\//,
  /curl\s+.*\|\s*bash/i,
  /wget\s+.*\|\s*bash/i,
];

export function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  const trimmed = (command || '').trim();
  if (!trimmed) return { safe: false, reason: 'Empty command' };

  for (const pat of APP_DELETION_PATTERNS) {
    if (pat.test(trimmed)) return { safe: false, reason: 'Blocked catastrophic deletion pattern' };
  }
  for (const pat of NETWORK_ATTACK_PATTERNS) {
    if (pat.test(trimmed)) return { safe: false, reason: 'Blocked network attack pattern' };
  }

  return { safe: true };
}

export async function isFilePathSafe(filePath: string, adminOverride: boolean = false): Promise<{ safe: boolean; reason?: string }> {
  if (!filePath) return { safe: false, reason: 'Empty path' };

  const SYSTEM_DIRECTORIES = [/^\/etc\//, /^\/proc\//, /^\/sys\//];
  for (const pat of SYSTEM_DIRECTORIES) {
    if (pat.test(filePath)) return { safe: false, reason: 'Cannot write to system directories' };
  }

  // protect obvious admin files unless override is explicitly allowed
  const SUBAGENT_ALLOW_ADMIN_MODS = process.env.SUBAGENT_ALLOW_ADMIN_MODS === 'true';
  if (!SUBAGENT_ALLOW_ADMIN_MODS && !adminOverride) {
    const adminFiles = ['server/auth.ts', 'server/localAuth.ts'];
    for (const adminFile of adminFiles) {
      if (filePath.endsWith(adminFile) || filePath === adminFile) {
        return { safe: false, reason: 'Admin files protected' };
      }
    }
  }

  const projectRoot = process.cwd();
  try {
    const absolute = path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(projectRoot, filePath);
    if (!absolute.startsWith(projectRoot)) {
      return { safe: false, reason: 'Path outside project root' };
    }
  } catch {
    return { safe: false, reason: 'Path resolution failed' };
  }

  return { safe: true };
}

// --- Shell execution helpers ---
export async function executeShell(command: string, timeoutMs = 60000): Promise<{ stdout: string; stderr: string }> {
  const safety = isCommandSafe(command);
  if (!safety.safe) throw new Error(`Command blocked by safety policy: ${safety.reason}`);
  const res = await execAsync(command, { timeout: timeoutMs });
  return { stdout: (res as any).stdout || '', stderr: (res as any).stderr || '' };
}

export async function smartExecuteShell(command: string, attemptInstall: boolean = true): Promise<{ stdout: string; stderr: string }> {
  try {
    return await executeShell(command);
  } catch (err: any) {
    const msg = (err.message || '').toLowerCase();
    if (attemptInstall && (msg.includes('command not found') || msg.includes('not recognized') || msg.includes('no such file'))) {
      // naive attempt: try to npm install the first token
      const parts = command.split(/\s+/);
      const exe = parts[0];
      const candidatePackages = [exe, `@${exe}`, `node-${exe}`].filter(Boolean);
      try {
        await ensurePackagesInstalled(candidatePackages);
        return await executeShell(command);
      } catch {
        // rethrow original
      }
    }
    throw err;
  }
}

// --- Package helpers (best-effort) ---
export async function readPackageJson(): Promise<any> {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const content = await fs.readFile(packageJsonPath, 'utf-8');
  return JSON.parse(content);
}

export async function getInstalledPackages(): Promise<Record<string, string>> {
  try {
    const pkg = await readPackageJson();
    return {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
  } catch {
    return {};
  }
}

export async function ensurePackagesInstalled(packages: string[]): Promise<{ installed: string[]; failed: string[] }> {
  const installed: string[] = [];
  const failed: string[] = [];

  const current = await getInstalledPackages();
  const missing = packages.filter((p) => !(p in current));
  if (missing.length === 0) return { installed: packages, failed };

  try {
    const cmd = `npm install ${missing.join(' ')} --no-audit --no-fund`;
    await execAsync(cmd, { timeout: 120000 });
    const updated = await getInstalledPackages();
    for (const p of missing) {
      if (p in updated) installed.push(p);
      else failed.push(p);
    }
    return { installed, failed };
  } catch {
    for (const p of missing) {
      try {
        await execAsync(`npm install ${p} --no-audit --no-fund`, { timeout: 60000 });
        installed.push(p);
      } catch {
        failed.push(p);
      }
    }
    return { installed, failed };
  }
}

// --- Simple web search wrapper (best-effort, limited) ---
export async function webSearch(query: string, limit = 5): Promise<Array<{ title: string; url: string; snippet?: string }>> {
  if (!WEB_SEARCH_ENABLED) return [];

  try {
    if (BING_API_KEY) {
      const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${limit}`;
      // dynamic import fetch to avoid bundling issues in minimal images
      const fetchFn: any = (globalThis as any).fetch || (await import('node-fetch')).default;
      const res = await fetchFn(url, { headers: { 'Ocp-Apim-Subscription-Key': BING_API_KEY } });
      const data = await res.json();
      const results: Array<{ title: string; url: string; snippet?: string }> = [];
      const webPages = data.webPages?.value || [];
      for (const p of webPages.slice(0, limit)) {
        results.push({ title: p.name, url: p.url, snippet: p.snippet });
      }
      return results;
    } else {
      // lightweight duckduckgo html scrape fallback
      const fetchFn: any = (globalThis as any).fetch || (await import('node-fetch')).default;
      const ddgUrl = `https://duckduckgo.com/html?q=${encodeURIComponent(query)}`;
      const res = await fetchFn(ddgUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BadBlueBot/1.0)' } });
      const html = await res.text();
      const anchors = Array.from(html.matchAll(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g));
      const parsed: Array<{ title: string; url: string; snippet?: string }> = [];
      for (const a of anchors.slice(0, limit)) {
        const href = a[1].replace(/amp;/g, '');
        const title = a[2].replace(/<[^>]+>/g, '');
        parsed.push({ title, url: href });
      }
      return parsed;
    }
  } catch (error) {
    console.warn('[aiSubAgent:webSearch] error:', (error as any)?.message || error);
    return [];
  }
}

// --- Groq / governor wrappers and groqChat ---
/**
 * getGroqClientWithGovernor
 * Returns an object with the same call shape used elsewhere.
 * Internally maps to callAIWithGovernor to keep a single route for AI calls.
 */
export function getGroqClientWithGovernor(): any {
  return {
    chat: {
      completions: {
        create: async (request: any) => {
          // Extract system and user messages
          const systemPrompt = request.messages?.find((m: any) => m.role === 'system')?.content;
          const userPrompt = request.messages?.find((m: any) => m.role === 'user')?.content || request.input || request.prompt || '';
          // Allow hints
          const opts: any = {};
          if (request.model) opts.model = request.model;
          if (request.provider) opts.provider = request.provider;
          const resp = await callAIWithGovernor('subagent-command', userPrompt, { systemPrompt, ...opts });
          if (!resp.success) throw new Error(resp.error || 'AI call failed');
          return { choices: [{ message: { content: resp.content } }] };
        },
      },
    },
  };
}

/**
 * groqChat
 * Minimal compatibility function used by callers that expect { text } shaped return
 */
export async function groqChat(client: any, prompt: string, opts: { temperature?: number; maxTokens?: number; taskName?: string } = {}): Promise<{ text: string }> {
  try {
    const resp = await client.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: opts['model'] || undefined,
      provider: opts['provider'] || undefined,
    });
    const text = resp?.choices?.[0]?.message?.content || '';
    return { text };
  } catch (err: any) {
    return { text: '' };
  }
}

// --- Lightweight AI governor and selection (stubbed) ---
/**
 * selectProviderForTask
 * Conservative selection mapping. Use env overrides to set provider models.
 */
const PROVIDER_MODEL_MAP: Record<string, string> = {
  gemini: process.env.GEMINI_MODEL || 'gemini-1.5',
  groq: process.env.GROQ_MODEL || 'groq-default',
  claude: process.env.CLAUDE_MODEL || 'claude-default',
  mistral: process.env.MISTRAL_MODEL || 'mistral-default',
};

export function selectProviderForTask(
  taskName: string,
  prompt: string,
  opts?: { systemPrompt?: string; temperature?: number; model?: string; provider?: string }
): { provider: string; model: string } {
  if (opts?.model && typeof opts.model === 'string' && opts.model.trim().length > 0) {
    const m = opts.model.trim();
    const prefixMatch = m.match(/^(gemini|claude|groq|mistral)[-_]?/i);
    if (prefixMatch) {
      const provider = prefixMatch[1].toLowerCase();
      return { provider, model: m };
    }
    return { provider: 'gemini', model: m };
  }

  if (opts?.provider) {
    const p = opts.provider.toLowerCase();
    return { provider: p, model: PROVIDER_MODEL_MAP[p] || PROVIDER_MODEL_MAP['gemini'] };
  }

  const combined = `${taskName} ${prompt}`.toLowerCase();

  if (/\b(code|compile|build|test|refactor|bug|debug|typescript|javascript|python|sql|dockerfile|docker)\b/.test(combined)) {
    return { provider: 'groq', model: PROVIDER_MODEL_MAP.groq };
  }

  if (/\b(poem|story|creative|marketing|slogan|tagline)\b/.test(combined)) {
    return { provider: 'claude', model: PROVIDER_MODEL_MAP.claude };
  }

  if (/\b(summarize|verify|research|analysis|reasoning|search|scrape|web)\b/.test(combined)) {
    return { provider: 'gemini', model: PROVIDER_MODEL_MAP.gemini };
  }

  return { provider: 'gemini', model: PROVIDER_MODEL_MAP.gemini };
}

/**
 * callAIWithGovernor
 * Minimal stub that returns a deterministic response. Replace with real provider calls later.
 */
export async function callAIWithGovernor(
  taskName: string,
  prompt: string,
  opts?: { systemPrompt?: string; temperature?: number; model?: string; provider?: string }
): Promise<{ success: boolean; content?: string; error?: string; provider?: string; model?: string }> {
  // Respect basic autonomous execution flag
  if (!getAutonomousExecutionStatus()) {
    return { success: false, error: 'Autonomous execution disabled' };
  }

  const selection = selectProviderForTask(taskName || 'task', prompt || '', opts);
  // Return a short deterministic answer to avoid hitting quotas at build time
  const content = `[aiSubAgent stub] (${selection.provider}/${selection.model}) Response for task "${taskName}" - truncated.`;

  // Track usage best-effort
  trackUsage(selection.provider);

  return { success: true, content, provider: selection.provider, model: selection.model };
}

// --- Primary processSubAgentCommand implementation (expected by many callers) ---
export async function processSubAgentCommand(params: { command: string; category?: string } | string): Promise<{ success: boolean; response: string; metadata?: any; packagesToInstall?: string[]; fixedCount?: number }> {
  const commandText = typeof params === 'string' ? params : params.command || '';
  const category = typeof params === 'object' && 'category' in params ? (params as any).category : undefined;

  if (!commandText || commandText.trim().length === 0) {
    return { success: false, response: 'No command provided' };
  }

  // Simple actionable detection
  const actionable = /(?:perform|execute|run|install|create|make|design|edit|update|fix|repair|scrape|search|compile)\b/i.test(commandText);

  // Basic behaviors:
  try {
    // If the command requests a shell run, attempt it (safe-guarded)
    const shellMatch = commandText.match(/(?:shell|run|execute)\s+(.+)/i);
    if (shellMatch && shellMatch[1]) {
      const cmd = shellMatch[1].trim();
      const safe = isCommandSafe(cmd);
      if (!safe.safe) return { success: false, response: `Blocked command: ${safe.reason}` };
      const out = await smartExecuteShell(cmd, true);
      _lastChange = { timestamp: new Date().toISOString(), description: `Executed shell command: ${cmd}` };
      await _saveState();
      return { success: true, response: `Command executed (stub).\n${out.stdout}`, metadata: { stderr: out.stderr } };
    }

    // If scrape requested, run a short scrape
    if (/\b(scrape|scraping|scrape officers)\b/i.test(commandText)) {
      await runWebOfficerScrape(60 * 1000); // 1 minute quick run
      _lastChange = { timestamp: new Date().toISOString(), description: 'Performed quick web scrape (stub)' };
      await _saveState();
      return { success: true, response: 'Performed quick web-scrape (stub).' };
    }

    // Otherwise call AI governor (stubbed)
    const ai = await callAIWithGovernor('subagent-command', commandText, { model: undefined });
    if (!ai.success) return { success: false, response: `AI governor: ${ai.error || 'failed'}` };

    _lastChange = { timestamp: new Date().toISOString(), description: `AI processed command (category=${category || 'none'})` };
    await _saveState();

    return { success: true, response: ai.content || '[no content]', metadata: { provider: ai.provider, model: ai.model }, packagesToInstall: [] };
  } catch (err: any) {
    return { success: false, response: `Execution failed: ${err?.message || String(err)}` };
  }
}

// --- Additional utility functions other modules expect (exposed as named exports) ---

/**
 * trackUsage
 * Increment simple counters per provider or key.
 */
export function trackUsage(key: string) {
  try {
    _usageCounters[key] = (_usageCounters[key] || 0) + 1;
    // persist occasionally (best-effort)
    if ((_usageCounters[key] % 10) === 0) _saveState().catch(() => {});
  } catch {
    // ignore
  }
}

/**
 * runComprehensiveDiagnostic
 * A simple wrapper that runs a few checks and returns a summary object; used by routes.
 * This is intentionally lightweight in stub mode.
 */
export async function runComprehensiveDiagnostic(): Promise<{ success: boolean; summary: string; details?: any }> {
  const summary = {
    time: new Date().toISOString(),
    autonomousEnabled: _autonomousExecutionEnabled,
    lastChange: _lastChange,
    usageCounters: _usageCounters,
    rateLimiterLastReset: _rateLimiterState.lastReset,
  };
  return { success: true, summary: 'Comprehensive diagnostic (stub) completed', details: summary };
}

/**
 * undoLastSubAgentChange / getLastSubAgentChange
 * Basic management of the stored last change.
 */
export async function undoLastSubAgentChange(): Promise<{ success: boolean; response: string }> {
  if (!_lastChange) return { success: false, response: 'No last change recorded' };
  // We cannot actually undo changes in stub; we mark undone in state
  const desc = _lastChange.description;
  _lastChange = { timestamp: new Date().toISOString(), description: `[UNDO] ${desc}` };
  await _saveState();
  return { success: true, response: `Undo simulated for: ${desc}` };
}

export function getLastSubAgentChange(): { timestamp: string; description: string } | null {
  return _lastChange;
}

/**
 * setAutonomousExecution / getAutonomousExecutionStatus
 */
export function setAutonomousExecution(enable: boolean): { success: boolean; status: boolean } {
  _autonomousExecutionEnabled = !!enable;
  _saveState().catch(() => {});
  return { success: true, status: _autonomousExecutionEnabled };
}
export function getAutonomousExecutionStatus(): boolean {
  return !!_autonomousExecutionEnabled;
}

/**
 * resetRateLimiter
 */
export function resetRateLimiter(): { success: boolean; lastReset: number } {
  _rateLimiterState.lastReset = Date.now();
  _saveState().catch(() => {});
  return { success: true, lastReset: _rateLimiterState.lastReset };
}

/**
 * runWebOfficerScrape / scheduleDailyOfficerScrape
 * Conservative, best-effort implementations that do not perform aggressive scraping.
 */
let dailyScrapeTimeout: NodeJS.Timeout | null = null;
let dailyScrapeRunning = false;

export function scheduleDailyOfficerScrape(hourUTC = Number(process.env.DAILY_SCRAPE_HOUR_UTC || 2), durationMs = Number(process.env.DAILY_SCRAPE_DURATION_MS || 1000 * 60 * 60)) {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hourUTC, 0, 0, 0);
  if (now.getTime() >= next.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next.getTime() - now.getTime();

  if (dailyScrapeTimeout) clearTimeout(dailyScrapeTimeout);
  dailyScrapeTimeout = setTimeout(async () => {
    try {
      dailyScrapeRunning = true;
      await runWebOfficerScrape(durationMs);
    } catch {
      // ignore
    } finally {
      dailyScrapeRunning = false;
      scheduleDailyOfficerScrape(hourUTC, durationMs);
    }
  }, delay);
}

export async function runWebOfficerScrape(durationMs = 1000 * 60 * 10) {
  if (dailyScrapeRunning) return;
  dailyScrapeRunning = true;
  const queries = ['police officer directory site:.gov', 'sheriff office directory site:.gov'];
  const end = Date.now() + durationMs;
  try {
    for (const q of queries) {
      if (Date.now() >= end) break;
      try {
        const hits = await webSearch(q, 3);
        // stub: log a few results to local file for later processing
        const out = hits.map((h) => ({ title: h.title, url: h.url }));
        const dumpPath = path.join(DATA_DIR, `scrape_${Date.now()}.json`);
        await fs.writeFile(dumpPath, JSON.stringify(out, null, 2), 'utf-8');
      } catch {
        // continue
      }
    }
  } finally {
    dailyScrapeRunning = false;
  }
}

// --- Comprehensive diagnostic runner for routes that import it ---
export async function runComprehensiveDiagnosticAndPersist(): Promise<{ success: boolean; summary: any }> {
  const res = await runComprehensiveDiagnostic();
  // persist the summary to a file for admin UI (best-effort)
  try {
    await fs.writeFile(path.join(DATA_DIR, 'last_comprehensive_diagnostic.json'), JSON.stringify(res, null, 2), 'utf-8');
  } catch {
    // ignore
  }
  return { success: res.success, summary: res };
}

// --- Initialization entrypoint ---
export function initializeAutomatedSystems(): void {
  if (_initialized) return;
  _initialized = true;
  // best-effort load persisted state
  _loadState().catch(() => {});
  // schedule daily scrape if allowed
  try {
    scheduleDailyOfficerScrape();
  } catch {
    // ignore scheduling errors
  }
  console.log('[aiSubAgent] initializeAutomatedSystems: stub initialized');
}

// Default export for flexible imports
const aiSubAgent = {
  processSubAgentCommand,
  callAIWithGovernor,
  getGroqClientWithGovernor,
  groqChat,
  webSearch,
  ensurePackagesInstalled,
  isCommandSafe,
  isFilePathSafe,
  executeShell,
  smartExecuteShell,
  scheduleDailyOfficerScrape,
  runWebOfficerScrape,
  trackUsage,
  runComprehensiveDiagnostic,
  undoLastSubAgentChange,
  getLastSubAgentChange,
  setAutonomousExecution,
  getAutonomousExecutionStatus,
  resetRateLimiter,
  runComprehensiveDiagnosticAndPersist,
  initializeAutomatedSystems,
};

export default aiSubAgent;
