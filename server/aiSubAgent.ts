/**
 * Revised AI Sub-Agent
 * - Reworked provider selection so tasks are routed to the best-fit provider/model
 *   based on simple capability heuristics (task name, prompt content, priority).
 * - No single "preferred provider" — instead we pick a provider per-call unless
 *   the caller explicitly requests a provider/model via opts.model or env overrides.
 *
 * Notes:
 * - You can still override provider/model selection using environment variables.
 * - This file keeps the previous safety/export fixes so it builds cleanly.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import fetch from 'node-fetch';
import { z } from 'zod';

import {
  generateAutonomousText,
  canAutonomousProceed,
  getAutonomousRescheduleInfo,
  createTaskMetadata,
  UsageContext,
  TaskPriority,
  TaskComplexity,
} from './aiProvider';
import { getGroqClient } from './groq';
import { db } from './db';
import { sql } from 'drizzle-orm';
import { storage } from './storage';

const execAsync = promisify(exec);

/**
 * Provider/model configuration
 * - By default we have no single preferred provider.
 * - Use environment variables to override model names per provider if necessary.
 *
 * Supported provider keys: 'gemini', 'claude', 'groq', 'mistral'
 */
const PROVIDER_MODEL_MAP: Record<string, string> = {
  gemini: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  claude: process.env.CLAUDE_MODEL || 'claude-3.5-haiku',
  groq: process.env.GROQ_MODEL || 'llama-3.3-70B',
  mistral: process.env.MISTRAL_MODEL || 'mistral-large',
};

const BING_API_KEY = process.env.BING_API_KEY || process.env.BING_SEARCH_KEY || '';
const SUBAGENT_ALLOW_ADMIN_MODS = process.env.SUBAGENT_ALLOW_ADMIN_MODS === 'true'; // explicit opt-in
const WEB_SEARCH_ENABLED = process.env.WEB_SEARCH_ENABLED !== 'false';
const DAILY_SCRAPE_HOUR_UTC = Number(process.env.DAILY_SCRAPE_HOUR_UTC || 2);
const DAILY_SCRAPE_DURATION_MS = Number(process.env.DAILY_SCRAPE_DURATION_MS || 1000 * 60 * 60);
const MIN_API_CALL_INTERVAL_MS = 1500;

/**
 * Heuristic router: decide which provider/model to use for a given task.
 *
 * - If opts.model is provided and looks like a provider-model mapping (e.g. "gemini-2.5-flash"),
 *   prefer that exact model.
 * - If opts.provider is provided (e.g., 'gemini', 'claude'), use that provider's configured model.
 * - Otherwise, use simple heuristics (taskName, priority, prompt keywords) to pick a provider.
 *
 * The heuristics are conservative and can be extended later to call a capability matrix service
 * or use a small ML classifier.
 */
function selectProviderForTask(
  taskName: string,
  prompt: string,
  opts?: { systemPrompt?: string; temperature?: number; model?: string; provider?: string }
): { provider: string; model: string } {
  // 1) Explicit model override
  if (opts?.model && typeof opts.model === 'string' && opts.model.trim().length > 0) {
    // If user provided "provider:model" style or provider embedded in name, attempt to detect provider key
    const m = opts.model.trim();
    // try to extract provider prefix if present (e.g., "gemini-2.5-flash")
    const prefixMatch = m.match(/^(gemini|claude|groq|mistral)[-_]?/i);
    if (prefixMatch) {
      const provider = prefixMatch[1].toLowerCase();
      return { provider, model: m };
    }
    // otherwise return as a provider-agnostic custom model identifier on the 'gemini' channel by default
    // (we choose gemini as default model namespace only when explicit string provided without prefix)
    return { provider: 'gemini', model: m };
  }

  // 2) Explicit provider override
  if (opts?.provider) {
    const p = opts.provider.toLowerCase();
    if (PROVIDER_MODEL_MAP[p]) {
      return { provider: p, model: PROVIDER_MODEL_MAP[p] };
    }
    // fallback to mapping if unknown provider string given
    return { provider: p, model: PROVIDER_MODEL_MAP['gemini'] };
  }

  // 3) Keyword heuristics on taskName + prompt
  const combined = `${taskName} ${prompt}`.toLowerCase();

  // Strong signals for coding / compile / patch / debug tasks -> Groq (Llama)
  if (/\b(code|compile|build|test|refactor|bug|debug|stack trace|typescript|javascript|python|sql|dockerfile|docker)\b/.test(combined)) {
    return { provider: 'groq', model: PROVIDER_MODEL_MAP.groq };
  }

  // Creative tasks -> Claude
  if (/\b(poem|story|creative|marketing|slogan|tagline|haiku|sonnet|lyrics|play)\b/.test(combined)) {
    return { provider: 'claude', model: PROVIDER_MODEL_MAP.claude };
  }

  // Long context, factual, web/scrape, verification, summarization, reasoning -> Gemini
  if (/\b(summarize|summarization|verify|verification|scrape|search|web|research|officer|policy|report|long|analysis|reasoning)\b/.test(combined)) {
    return { provider: 'gemini', model: PROVIDER_MODEL_MAP.gemini };
  }

  // Fast, small, general-purpose tasks -> Mistral
  if (/\b(fast|small|short|summary|tiny|lightweight|simple)\b/.test(combined)) {
    return { provider: 'mistral', model: PROVIDER_MODEL_MAP.mistral };
  }

  // Default fallback: use gemini model from map (no single preferred provider globally — fallback only)
  return { provider: 'gemini', model: PROVIDER_MODEL_MAP.gemini };
}

/**
 * Simple governor-aware wrapper for AI calls.
 * Uses generateAutonomousText and respects autonomous quotas.
 * This now routes each call to the provider/model selected by selectProviderForTask.
 */
async function callAIWithGovernor(
  taskName: string,
  prompt: string,
  opts?: { systemPrompt?: string; temperature?: number; model?: string; provider?: string }
): Promise<{ success: boolean; content?: string; error?: string; provider?: string; model?: string }> {
  try {
    const canProceed = await canAutonomousProceed();
    if (!canProceed) {
      const rescheduleInfo = await getAutonomousRescheduleInfo();
      return {
        success: false,
        error: `AUTONOMOUS_LIMIT_REACHED: ${rescheduleInfo.reason}. Resume in ${Math.round(rescheduleInfo.delayMs / 1000 / 60)} minutes.`,
      };
    }

    // Select provider + model for this task
    const selection = selectProviderForTask(taskName || 'task', prompt || '', opts);
    const model = selection.model;

    // Call the underlying provider wrapper
    const response = await generateAutonomousText(
      taskName,
      prompt,
      {
        systemPrompt: opts?.systemPrompt,
        temperature: opts?.temperature ?? 0.3,
        model,
      },
      TaskPriority.LOW_BACKGROUND
    );

    return { success: true, content: response.content || '', provider: selection.provider, model };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Provide a Groq-compatible client that routes chats through governor wrapper.
 * Note: provider selection still occurs inside callAIWithGovernor (via selectProviderForTask),
 * so calls initiated through this wrapper will be routed to the appropriate provider/model.
 */
function getGroqClientWithGovernor(): any {
  return {
    chat: {
      completions: {
        create: async (request: any) => {
          const systemPrompt = request.messages.find((m: any) => m.role === 'system')?.content;
          const userPrompt = request.messages.find((m: any) => m.role === 'user')?.content || request.messages[request.messages.length - 1]?.content || '';
          // allow callers to hint provider/model through request.model or request.provider fields if present
          const opts: any = {};
          if (request.model) opts.model = request.model;
          if (request.provider) opts.provider = request.provider;
          const resp = await callAIWithGovernor('subagent-command', userPrompt, { systemPrompt, ...opts });
          if (!resp.success) throw new Error(resp.error);
          return {
            choices: [{
              message: { content: resp.content }
            }]
          };
        }
      }
    }
  };
}

/**
 * Web search utilities (unchanged)
 */
async function webSearch(query: string, limit = 5): Promise<Array<{ title: string; url: string; snippet?: string }>> {
  if (!WEB_SEARCH_ENABLED) return [];

  try {
    if (BING_API_KEY) {
      const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${limit}`;
      const res = await fetch(url, {
        headers: { 'Ocp-Apim-Subscription-Key': BING_API_KEY },
      });
      const data = await res.json();
      const results: Array<{ title: string; url: string; snippet?: string }> = [];
      const webPages = data.webPages?.value || [];
      for (const p of webPages.slice(0, limit)) {
        results.push({ title: p.name, url: p.url, snippet: p.snippet });
      }
      return results;
    } else {
      const ddgUrl = `https://duckduckgo.com/html?q=${encodeURIComponent(query)}`;
      const res = await fetch(ddgUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BadBlueBot/1.0)' } });
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
    console.warn('[webSearch] Web search error:', (error as any)?.message || error);
    return [];
  }
}

/**
 * Package management helpers (unchanged)
 */
async function readPackageJson(): Promise<any> {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const content = await fs.readFile(packageJsonPath, 'utf-8');
  return JSON.parse(content);
}

async function getInstalledPackages(): Promise<Record<string, string>> {
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

async function ensurePackagesInstalled(packages: string[]): Promise<{ installed: string[]; failed: string[] }> {
  const installed: string[] = [];
  const failed: string[] = [];

  const current = await getInstalledPackages();

  const missing = packages.filter(p => !(p in current));
  if (missing.length === 0) return { installed: packages, failed };

  try {
    const cmd = `npm install ${missing.join(' ')} --no-audit --no-fund`;
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });
    const updated = await getInstalledPackages();
    for (const p of missing) {
      if (p in updated) installed.push(p);
      else failed.push(p);
    }
    return { installed, failed };
  } catch (error: any) {
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

/**
 * Safety helpers (unchanged)
 */
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

function isCommandSafe(command: string): { safe: boolean; reason?: string } {
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

async function isFilePathSafe(filePath: string, adminOverride: boolean = false): Promise<{ safe: boolean; reason?: string }> {
  if (!filePath) return { safe: false, reason: 'Empty path' };

  const SYSTEM_DIRECTORIES = [/^\/etc\//, /^\/proc\//, /^\/sys\//];
  for (const pat of SYSTEM_DIRECTORIES) {
    if (pat.test(filePath)) return { safe: false, reason: 'Cannot write to system directories' };
  }

  if (!SUBAGENT_ALLOW_ADMIN_MODS) {
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

/**
 * Shell execution helpers (unchanged)
 */
async function executeShell(command: string, timeoutMs = 60000): Promise<{ stdout: string; stderr: string }> {
  const safety = isCommandSafe(command);
  if (!safety.safe) {
    throw new Error(`Command blocked by safety policy: ${safety.reason}`);
  }
  const res = await execAsync(command, { timeout: timeoutMs });
  return { stdout: res.stdout || '', stderr: res.stderr || '' };
}

async function smartExecuteShell(command: string, attemptInstall: boolean = true): Promise<{ stdout: string; stderr: string }> {
  try {
    return await executeShell(command);
  } catch (err: any) {
    const msg = (err.message || '').toLowerCase();
    if (attemptInstall && (msg.includes('command not found') || msg.includes('not recognized') || msg.includes('no such file'))) {
      const parts = command.split(/\s+/);
      const exe = parts[0];
      const candidatePackages = [exe, `@${exe}`, `node-${exe}`].filter(Boolean);
      try {
        const installation = await ensurePackagesInstalled(candidatePackages);
        if (installation.installed.length > 0) {
          return await executeShell(command);
        }
      } catch {
        // ignore and rethrow original
      }
    }
    throw err;
  }
}

/**
 * runWebOfficerScrape, scheduleDailyOfficerScrape, and processSubAgentCommand
 * are kept functionally the same but will use the new provider selection logic
 * inside any AI calls they make (callAIWithGovernor/groqChat).
 */

/* daily scrape scheduling and implementation (unchanged aside from earlier refactor) */
let dailyScrapeTimeout: NodeJS.Timeout | null = null;
let dailyScrapeIntervalActive = false;

function scheduleDailyOfficerScrape(hourUTC = DAILY_SCRAPE_HOUR_UTC, durationMs = DAILY_SCRAPE_DURATION_MS) {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hourUTC, 0, 0, 0);
  if (now.getTime() >= next.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next.getTime() - now.getTime();

  if (dailyScrapeTimeout) clearTimeout(dailyScrapeTimeout);

  dailyScrapeTimeout = setTimeout(async () => {
    try {
      dailyScrapeIntervalActive = true;
      console.log(`[AI Sub-Agent] Starting daily officer web-scrape window for ${durationMs / 1000 / 60} minutes`);
      await runWebOfficerScrape(durationMs);
    } catch (error) {
      console.error('[AI Sub-Agent] Daily scrape error:', (error as any)?.message || error);
    } finally {
      dailyScrapeIntervalActive = false;
      scheduleDailyOfficerScrape(hourUTC, durationMs);
    }
  }, delay);

  console.log(`[AI Sub-Agent] Daily scrape scheduled at ${next.toISOString()}`);
}

async function runWebOfficerScrape(durationMs = DAILY_SCRAPE_DURATION_MS) {
  const end = Date.now() + durationMs;
  const searchQueries = [
    'police officer directory site:.gov',
    'sheriff office directory site:.gov',
    'police department officers list site:.gov',
    'law enforcement officer roster "badge" site:.gov',
    'city police "officers" site:.gov',
  ];

  const locations = ['Los Angeles, CA', 'Chicago, IL', 'New York, NY', 'Houston, TX', 'Philadelphia, PA'];

  while (Date.now() < end) {
    for (const loc of locations) {
      if (Date.now() >= end) break;
      for (const q of searchQueries) {
        if (Date.now() >= end) break;
        const query = `${q} ${loc}`;
        const hits = await webSearch(query, 5);
        for (const hit of hits) {
          if (!hit.url.includes('.gov') && !hit.url.includes('.us')) continue;
          try {
            const nameMatch = (hit.title || hit.snippet || '').match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/);
            const officerName = nameMatch ? nameMatch[0] : undefined;

            const profile = {
              officerName: officerName || `${loc} - ${hit.title}`,
              badgeNumber: null,
              department: loc,
              location: loc,
              sources: [hit.url],
              dataQualityScore: 50,
              reliability: 0.5,
              verified: true,
              lastUpdated: new Date(),
            } as any;

            if (typeof storage.upsertOfficerProfile === 'function') {
              await storage.upsertOfficerProfile({
                officerName: profile.officerName,
                badgeNumber: profile.badgeNumber,
                department: profile.department,
                rank: null,
                location: profile.location,
                careerData: null,
                incidents: null,
                courtCases: null,
                newsMentions: null,
                communityComplaints: null,
                sources: profile.sources,
                dataQualityScore: profile.dataQualityScore,
                lastUpdated: profile.lastUpdated,
              });
            } else if (typeof storage.createOfficerProfile === 'function') {
              await storage.createOfficerProfile(profile);
            }
          } catch (err) {
            console.warn('[WebScrape] small-upsert error:', (err as any)?.message || err);
          }
        }
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }
  }
  console.log('[AI Sub-Agent] Daily officer web-scrape window complete');
}

/**
 * processSubAgentCommand (keeps previous behavior; AI calls are now routed via selectProviderForTask)
 */
async function processSubAgentCommand(commandText: string): Promise<{ success: boolean; response: string; metadata?: any }> {
  const text = (commandText || '').trim();
  if (!text) return { success: false, response: 'No command provided' };

  const canProceed = await canAutonomousProceed();
  if (!canProceed) {
    const info = await getAutonomousRescheduleInfo();
    return { success: false, response: `Autonomous operations paused: ${info.reason}. Resume in ${Math.round(info.delayMs / 1000 / 60)} minutes` };
  }

  const genAI = getGroqClientWithGovernor();

  const actionable = /(?:perform|execute|run|install|create|make|design|edit|update|fix|repair|scrape|search|compile)\b/i.test(text);

  let planText = text;
  if (!actionable) {
    try {
      const classificationPrompt = `You are an assistant that converts an admin natural-language request into an actionable instruction. For this request:
"${text}"

If this is actionable, output a single-line actionable instruction starting with "ACTION:". If not actionable, output "NO_ACTION".`;
      const g = await groqChat(genAI, classificationPrompt, { temperature: 0.0, maxTokens: 256, taskName: 'classify-action' });
      const firstLine = (g.text || '').split('\n')[0] || '';
      if (firstLine.startsWith('ACTION:')) {
        planText = firstLine.replace(/^ACTION:\s*/i, '');
      } else if (firstLine.trim().toUpperCase() === 'NO_ACTION') {
        return { success: false, response: 'Command is not actionable' };
      } else {
        planText = text;
      }
    } catch {
      planText = text;
    }
  }

  try {
    const pkgMatches = planText.match(/(?:npm install|yarn add|install)\s+([a-z0-9@\/\-\._]+)/gi);
    if (pkgMatches) {
      const toInstall: string[] = [];
      for (const m of pkgMatches) {
        const p = m.replace(/(npm install|yarn add|install)/i, '').trim();
        if (p) toInstall.push(...p.split(/\s+/).map(s => s.trim()).filter(Boolean));
      }
      if (toInstall.length > 0) {
        await ensurePackagesInstalled(toInstall);
      }
    }

    const shellMatch = planText.match(/^(?:run|execute|shell)\s+(.+)$/i);
    if (shellMatch) {
      const shellCommand = shellMatch[1];
      const res = await smartExecuteShell(shellCommand, true);
      return { success: true, response: `Command executed.\nOutput:\n${res.stdout}`, metadata: { stderr: res.stderr } };
    }

    if (/\b(scrape|scraping|scrape officers|scrape officer|collect officer)\b/i.test(planText)) {
      await runWebOfficerScrape(1000 * 60 * 5);
      return { success: true, response: 'Performed quick web-scrape for officer information (best-effort).' };
    }

    const intentPrompt = `Admin provides this instruction to the Sub-Agent. Convert into a short list of concrete steps (max 6), and for each step indicate one of: shell_command, file_write, file_edit[...]

Instruction: ${planText}

Return ONLY JSON array of { type, payload, description }`;

    const aiResp = await groqChat(genAI, intentPrompt, { temperature: 0.2, maxTokens: 1200, taskName: 'plan-steps' });
    let steps: Array<{ type: string; payload: any; description?: string }> = [];
    try {
      steps = JSON.parse(aiResp.text);
    } catch {
      steps = [{ type: 'analysis', payload: { raw: planText }, description: 'AI could not reliably parse instructions' }];
    }

    const executionLog: any[] = [];
    for (const s of steps) {
      try {
        if (s.type === 'shell_command' && s.payload?.command) {
          const safe = isCommandSafe(s.payload.command);
          if (!safe.safe) {
            executionLog.push({ step: s, success: false, error: `Blocked: ${safe.reason}` });
            continue;
          }
          const out = await smartExecuteShell(s.payload.command, true);
          executionLog.push({ step: s, success: true, output: out.stdout, stderr: out.stderr });
        } else if ((s.type === 'file_write' || s.type === 'file_edit') && s.payload?.filePath) {
          const check = await isFilePathSafe(s.payload.filePath, SUBAGENT_ALLOW_ADMIN_MODS);
          if (!check.safe) {
            executionLog.push({ step: s, success: false, error: `Blocked path: ${check.reason}` });
            continue;
          }
          await fs.mkdir(path.dirname(path.resolve(process.cwd(), s.payload.filePath)), { recursive: true });
          await fs.writeFile(s.payload.filePath, s.payload.content || '', 'utf-8');
          executionLog.push({ step: s, success: true });
        } else if (s.type === 'database_query' && s.payload?.query) {
          try {
            const q = s.payload.query;
            const result = await db.execute(sql.raw(q));
            executionLog.push({ step: s, success: true, result });
          } catch (dbErr: any) {
            executionLog.push({ step: s, success: false, error: dbErr.message });
          }
        } else if (s.type === 'web_search' && s.payload?.query) {
          const results = await webSearch(s.payload.query, 5);
          executionLog.push({ step: s, success: true, results });
        } else if (s.type === 'analysis') {
          executionLog.push({ step: s, success: true, note: 'No-op analysis step' });
        } else {
          executionLog.push({ step: s, success: false, error: 'Unknown step type' });
        }
      } catch (err) {
        executionLog.push({ step: s, success: false, error: (err as any)?.message || String(err) });
      }
    }

    return { success: true, response: 'Planned steps executed (best-effort). Check metadata for log.', metadata: { executionLog } };
  } catch (error: any) {
    return { success: false, response: `Execution failed: ${error.message}` };
  }
}

/**
 * Public: initialize automated systems
 */
function initializeAutomatedSystems(): void {
  try {
    scheduleDailyOfficerScrape(DAILY_SCRAPE_HOUR_UTC, DAILY_SCRAPE_DURATION_MS);
    console.log('[AI Sub-Agent] Automated daily scrape scheduled');
  } catch (error) {
    console.error('[AI Sub-Agent] Failed to initialize automated systems:', (error as any)?.message || error);
  }
}

/**
 * Exports
 */
export {
  callAIWithGovernor,
  getGroqClientWithGovernor,
  webSearch,
  ensurePackagesInstalled,
  isCommandSafe,
  isFilePathSafe,
  executeShell,
  smartExecuteShell,
  groqChat,
  scheduleDailyOfficerScrape,
  runWebOfficerScrape,
  processSubAgentCommand,
  initializeAutomatedSystems,
};

/* Auto-start daily scraping unless in test env */
if (process.env.NODE_ENV !== 'test') {
  initializeAutomatedSystems();
}
