/**
 * server/aiSubAgent.ts
 *
 * Single-source authoritative implementation of the Sub-Agent API used throughout the app.
 * Purpose:
 * - Provide the named exports routes and worker expect (no duplicate or missing exports).
 * - Provide conservative, deterministic stub implementations that are safe in constrained deploys
 *   (Railway/minimal images). Replace with real provider calls when ready.
 *
 * Important: Export each named function exactly once. Avoid duplicate exports to prevent the
 * TypeScript bundler error ("Multiple exports with the same name ...") seen in your build logs.
 */

import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(execCb);

// Minimal persistent state location
const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'subagent_state.json');

(async () => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
})();

// -----------------------------
// In-memory / persisted state
// -----------------------------
let _initialized = false;
let _autonomousExecutionEnabled = process.env.AUTONOMOUS_EXECUTION !== 'false';
let _lastChange: { timestamp: string; description: string } | null = null;
let _usageCounters: Record<string, number> = {};
let _rateLimiterState: { lastReset: number } = { lastReset: Date.now() };

async function _loadState() {
  try {
    const text = await fs.readFile(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(text || '{}');
    _lastChange = parsed._lastChange || _lastChange;
    _autonomousExecutionEnabled =
      typeof parsed._autonomousExecutionEnabled === 'boolean'
        ? parsed._autonomousExecutionEnabled
        : _autonomousExecutionEnabled;
    _usageCounters = parsed._usageCounters || _usageCounters;
    _rateLimiterState = parsed._rateLimiterState || _rateLimiterState;
  } catch {
    // no persisted state yet
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
    await fs.writeFile(STATE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch {
    // ignore write errors
  }
}

// -----------------------------
// Safety & shell helpers
// -----------------------------
const APP_DELETION_PATTERNS = [/rm\s+-rf\s+\//, /rm\s+-rf\s+\*/, /mkfs/i];
const NETWORK_ATTACK_PATTERNS = [/nc\s+.*\s+-e\s+/i, /bash\s+-i\s+>&\s+\/dev\/tcp\//, /curl\s+.*\|\s*bash/i, /wget\s+.*\|\s*bash/i];

export function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  const trimmed = (command || '').trim();
  if (!trimmed) return { safe: false, reason: 'Empty command' };
  for (const pat of APP_DELETION_PATTERNS) if (pat.test(trimmed)) return { safe: false, reason: 'Blocked catastrophic deletion pattern' };
  for (const pat of NETWORK_ATTACK_PATTERNS) if (pat.test(trimmed)) return { safe: false, reason: 'Blocked network attack pattern' };
  return { safe: true };
}

export async function executeShell(command: string, timeoutMs = 60000): Promise<{ stdout: string; stderr: string }> {
  const safety = isCommandSafe(command);
  if (!safety.safe) throw new Error(`Command blocked by safety policy: ${safety.reason}`);
  const res = await execAsync(command, { timeout: timeoutMs });
  return { stdout: (res as any).stdout || '', stderr: (res as any).stderr || '' };
}

export async function smartExecuteShell(command: string, attemptInstall = true) {
  try {
    return await executeShell(command);
  } catch (err: any) {
    const msg = (err.message || '').toLowerCase();
    if (attemptInstall && (msg.includes('command not found') || msg.includes('not recognized') || msg.includes('no such file'))) {
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

// -----------------------------
// Package helpers
// -----------------------------
export async function readPackageJson(): Promise<any> {
  const p = path.join(process.cwd(), 'package.json');
  const text = await fs.readFile(p, 'utf-8');
  return JSON.parse(text);
}

export async function getInstalledPackages(): Promise<Record<string, string>> {
  try {
    const pkg = await readPackageJson();
    return { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  } catch {
    return {};
  }
}

export async function ensurePackagesInstalled(packages: string[]) {
  const installed: string[] = [];
  const failed: string[] = [];
  const current = await getInstalledPackages();
  const missing = packages.filter((p) => !(p in current));
  if (missing.length === 0) return { installed: packages, failed };
  try {
    await execAsync(`npm install ${missing.join(' ')} --no-audit --no-fund`, { timeout: 120000 });
    const updated = await getInstalledPackages();
    for (const p of missing) if (p in updated) installed.push(p); else failed.push(p);
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

// -----------------------------
// Web search (best-effort)
// -----------------------------
const WEB_SEARCH_ENABLED = process.env.WEB_SEARCH_ENABLED !== 'false';
const BING_API_KEY = process.env.BING_API_KEY || process.env.BING_SEARCH_KEY || '';

export async function webSearch(query: string, limit = 5): Promise<Array<{ title: string; url: string; snippet?: string }>> {
  if (!WEB_SEARCH_ENABLED) return [];
  try {
    const fetchFn: any = (globalThis as any).fetch || (await import('node-fetch')).default;
    if (BING_API_KEY) {
      const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${limit}`;
      const res = await fetchFn(url, { headers: { 'Ocp-Apim-Subscription-Key': BING_API_KEY } });
      const data = await res.json();
      const pages = data.webPages?.value || [];
      return pages.slice(0, limit).map((p: any) => ({ title: p.name, url: p.url, snippet: p.snippet }));
    } else {
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
  } catch (err) {
    console.warn('[aiSubAgent:webSearch] error:', (err as any)?.message || err);
    return [];
  }
}

// -----------------------------
// Simple AI routing & stubs
// -----------------------------
const PROVIDER_MODEL_MAP: Record<string, string> = {
  gemini: process.env.GEMINI_MODEL || 'gemini-1.5',
  groq: process.env.GROQ_MODEL || 'groq-default',
  claude: process.env.CLAUDE_MODEL || 'claude-default',
  mistral: process.env.MISTRAL_MODEL || 'mistral-default',
};

export function selectProviderForTask(taskName: string, prompt: string, opts?: { model?: string; provider?: string }) {
  if (opts?.model && typeof opts.model === 'string' && opts.model.trim().length > 0) {
    const m = opts.model.trim();
    const prefixMatch = m.match(/^(gemini|claude|groq|mistral)[-_]?/i);
    if (prefixMatch) return { provider: prefixMatch[1].toLowerCase(), model: m };
    return { provider: 'gemini', model: m };
  }
  if (opts?.provider) {
    const p = opts.provider.toLowerCase();
    return { provider: p, model: PROVIDER_MODEL_MAP[p] || PROVIDER_MODEL_MAP.gemini };
  }
  const combined = `${taskName} ${prompt}`.toLowerCase();
  if (/\b(code|compile|build|test|refactor|debug|typescript|javascript|python|sql|dockerfile|docker)\b/.test(combined)) {
    return { provider: 'groq', model: PROVIDER_MODEL_MAP.groq };
  }
  if (/\b(summarize|verify|research|analysis|reasoning|web|scrape|search)\b/.test(combined)) {
    return { provider: 'gemini', model: PROVIDER_MODEL_MAP.gemini };
  }
  return { provider: 'gemini', model: PROVIDER_MODEL_MAP.gemini };
}

export async function callAIWithGovernor(
  taskName: string,
  prompt: string,
  opts?: { model?: string; provider?: string; temperature?: number }
): Promise<{ success: boolean; content?: string; error?: string; provider?: string; model?: string }> {
  if (!getAutonomousExecutionStatus()) return { success: false, error: 'Autonomous execution disabled' };
  const sel = selectProviderForTask(taskName || 'task', prompt || '', opts);
  trackUsage(sel.provider);
  // Deterministic stubbed response (safe)
  return { success: true, content: `[aiSubAgent stub] (${sel.provider}/${sel.model}) truncated response for "${taskName}"`, provider: sel.provider, model: sel.model };
}

// -----------------------------
// groq compatibility shim
// -----------------------------
export function getGroqClientWithGovernor(): any {
  return {
    chat: {
      completions: {
        create: async (request: any) => {
          const systemPrompt = request.messages?.find((m: any) => m.role === 'system')?.content;
          const userPrompt = request.messages?.find((m: any) => m.role === 'user')?.content || request.input || request.prompt || '';
          const opts: any = {};
          if (request.model) opts.model = request.model;
          if (request.provider) opts.provider = request.provider;
          const resp = await callAIWithGovernor('subagent-command', userPrompt, { model: opts.model, provider: opts.provider });
          if (!resp.success) throw new Error(resp.error || 'AI call failed');
          return { choices: [{ message: { content: resp.content } }] };
        },
      },
    },
  };
}

export async function groqChat(client: any, prompt: string, opts: { temperature?: number; maxTokens?: number; taskName?: string } = {}) {
  try {
    const resp = await (client?.chat?.completions.create?.({ messages: [{ role: 'user', content: prompt }], model: opts['model'] })) || { choices: [{ message: { content: '' } }] };
    return { text: resp.choices?.[0]?.message?.content || '' };
  } catch {
    return { text: '' };
  }
}

// -----------------------------
// Main Sub-Agent command API
// -----------------------------
export async function processSubAgentCommand(params: { command: string; category?: string } | string): Promise<{ success: boolean; response: string; metadata?: any; packagesToInstall?: string[]; fixedCount?: number }> {
  const commandText = typeof params === 'string' ? params : (params as any).command || '';
  const category = typeof params === 'object' && 'category' in params ? (params as any).category : undefined;

  if (!commandText || commandText.trim().length === 0) return { success: false, response: 'No command provided' };

  // handle shell requests
  const shellMatch = commandText.match(/(?:shell|run|execute)\s+(.+)/i);
  if (shellMatch && shellMatch[1]) {
    const cmd = shellMatch[1].trim();
    const safe = isCommandSafe(cmd);
    if (!safe.safe) return { success: false, response: `Blocked command: ${safe.reason}` };
    try {
      const out = await smartExecuteShell(cmd, true);
      _lastChange = { timestamp: new Date().toISOString(), description: `Executed shell command: ${cmd}` };
      await _saveState();
      return { success: true, response: `Command executed (stub).\n${out.stdout}`, metadata: { stderr: out.stderr } };
    } catch (err: any) {
      return { success: false, response: `Shell execution failed: ${err.message || String(err)}` };
    }
  }

  // quick scrape handling
  if (/\b(scrape|scraping|scrape officers)\b/i.test(commandText)) {
    try {
      await runWebOfficerScrape(60 * 1000);
      _lastChange = { timestamp: new Date().toISOString(), description: 'Performed quick web scrape (stub)' };
      await _saveState();
      return { success: true, response: 'Performed quick web-scrape (stub).' };
    } catch (err: any) {
      return { success: false, response: `Scrape failed: ${err.message || String(err)}` };
    }
  }

  // fallback to governor AI
  try {
    const ai = await callAIWithGovernor('subagent-command', commandText, {});
    if (!ai.success) return { success: false, response: `AI governor: ${ai.error || 'failed'}` };
    _lastChange = { timestamp: new Date().toISOString(), description: `AI processed command (category=${category || 'none'})` };
    await _saveState();
    return { success: true, response: ai.content || '[no content]', metadata: { provider: ai.provider, model: ai.model }, packagesToInstall: [] };
  } catch (err: any) {
    return { success: false, response: `Execution failed: ${err?.message || String(err)}` };
  }
}

// -----------------------------
// Administrative helpers (expected by routes)
// -----------------------------
export function trackUsage(key: string) {
  try {
    _usageCounters[key] = (_usageCounters[key] || 0) + 1;
    if ((_usageCounters[key] % 10) === 0) _saveState().catch(() => {});
  } catch {
    /* ignore */
  }
}

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

export async function runComprehensiveDiagnosticAndPersist() {
  const res = await runComprehensiveDiagnostic();
  try {
    await fs.writeFile(path.join(DATA_DIR, 'last_comprehensive_diagnostic.json'), JSON.stringify(res, null, 2), 'utf-8');
  } catch {
    /* ignore */
  }
  return { success: res.success, summary: res };
}

export async function undoLastSubAgentChange() {
  if (!_lastChange) return { success: false, response: 'No last change recorded' };
  const desc = _lastChange.description;
  _lastChange = { timestamp: new Date().toISOString(), description: `[UNDO] ${desc}` };
  await _saveState();
  return { success: true, response: `Undo simulated for: ${desc}` };
}

export function getLastSubAgentChange() {
  return _lastChange;
}

export function setAutonomousExecution(enable: boolean) {
  _autonomousExecutionEnabled = !!enable;
  _saveState().catch(() => {});
  return { success: true, status: _autonomousExecutionEnabled };
}

export function getAutonomousExecutionStatus() {
  return !!_autonomousExecutionEnabled;
}

export function resetRateLimiter() {
  _rateLimiterState.lastReset = Date.now();
  _saveState().catch(() => {});
  return { success: true, lastReset: _rateLimiterState.lastReset };
}

// -----------------------------
// Daily scrape scheduler (lightweight)
// -----------------------------
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
      /* ignore */
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

// -----------------------------
// Advanced reasoning (stub)
// -----------------------------
export async function executeAdvancedReasoning(task: string, _verbose = false): Promise<{ analysis: string; plan?: any }> {
  await _loadState().catch(() => {});
  trackUsage('advanced-reasoning');
  return {
    analysis:
      '[aiSubAgent stub] Advanced reasoning is stubbed. Replace with actual model integration. Task summary: ' +
      (task.length > 200 ? task.slice(0, 200) + '...' : task),
    plan: { strategicPlan: { steps: [] } },
  };
}

// -----------------------------
// Initialization entrypoint
// -----------------------------
export function initializeAutomatedSystems(): void {
  if (_initialized) return;
  _initialized = true;
  _loadState().catch(() => {});
  try {
    scheduleDailyOfficerScrape();
  } catch {
    /* ignore */
  }
  console.log('[aiSubAgent] initializeAutomatedSystems: stub initialized');
}

// Default export (single object) for flexible imports
const aiSubAgent = {
  processSubAgentCommand,
  callAIWithGovernor,
  getGroqClientWithGovernor,
  groqChat,
  webSearch,
  ensurePackagesInstalled,
  isCommandSafe,
  executeShell,
  smartExecuteShell,
  scheduleDailyOfficerScrape,
  runWebOfficerScrape,
  trackUsage,
  runComprehensiveDiagnostic,
  runComprehensiveDiagnosticAndPersist,
  undoLastSubAgentChange,
  getLastSubAgentChange,
  setAutonomousExecution,
  getAutonomousExecutionStatus,
  resetRateLimiter,
  executeAdvancedReasoning,
  initializeAutomatedSystems,
};

export default aiSubAgent;
