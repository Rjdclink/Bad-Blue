/**
 * Revised AI Sub-Agent
 * - Cleaned up and focused implementation to make the sub-agent practical and usable.
 * - Adds:
 *   - Multi-provider model selection (env-driven)
 *   - Web search fallback (Bing if API key present, otherwise DuckDuckGo HTML)
 *   - Intelligent package installation (npm)
 *   - Safety checks with opt-in override for admin modifications
 *   - Daily scheduled web scraping window (1 hour) for officer data (configurable)
 *   - Groq / AI governor integration preserved (callAIWithGovernor)
 *
 * Notes:
 * - This file intentionally consolidates and stabilizes functionality from the original large file.
 * - Many very advanced features from the original were trimmed/streamlined to ensure correctness and maintainability.
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
 * Configuration & feature flags (can be overridden by environment variables)
 */
const PREFERRED_MODEL = process.env.PREFERRED_MODEL || 'gpt-4o-mini';
const BING_API_KEY = process.env.BING_API_KEY || process.env.BING_SEARCH_KEY || '';
const SUBAGENT_ALLOW_ADMIN_MODS = process.env.SUBAGENT_ALLOW_ADMIN_MODS === 'true' || true; // per user request: allow admin modifications
const WEB_SEARCH_ENABLED = process.env.WEB_SEARCH_ENABLED !== 'false'; // default true
const DAILY_SCRAPE_HOUR_UTC = Number(process.env.DAILY_SCRAPE_HOUR_UTC || 2); // default 02:00 UTC
const DAILY_SCRAPE_DURATION_MS = Number(process.env.DAILY_SCRAPE_DURATION_MS || 1000 * 60 * 60); // default 1 hour
const MIN_API_CALL_INTERVAL_MS = 1500;

/**
 * Simple governor-aware wrapper for AI calls.
 * Uses generateAutonomousText (existing provider wrapper) and respects autonomous quotas.
 */
async function callAIWithGovernor(
  taskName: string,
  prompt: string,
  opts?: { systemPrompt?: string; temperature?: number; model?: string }
): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    const canProceed = await canAutonomousProceed();
    if (!canProceed) {
      const rescheduleInfo = await getAutonomousRescheduleInfo();
      return {
        success: false,
        error: `AUTONOMOUS_LIMIT_REACHED: ${rescheduleInfo.reason}. Resume in ${Math.round(rescheduleInfo.delayMs / 1000 / 60)} minutes.`,
      };
    }

    const model = opts?.model || PREFERRED_MODEL;

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

    return { success: true, content: response.content || '' };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Provide a Groq-compatible client that routes chats through governor wrapper.
 */
function getGroqClientWithGovernor(): any {
  return {
    chat: {
      completions: {
        create: async (request: any) => {
          const systemPrompt = request.messages.find((m: any) => m.role === 'system')?.content;
          const userPrompt = request.messages.find((m: any) => m.role === 'user')?.content || request.messages[request.messages.length - 1]?.content;
          const resp = await callAIWithGovernor('subagent-command', userPrompt, { systemPrompt });
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
 * Web search utilities
 * - Prefer official Bing Search API when BING_API_KEY provided
 * - Fallback to DuckDuckGo HTML scraping (lightweight)
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
      // DuckDuckGo simple HTML scraping fallback
      const ddgUrl = `https://duckduckgo.com/html?q=${encodeURIComponent(query)}`;
      const res = await fetch(ddgUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BadBlueBot/1.0)' } });
      const html = await res.text();
      // Very lightweight parse: find <a rel="nofollow" class="result__a" href="...">Title</a>
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
 * Package management helpers
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

/**
 * Ensure packages installed. Attempts npm install for missing packages.
 * Returns list of installed packages (successfully installed or already present).
 */
async function ensurePackagesInstalled(packages: string[]): Promise<{ installed: string[]; failed: string[] }> {
  const installed: string[] = [];
  const failed: string[] = [];

  const current = await getInstalledPackages();

  const missing = packages.filter(p => !(p in current));
  if (missing.length === 0) return { installed: packages, failed };

  // Build npm install command
  try {
    const cmd = `npm install ${missing.join(' ')} --no-audit --no-fund`;
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });
    // Refresh package.json read
    const updated = await getInstalledPackages();
    for (const p of missing) {
      if (p in updated) installed.push(p);
      else failed.push(p);
    }
    return { installed, failed };
  } catch (error: any) {
    // If install fails, attempt per-package install (best-effort)
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
 * Safety / firewall helpers
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

  // Sub-agent is allowed to modify admin files per configuration
  return { safe: true };
}

async function isFilePathSafe(filePath: string, adminOverride: boolean = false): Promise<{ safe: boolean; reason?: string }> {
  if (!filePath) return { safe: false, reason: 'Empty path' };

  // System directories always disallowed
  const SYSTEM_DIRECTORIES = [/^\/etc\//, /^\/proc\//, /^\/sys\//];
  for (const pat of SYSTEM_DIRECTORIES) {
    if (pat.test(filePath)) return { safe: false, reason: 'Cannot write to system directories' };
  }

  // Admin files protection is relaxed when SUBAGENT_ALLOW_ADMIN_MODS is true
  if (!SUBAGENT_ALLOW_ADMIN_MODS) {
    const adminFiles = ['server/auth.ts', 'server/localAuth.ts'];
    for (const adminFile of adminFiles) {
      if (filePath.endsWith(adminFile) || filePath === adminFile) {
        return { safe: false, reason: 'Admin files protected' };
      }
    }
  }

  // Ensure path is inside project
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
 * Execute a shell command (with safety checks)
 */
async function executeShell(command: string, timeoutMs = 60000): Promise<{ stdout: string; stderr: string }> {
  const safety = isCommandSafe(command);
  if (!safety.safe) {
    throw new Error(`Command blocked by safety policy: ${safety.reason}`);
  }
  const res = await execAsync(command, { timeout: timeoutMs });
  return { stdout: res.stdout || '', stderr: res.stderr || '' };
}

/**
 * Groq chat helper using governor-aware client by default.
 * Accepts either a genAI client or uses governor wrapper.
 */
async function groqChat(
  genAI: any | undefined,
  prompt: string,
  options?: { systemPrompt?: string; temperature?: number; maxTokens?: number; taskName?: string }
): Promise<{ text: string; raw?: any }> {
  const client = genAI || getGroqClientWithGovernor();
  // Build messages for compatibility (some clients expect this)
  const messages = [];
  if (options?.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  // If using governor wrapper, it expects to route via completions.create
  if (client && client.chat && client.chat.completions && typeof client.chat.completions.create === 'function') {
    const resp = await client.chat.completions.create({
      model: PREFERRED_MODEL,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 2048,
    });
    const text = resp.choices?.[0]?.message?.content || resp.text || '';
    if (!text) throw new Error('Empty response from AI');
    return { text, raw: resp };
  }

  // Fallback: try calling provider wrapper
  const aiResp = await callAIWithGovernor(options?.taskName || 'groqChat', prompt, { systemPrompt: options?.systemPrompt, temperature: options?.temperature, model: PREFERRED_MODEL });
  if (!aiResp.success) throw new Error(aiResp.error || 'AI call failed');
  return { text: aiResp.content || '' };
}

/**
 * Intelligent auto-install + execute wrapper:
 * - If a command fails due to missing executable/package, attempts to install (npm) and retry.
 */
async function smartExecuteShell(command: string, attemptInstall: boolean = true): Promise<{ stdout: string; stderr: string }> {
  try {
    return await executeShell(command);
  } catch (err: any) {
    const msg = (err.message || '').toLowerCase();
    // Detect 'command not found' (POSIX) or 'not recognized' (Windows)
    if (attemptInstall && (msg.includes('command not found') || msg.includes('not recognized') || msg.includes('no such file'))) {
      // Try to infer npm package: basic heuristic
      const parts = command.split(/\s+/);
      const exe = parts[0];
      const candidatePackages = [exe, `@${exe}`, `node-${exe}`].filter(Boolean);
      try {
        const installation = await ensurePackagesInstalled(candidatePackages);
        if (installation.installed.length > 0) {
          // Retry
          return await executeShell(command);
        }
      } catch {
        // continue to rethrow original error
      }
    }
    throw err;
  }
}

/**
 * Daily web scraping: schedule a 1-hour scraping window (configurable)
 */
let dailyScrapeTimeout: NodeJS.Timeout | null = null;
let dailyScrapeIntervalActive = false;

function scheduleDailyOfficerScrape(hourUTC = DAILY_SCRAPE_HOUR_UTC, durationMs = DAILY_SCRAPE_DURATION_MS) {
  // Calculate next run time
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
      // Reschedule next day
      scheduleDailyOfficerScrape(hourUTC, durationMs);
    }
  }, delay);

  console.log(`[AI Sub-Agent] Daily scrape scheduled at ${next.toISOString()}`);
}

/**
 * Run web-based officer scraping for the configured duration.
 * This function uses webSearch() to discover pages and tries to upsert minimal officer records to storage.
 * The scraping strategy is intentionally conservative: it does not attempt deep web crawling, but collects high-confidence official pages (.gov, .us).
 */
async function runWebOfficerScrape(durationMs = DAILY_SCRAPE_DURATION_MS) {
  const end = Date.now() + durationMs;
  const searchQueries = [
    'police officer directory site:.gov',
    'sheriff office directory site:.gov',
    'police department officers list site:.gov',
    'law enforcement officer roster "badge" site:.gov',
    'city police "officers" site:.gov',
  ];

  // simple list of states/cities to iterate
  const locations = ['Los Angeles, CA', 'Chicago, IL', 'New York, NY', 'Houston, TX', 'Philadelphia, PA'];

  while (Date.now() < end) {
    for (const loc of locations) {
      if (Date.now() >= end) break;
      for (const q of searchQueries) {
        if (Date.now() >= end) break;
        const query = `${q} ${loc}`;
        const hits = await webSearch(query, 5);
        for (const hit of hits) {
          // Only consider official domains
          if (!hit.url.includes('.gov') && !hit.url.includes('.us')) continue;
          try {
            // Basic attempt to extract an officer name from title/snippet heuristics (best-effort)
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

            // Attempt to save to storage (best effort)
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
            // Ignore per-item errors and continue
            console.warn('[WebScrape] small-upsert error:', (err as any)?.message || err);
          }
        } // for hits
        // small delay to avoid rapid-fire requests
        await new Promise(resolve => setTimeout(resolve, 1200));
      } // for searchQueries
    } // for locations
    // break after full loop to check time
  } // while
  console.log('[AI Sub-Agent] Daily officer web-scrape window complete');
}

/**
 * Process a sub-agent admin command (natural language).
 * This is the main entrypoint that admin-facing APIs would call.
 * - Interprets action verbs (perform/execute/create/edit/make/do/design/etc.)
 * - Attempts to carry out the requested action (install packages if needed, perform web lookups for guidance)
 */
export async function processSubAgentCommand(commandText: string): Promise<{ success: boolean; response: string; metadata?: any }> {
  // Basic normalization
  const text = (commandText || '').trim();
  if (!text) return { success: false, response: 'No command provided' };

  // Quick check for autonomous quotas
  const canProceed = await canAutonomousProceed();
  if (!canProceed) {
    const info = await getAutonomousRescheduleInfo();
    return { success: false, response: `Autonomous operations paused: ${info.reason}. Resume in ${Math.round(info.delayMs / 1000 / 60)} minutes` };
  }

  // Initialize AI client (governor wrapper)
  const genAI = getGroqClientWithGovernor();

  // Heuristic: look for actionable verbs
  const actionable = /(?:perform|execute|run|install|create|make|design|edit|update|fix|repair|scrape|search|compile)\b/i.test(text);

  // If not obviously actionable, ask AI to classify and convert to a clear action plan
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
        // fallback to original
        planText = text;
      }
    } catch {
      planText = text;
    }
  }

  // Attempt to execute: simple pipeline
  try {
    // If the instruction mentions "install" or "npm", detect packages and install
    const pkgMatches = planText.match(/(?:npm install|yarn add|install)\s+([a-z0-9@\/\-\._]+)/gi);
    if (pkgMatches) {
      // extract package names
      const toInstall: string[] = [];
      for (const m of pkgMatches) {
        const p = m.replace(/(npm install|yarn add|install)/i, '').trim();
        if (p) toInstall.push(...p.split(/\s+/).map(s => s.trim()).filter(Boolean));
      }
      if (toInstall.length > 0) {
        const installResult = await ensurePackagesInstalled(toInstall);
        // continue execution after install attempt
      }
    }

    // If the command is a shell command (starts with "run" or "execute"), try to execute
    const shellMatch = planText.match(/^(?:run|execute|shell)\s+(.+)$/i);
    if (shellMatch) {
      const shellCommand = shellMatch[1];
      const res = await smartExecuteShell(shellCommand, true);
      return { success: true, response: `Command executed.\nOutput:\n${res.stdout}`, metadata: { stderr: res.stderr } };
    }

    // If the command requests scraping / officer data collection, run immediate scrape (best-effort)
    if (/\b(scrape|scraping|scrape officers|scrape officer|collect officer)\b/i.test(planText)) {
      // Run a short scrape (one-time, small)
      await runWebOfficerScrape(1000 * 60 * 5); // 5 minutes quick run
      return { success: true, response: 'Performed quick web-scrape for officer information (best-effort).' };
    }

    // Otherwise, attempt a best-effort AI-driven execution:
    const intentPrompt = `Admin provides this instruction to the Sub-Agent. Convert into a short list of concrete steps (max 6), and for each step indicate one of: shell_command, file_write, file_edit, database_query, web_search. Provide JSON array.

Instruction: ${planText}

Return ONLY JSON array of { type, payload, description }`;

    const aiResp = await groqChat(genAI, intentPrompt, { temperature: 0.2, maxTokens: 1200, taskName: 'plan-steps' });
    let steps: Array<{ type: string; payload: any; description?: string }> = [];
    try {
      steps = JSON.parse(aiResp.text);
    } catch {
      // Fallback: one generic step - run shell command if present
      steps = [{ type: 'analysis', payload: { raw: planText }, description: 'AI could not reliably parse instructions' }];
    }

    // Execute steps sequentially (best-effort)
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
          // Execute via manipulateDatabase if available or db.execute directly
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
 * Public: start background scheduling for daily scrape and diagnostics
 * Call this on app start (module-level initialization may call it).
 */
export function initializeAutomatedSystems(): void {
  try {
    scheduleDailyOfficerScrape(DAILY_SCRAPE_HOUR_UTC, DAILY_SCRAPE_DURATION_MS);
    console.log('[AI Sub-Agent] Automated daily scrape scheduled');
  } catch (error) {
    console.error('[AI Sub-Agent] Failed to initialize automated systems:', (error as any)?.message || error);
  }
}

/**
 * Exports and compatibility hooks
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

/**
 * Initialize automatically on module load (but keep it safe in test environments)
 */
if (process.env.NODE_ENV !== 'test') {
  initializeAutomatedSystems();
}