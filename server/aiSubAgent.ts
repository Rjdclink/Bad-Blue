/**
 * server/aiSubAgent.ts
 * Revised AI Sub-Agent with enhanced capabilities:
 * - Multi-provider model selection (env-driven)
 * - Web search fallback (Bing if API key present, otherwise DuckDuckGo HTML)
 * - Intelligent package installation (npm) with auto-retry
 * - Safety checks with opt-in override for admin modifications
 * - Daily scheduled web scraping window for officer data (configurable)
 * - Groq / AI governor integration preserved (callAIWithGovernor)
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);

import {
  generateAutonomousText,
  canAutonomousProceed,
  getAutonomousRescheduleInfo,
  TaskPriority,
} from './aiProvider';

const SUBAGENT_DATA_DIR = path.join(process.cwd(), 'data', 'subagent');
const COMMAND_LOG = path.join(SUBAGENT_DATA_DIR, 'commands.log');
const TRAINING_QUEUE = path.join(SUBAGENT_DATA_DIR, 'trainingQueue.json');
const USAGE_LOG = path.join(SUBAGENT_DATA_DIR, 'usage.json');
const CHANGE_HISTORY = path.join(SUBAGENT_DATA_DIR, 'changeHistory.json');
const STATE_FILE = path.join(SUBAGENT_DATA_DIR, 'state.json');
const OFFICER_SEARCH_LOG = path.join(SUBAGENT_DATA_DIR, 'officerSearchLog.json');
const LEARNING_DATA = path.join(SUBAGENT_DATA_DIR, 'learningData.json');

const PREFERRED_MODEL = process.env.PREFERRED_MODEL || 'gpt-4o-mini';
const BING_API_KEY = process.env.BING_API_KEY || process.env.BING_SEARCH_KEY || '';
const SUBAGENT_ALLOW_ADMIN_MODS = process.env.SUBAGENT_ALLOW_ADMIN_MODS === 'true';
const WEB_SEARCH_ENABLED = process.env.WEB_SEARCH_ENABLED !== 'false';
const DAILY_SCRAPE_HOUR_UTC = Number(process.env.DAILY_SCRAPE_HOUR_UTC || 2);
const DAILY_SCRAPE_DURATION_MS = Number(process.env.DAILY_SCRAPE_DURATION_MS || 1000 * 60 * 60);
const MIN_API_CALL_INTERVAL_MS = 1500;

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_MODEL_CANDIDATES = [
  () => process.env.GEMINI_MODEL?.trim(),
  () => DEFAULT_GEMINI_MODEL,
  () => 'gemini-2.5-flash-latest',
  () => 'gemini-2.5-flash-exp',
  () => 'gemini-2.0-flash',
  () => 'gemini-1.5-flash-latest',
  () => 'gemini-1.5-pro-latest',
  () => 'gemini-1.5-flash-001',
  () => 'gemini-1.5-pro-002'
].map(fn => fn()).filter(Boolean) as string[];

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_COMMANDS_PER_MINUTE = 30;
let commandTimestamps: number[] = [];
let autonomousExecutionEnabled = false;
let stateLoaded = false;
let officerSearchTimeout: NodeJS.Timeout | null = null;
let dailyScrapeTimeout: NodeJS.Timeout | null = null;
let activeGeminiModel: string | null = null;

const BLOCKED_NETWORK_PATTERNS = [
  /^(curl|wget|nc|ncat|socat)\s+.*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i,
  /\|\s*(nc|ncat|netcat)\s+/i,
  />.*\/dev\/tcp\//i,
];
const DANGEROUS_PATTERNS = [
  /bash\s+-i\s+>&\s*\/dev\/tcp\//i,
  /python\s+-c\s+['"]import\s+socket/i,
  /:\(\)\{.*:\|:.*&\s*\};:/,
  /rm\s+-rf\s+\/+/i,
  /mkfs\./i,
  /dd\s+if=.*of=\/dev\//i,
  />\s*\/dev\/sd[a-z]/i,
  /chmod\s+777\s+\/+/i,
  /curl.*\|\s*(?:bash|sh|zsh)/i,
  /wget.*\|\s*(?:bash|sh|zsh)/i,
];
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
const SAFE_COMMAND_PREFIXES = [
  'npm','npx','node','tsc','tsx',
  'ls','cat','head','tail','grep','find','wc',
  'echo','pwd','whoami','date','uptime',
  'ps','top','df','du','free',
  'git status','git log','git diff','git branch',
  'which','type','file','stat'
];
const SYSTEM_DIRECTORIES = [/^\/etc\//, /^\/proc\//, /^\/sys\//];

export function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  const cmd = command.trim().toLowerCase();
  const trimmed = command.trim();
  
  for (const pattern of BLOCKED_NETWORK_PATTERNS) if (pattern.test(command)) return { safe: false, reason: 'Blocked: Network exfiltration attempt detected' };
  for (const pattern of DANGEROUS_PATTERNS) if (pattern.test(command)) return { safe: false, reason: 'Blocked: Dangerous command pattern detected' };
  for (const pat of APP_DELETION_PATTERNS) if (pat.test(trimmed)) return { safe: false, reason: 'Blocked catastrophic deletion pattern' };
  for (const pat of NETWORK_ATTACK_PATTERNS) if (pat.test(trimmed)) return { safe: false, reason: 'Blocked network attack pattern' };
  
  const isSafePrefix = SAFE_COMMAND_PREFIXES.some(prefix => cmd.startsWith(prefix));
  if (cmd.startsWith('npm ') || cmd.startsWith('npx ') || cmd.startsWith('cat ') || cmd.startsWith('ls ') || cmd.startsWith('find ')) return { safe: true };
  if (!isSafePrefix && !autonomousExecutionEnabled) return { safe: false, reason: 'Command requires autonomous execution mode to be enabled' };
  return { safe: true };
}

export async function isFilePathSafe(filePath: string, adminOverride: boolean = false): Promise<{ safe: boolean; reason?: string }> {
  if (!filePath) return { safe: false, reason: 'Empty path' };

  for (const pat of SYSTEM_DIRECTORIES) {
    if (pat.test(filePath)) return { safe: false, reason: 'Cannot write to system directories' };
  }

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

async function ensureDataDir() { try { await fs.mkdir(SUBAGENT_DATA_DIR, { recursive: true }); } catch {} }
async function safeReadJson<T=any>(f: string, def: T): Promise<T> { try { return JSON.parse(await fs.readFile(f,'utf-8')) as T; } catch { return def; } }
async function atomicWriteJson(file: string, data: any): Promise<void> {
  await ensureDataDir();
  const tmp = `${file}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data,null,2),'utf-8');
  try { await fs.rename(tmp,file); }
  catch {
    await fs.writeFile(file, JSON.stringify(data,null,2),'utf-8');
    try { await fs.unlink(tmp); } catch {}
  }
}
async function appendLog(record: Record<string, any>) {
  try {
    await ensureDataDir();
    const entry = { timestamp: new Date().toISOString(), ...record };
    await fs.appendFile(COMMAND_LOG, JSON.stringify(entry)+os.EOL,'utf-8');
  } catch {}
}
async function loadState() {
  if (stateLoaded) return;
  const state = await safeReadJson<{ autonomousExecutionEnabled?: boolean }>(STATE_FILE, {});
  autonomousExecutionEnabled = !!state.autonomousExecutionEnabled;
  stateLoaded = true;
}
async function saveState() { await atomicWriteJson(STATE_FILE, { autonomousExecutionEnabled }); }
function checkRateLimit(): { allowed: boolean; remaining: number } {
  const now = Date.now();
  commandTimestamps = commandTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  if (commandTimestamps.length >= MAX_COMMANDS_PER_MINUTE) return { allowed: false, remaining: 0 };
  commandTimestamps.push(now);
  return { allowed: true, remaining: MAX_COMMANDS_PER_MINUTE - commandTimestamps.length };
}

async function fetchWithFallback(url: string, options?: any): Promise<any> {
  if (typeof (globalThis as any).fetch === 'function') return (globalThis as any).fetch(url, options);
  try {
    const undici = await import('undici' as any);
    const f = (undici as any).fetch || (undici as any)?.default?.fetch;
    if (typeof f === 'function') return f(url, options);
  } catch {}
  throw new Error('No fetch implementation available');
}

/**
 * Governor-aware wrapper for AI calls.
 * Uses generateAutonomousText and respects autonomous quotas.
 */
export async function callAIWithGovernor(
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
 * Groq-compatible client that routes chats through governor wrapper.
 */
export function getGroqClientWithGovernor(): any {
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
 * Web search with Bing/DuckDuckGo fallback
 */
export async function webSearch(query: string, limit = 5): Promise<Array<{ title: string; url: string; snippet?: string }>> {
  if (!WEB_SEARCH_ENABLED) return [];

  try {
    if (BING_API_KEY) {
      const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${limit}`;
      const res = await fetchWithFallback(url, {
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
      const res = await fetchWithFallback(ddgUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BadBlueBot/1.0)' } });
      const html = await res.text();
      const regex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;
      const anchors: RegExpMatchArray[] = [];
      let m: RegExpMatchArray | null;
      while ((m = regex.exec(html)) !== null) anchors.push(m);
      const parsed: Array<{ title: string; url: string; snippet?: string }> = [];
      for (const a of anchors.slice(0, limit)) {
        const href = (a[1] || '').replace(/amp;/g, '');
        const title = (a[2] || '').replace(/<[^>]+>/g, '');
        parsed.push({ title, url: href });
      }
      return parsed;
    }
  } catch (error) {
    console.warn('[webSearch] Web search error:', (error as any)?.message || error);
    return [];
  }
}

async function intelligentWebSearch(query: string) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encoded}&site=stackoverflow&filter=withbody&pagesize=5`;
    const response = await fetchWithFallback(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) return { success: false, results: [], summary: 'Search failed' };
    const data = await response.json();
    const items = (data as any).items || [];
    return {
      success: true,
      results: items.map((i: any) => ({
        title: i.title,
        link: i.link,
        score: i.score,
        answered: i.is_answered,
        snippet: i.body?.substring(0,500)
      })),
      summary: `Found ${items.length} relevant results for "${query}"`
    };
  } catch (e: any) {
    await appendLog({ type:'webSearchError', query, error: e.message });
    return { success:false, results:[], summary:`Search failed: ${e.message}` };
  }
}

async function fetchWebContent(url: string) {
  try {
    const urlObj = new URL(url);
    const safeDomains = [
      'stackoverflow.com','github.com','npmjs.com','nodejs.org','developer.mozilla.org',
      'typescriptlang.org','google.com','api.stackexchange.com','raw.githubusercontent.com'
    ];
    const isSafe = safeDomains.some(d => urlObj.hostname.endsWith(d));
    if (!isSafe && !autonomousExecutionEnabled)
      return { success:false, error:'Domain not in safe list. Enable autonomous mode.' };
    const resp = await fetchWithFallback(url, { method:'GET', headers:{ 'User-Agent':'BadBlue-SubAgent/1.1' } });
    if (!resp.ok) return { success:false, error:`HTTP ${resp.status}` };
    const content = await resp.text();
    return { success:true, content: content.substring(0,50000) };
  } catch (e:any) { return { success:false, error:e.message }; }
}

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
 * Ensure packages installed with batch install and per-package fallback.
 */
export async function ensurePackagesInstalled(packages: string[]): Promise<{ installed: string[]; failed: string[] }> {
  const installed: string[] = [];
  const failed: string[] = [];

  const current = await getInstalledPackages();
  const missing = packages.filter(p => !(p in current));
  if (missing.length === 0) return { installed: packages, failed };

  try {
    const cmd = `npm install ${missing.join(' ')} --no-audit --no-fund`;
    await exec(cmd, { timeout: 120000 });
    const updated = await getInstalledPackages();
    for (const p of missing) {
      if (p in updated) installed.push(p);
      else failed.push(p);
    }
    return { installed, failed };
  } catch (error: any) {
    for (const p of missing) {
      try {
        await exec(`npm install ${p} --no-audit --no-fund`, { timeout: 60000 });
        installed.push(p);
      } catch {
        failed.push(p);
      }
    }
    return { installed, failed };
  }
}

async function analyzeRequiredPackages(code: string) {
  const pkgs = new Set<string>();
  const importRegex = /\b(?:import|require)\s*\(?['"]([^'".\/][^'"]*)['"]\)?/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(code)) !== null) {
    const pkg = match[1].split('/')[0];
    if (pkg && !pkg.startsWith('@types/')) pkgs.add(pkg);
  }
  const missing: string[] = [];
  const pkgArray = Array.from(pkgs);
  for (const p of pkgArray) { try { require.resolve(p); } catch { missing.push(p); } }
  return missing;
}

async function installPackages(packages: string[]) {
  if (!packages.length) return { success:true, installed:[], failed:[] };
  if (process.env.ALLOW_WORKER_INSTALL !== 'true') {
    await appendLog({ type:'packageInstallBlocked', packages, reason:'ALLOW_WORKER_INSTALL not enabled' });
    return { success:false, installed:[], failed:packages };
  }
  const installed: string[] = [];
  const failed: string[] = [];
  for (const pkg of packages) {
    const safeName = pkg.replace(/[^a-zA-Z0-9@/_.-]/g,'');
    if (safeName !== pkg) { failed.push(pkg); continue; }
    try {
      await exec(`npm install --no-audit --no-fund ${safeName}`, { timeout:60000 });
      installed.push(pkg);
      await appendLog({ type:'packageInstalled', package:pkg });
    } catch (e:any) {
      failed.push(pkg);
      await appendLog({ type:'packageInstallFailed', package:pkg, error:e.message });
    }
  }
  return { success: failed.length===0, installed, failed };
}

async function detectAndInstallMissingPackages() {
  const installed: string[] = [];
  try {
    const packageJsonPath = path.join(process.cwd(),'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath,'utf-8'));
    const declared = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const missing: string[] = [];
    for (const dep of Object.keys(declared)) { try { require.resolve(dep); } catch { missing.push(dep); } }
    if (missing.length && process.env.ALLOW_WORKER_INSTALL === 'true') {
      const result = await installPackages(missing);
      installed.push(...result.installed);
    }
    return { analyzed:Object.keys(declared).length, installed };
  } catch (e:any) {
    await appendLog({ type:'dependencyAnalysisFailed', error:e.message });
    return { analyzed:0, installed:[] };
  }
}

/**
 * Execute shell command with safety checks
 */
export async function executeShell(command: string, timeoutMs = 60000): Promise<{ stdout: string; stderr: string }> {
  const safety = isCommandSafe(command);
  if (!safety.safe) {
    throw new Error(`Command blocked by safety policy: ${safety.reason}`);
  }
  const res = await exec(command, { timeout: timeoutMs, maxBuffer: 10*1024*1024, cwd: process.cwd() });
  return { stdout: res.stdout || '', stderr: res.stderr || '' };
}

async function executeShellCommand(command: string) {
  const check = isCommandSafe(command);
  if (!check.safe) {
    await appendLog({ type:'blockedCommand', command, reason:check.reason });
    return { success:false, error:check.reason };
  }
  try {
    const { stdout, stderr } = await exec(command, { timeout:30000, maxBuffer:10*1024*1024, cwd:process.cwd() });
    await appendLog({ type:'shellExecution', command, success:true });
    return { success:true, stdout, stderr };
  } catch (e:any) {
    await appendLog({ type:'shellExecution', command, success:false, error:e.message });
    return { success:false, error:e.message, stdout:(e as any).stdout, stderr:(e as any).stderr };
  }
}

/**
 * Smart shell execution with auto-install for missing commands
 */
export async function smartExecuteShell(command: string, attemptInstall: boolean = true): Promise<{ stdout: string; stderr: string }> {
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
      } catch {}
    }
    throw err;
  }
}

/**
 * Groq chat helper using governor-aware client
 */
export async function groqChat(
  genAI: any | undefined,
  prompt: string,
  options?: { systemPrompt?: string; temperature?: number; maxTokens?: number; taskName?: string }
): Promise<{ text: string; raw?: any }> {
  const client = genAI || getGroqClientWithGovernor();
  const messages = [];
  if (options?.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
  messages.push({ role: 'user', content: prompt });

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

  const aiResp = await callAIWithGovernor(options?.taskName || 'groqChat', prompt, { systemPrompt: options?.systemPrompt, temperature: options?.temperature, model: PREFERRED_MODEL });
  if (!aiResp.success) throw new Error(aiResp.error || 'AI call failed');
  return { text: aiResp.content || '' };
}

async function getDatabase() { try { const { db } = await import('./db'); return db; } catch { return null; } }
async function queryDatabase(query: string, params?: any[]) {
  try {
    const db = await getDatabase();
    if (!db) return { success:false, error:'Database not available' };
    const qLower = query.trim().toLowerCase();
    const dangerous = ['drop','truncate','alter','create index','delete from users','delete from sessions'];
    for (const k of dangerous) if (qLower.includes(k)) return { success:false, error:`Blocked: Dangerous SQL operation "${k}"` };
    const result = await (db as any).execute(query, params);
    await appendLog({ type:'databaseQuery', query:query.substring(0,200), success:true });
    return { success:true, data:result };
  } catch (e:any) {
    await appendLog({ type:'databaseQuery', query:query.substring(0,200), success:false, error:e.message });
    return { success:false, error:e.message };
  }
}

async function insertOfficerRecord(officerData: any) {
  try {
    const db = await getDatabase();
    if (!db) return { success:false, error:'Database not available' };
    try {
      const schema = await import('@shared/schema');
      if ((schema as any).officers) {
        const result = await (db as any).insert((schema as any).officers).values(officerData).returning();
        return { success:true, id: result[0]?.id };
      }
    } catch {}
    const columns = Object.keys(officerData).join(', ');
    const placeholders = Object.keys(officerData).map((_,i)=>`$${i+1}`).join(', ');
    const values = Object.values(officerData);
    const result = await queryDatabase(`INSERT INTO officers (${columns}) VALUES (${placeholders}) RETURNING id`, values);
    return result.success ? { success:true, id: result.data?.rows?.[0]?.id } : { success:false, error:result.error };
  } catch (e:any) { return { success:false, error:e.message }; }
}

export function getConfiguredGeminiModel(): string {
  if (activeGeminiModel) return activeGeminiModel;
  return GEMINI_MODEL_CANDIDATES[0] || DEFAULT_GEMINI_MODEL;
}

async function callGeminiAPI(
  prompt: string,
  options: { maxTokens?: number; temperature?: number; allowFallback?: boolean } = {}
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { success:false, error:'GEMINI_API_KEY not configured' };
  const { maxTokens=8192, temperature=0.7, allowFallback=true } = options;
  const tried: string[] = [];
  const attempt = async (model: string) => {
    tried.push(model);
    try {
      const resp = await fetchWithFallback(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({
            contents:[{ role:'user', parts:[{ text: prompt }] }],
            generationConfig:{ maxOutputTokens:maxTokens, temperature },
            safetySettings:[
              { category:'HARM_CATEGORY_HARASSMENT', threshold:'BLOCK_NONE' },
              { category:'HARM_CATEGORY_HATE_SPEECH', threshold:'BLOCK_NONE' },
              { category:'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold:'BLOCK_NONE' },
              { category:'HARM_CATEGORY_DANGEROUS_CONTENT', threshold:'BLOCK_NONE' }
            ]
          })
        }
      );
      if (!resp.ok) {
        const errText = await resp.text();
        if ((resp.status === 404 || /model/i.test(errText)) && allowFallback) return { retry:true, error:`Model ${model} not found` };
        return { retry:false, error:`Gemini API error: ${resp.status} - ${errText}` };
      }
      const data = await resp.json() as any;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return { retry:false, error:'No response text from Gemini' };
      activeGeminiModel = model;
      await trackUsage({ action:'gemini_call', model, tokens: text.length/4, provider:'gemini' });
      return { retry:false, success:true, response:text };
    } catch (e:any) {
      if (/model/i.test(e.message) && allowFallback) return { retry:true, error:e.message };
      return { retry:false, error:e.message };
    }
  };
  for (const model of GEMINI_MODEL_CANDIDATES) {
    const r = await attempt(model);
    if (r.success) return { success:true, response:r.response, modelTried:tried };
    if (!r.retry) return { success:false, error:r.error, modelTried:tried };
  }
  return { success:false, error:`All Gemini model candidates failed: ${tried.join(', ')}`, modelTried:tried };
}

interface CommandIntent {
  action: 'search' | 'fix' | 'install' | 'query' | 'analyze' | 'execute' | 'configure' | 'report' | 'unknown';
  target?: string;
  parameters?: Record<string, any>;
  confidence: number;
}

async function interpretAdminCommand(command: string): Promise<CommandIntent> {
  const lower = command.toLowerCase();
  if (lower.includes('search officer') || lower.includes('find officer') || lower.includes('lookup officer')) {
    const match = command.match(/(?:search|find|lookup)\s+(?:for\s+)?(?:officer\s+)?["']?([^"']+)["']?/i);
    return { action:'search', target:'officer', parameters:{ query: match?.[1] || command }, confidence:0.9 };
  }
  if (lower.includes('install') || lower.includes('add package')) {
    const m = command.match(/(?:install|add)\s+(?:package\s+)?["']?([a-zA-Z0-9@/_.-]+)["']?/i);
    return { action:'install', target:'package', parameters:{ package: m?.[1] }, confidence:0.9 };
  }
  if (lower.includes('fix') || lower.includes('repair') || lower.includes('patch'))
    return { action:'fix', target:'system', parameters:{ description: command }, confidence:0.8 };
  if (lower.includes('query') || lower.includes('select') || lower.startsWith('get '))
    return { action:'query', target:'database', parameters:{ query: command }, confidence:0.8 };
  if (lower.includes('run') || lower.includes('execute') || lower.startsWith('$')) {
    const shellCmd = command.replace(/^(\$|run|execute)\s*/i,'');
    return { action:'execute', target:'shell', parameters:{ command: shellCmd }, confidence:0.85 };
  }
  if (lower.includes('analyze') || lower.includes('diagnose') || lower.includes('check'))
    return { action:'analyze', target:'system', parameters:{ scope: command }, confidence:0.8 };

  const aiResult = await callGeminiAPI(`
You are a command interpreter for a legal tech system admin panel. 
Analyze this admin command and return a JSON object with:
- action
- target
- parameters
- confidence (0-1)
Command: "${command}"
Respond ONLY with valid JSON.
`, { allowFallback:true });
  if (aiResult.success && aiResult.response) {
    try {
      const parsed = JSON.parse(aiResult.response.replace(/```json\n?|\n?```/g,''));
      return {
        action: parsed.action || 'unknown',
        target: parsed.target,
        parameters: parsed.parameters,
        confidence: parsed.confidence || 0.5
      };
    } catch {}
  }
  return { action:'unknown', confidence:0.3 };
}

async function performOfficerSearch(): Promise<{ searched: number; found: number; saved: number }> {
  await appendLog({ type:'officerSearchStarted', timestamp:new Date().toISOString() });
  let searched=0, found=0, saved=0;
  try {
    const db = await getDatabase();
    if (!db) {
      await appendLog({ type:'officerSearchError', error:'Database not available' });
      return { searched:0, found:0, saved:0 };
    }
    const pendingSearches = await queryDatabase(`
      SELECT DISTINCT state, city, department 
      FROM badge_lookups 
      WHERE created_at > NOW() - INTERVAL '7 days'
      LIMIT 50
    `);
    if (!pendingSearches.success || !pendingSearches.data?.rows?.length) {
      const targets = [
        { state:'California', city:'Los Angeles', department:'LAPD' },
        { state:'New York', city:'New York', department:'NYPD' },
        { state:'Texas', city:'Houston', department:'Houston PD' },
        { state:'Florida', city:'Miami', department:'Miami PD' },
        { state:'Illinois', city:'Chicago', department:'Chicago PD' }
      ];
      for (const t of targets) {
        searched++;
        const searchResult = await callGeminiAPI(`
You are a law enforcement research assistant. Provide JSON array of officers with public info:
Department: ${t.department}
City: ${t.city}
State: ${t.state}
Format:
[{"name":"Full Name","badge":"Badge","rank":"Rank","department":"${t.department}","state":"${t.state}","city":"${t.city}","publicRecords":"Public disciplinary or commendation notes"}]
Return [] if none. Respond ONLY with JSON.
`, { maxTokens:4096 });
        if (searchResult.success && searchResult.response) {
          try {
            const officers = JSON.parse(searchResult.response.replace(/```json\n?|\n?```/g,''));
            for (const officer of officers) {
              found++;
              const insertResult = await insertOfficerRecord({
                name: officer.name,
                badge_number: officer.badge || null,
                department: officer.department,
                state: officer.state,
                city: officer.city,
                rank: officer.rank || null,
                notes: officer.publicRecords || null,
                source: 'ai_search',
                last_updated: new Date().toISOString()
              });
              if (insertResult.success) saved++;
            }
          } catch {}
        }
        await new Promise(r=>setTimeout(r,2000));
      }
    }
    await appendLog({ type:'officerSearchCompleted', searched, found, saved, timestamp:new Date().toISOString() });
    const searchLog = await safeReadJson<any[]>(OFFICER_SEARCH_LOG, []);
    searchLog.push({ timestamp:new Date().toISOString(), searched, found, saved });
    const cutoff = Date.now() - 30*24*60*60*1000;
    await atomicWriteJson(OFFICER_SEARCH_LOG, searchLog.filter(e => new Date(e.timestamp).getTime() > cutoff));
  } catch (e:any) {
    await appendLog({ type:'officerSearchError', error:e.message });
  }
  return { searched, found, saved };
}

/**
 * Web scraping for officer data
 */
export async function runWebOfficerScrape(): Promise<{ success: boolean; scraped: number; saved: number }> {
  await appendLog({ type:'webOfficerScrapeStarted', timestamp: new Date().toISOString() });
  let scraped = 0, saved = 0;
  
  try {
    const webResults = await webSearch('police officer public records database', 10);
    for (const result of webResults) {
      scraped++;
      const content = await fetchWebContent(result.url);
      if (content.success && content.content) {
        const aiResult = await callAIWithGovernor('officer-data-extraction', `
Extract any police officer information from this content. Return JSON array:
[{"name":"Full Name","badge":"Badge","department":"Department","state":"State","city":"City"}]
Return [] if no officer data found.
Content: ${content.content.substring(0, 10000)}
`, { temperature: 0.2 });
        
        if (aiResult.success && aiResult.content) {
          try {
            const officers = JSON.parse(aiResult.content.replace(/```json\n?|\n?```/g,''));
            for (const officer of officers) {
              if (officer.name && officer.department) {
                const insertResult = await insertOfficerRecord({
                  name: officer.name,
                  badge_number: officer.badge || null,
                  department: officer.department,
                  state: officer.state || 'Unknown',
                  city: officer.city || 'Unknown',
                  source: 'web_scrape',
                  last_updated: new Date().toISOString()
                });
                if (insertResult.success) saved++;
              }
            }
          } catch {}
        }
      }
      await new Promise(r => setTimeout(r, MIN_API_CALL_INTERVAL_MS));
    }
    
    await appendLog({ type:'webOfficerScrapeCompleted', scraped, saved, timestamp: new Date().toISOString() });
    return { success: true, scraped, saved };
  } catch (e: any) {
    await appendLog({ type:'webOfficerScrapeError', error: e.message });
    return { success: false, scraped, saved };
  }
}

/**
 * Schedule daily officer scrape with configurable window
 */
export function scheduleDailyOfficerScrape(hourUTC: number = DAILY_SCRAPE_HOUR_UTC, durationMs: number = DAILY_SCRAPE_DURATION_MS): void {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hourUTC,
    0, 0, 0
  ));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next.getTime() - now.getTime();

  if (dailyScrapeTimeout) clearTimeout(dailyScrapeTimeout);

  dailyScrapeTimeout = setTimeout(async () => {
    console.log(`[Sub-Agent] Starting daily officer scrape window at ${hourUTC}:00 UTC for ${durationMs/1000/60} minutes...`);
    
    const endTime = Date.now() + durationMs;
    while (Date.now() < endTime) {
      const canProceed = await canAutonomousProceed();
      if (!canProceed) {
        console.log('[Sub-Agent] Autonomous limit reached, pausing scrape...');
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }
      
      await performOfficerSearch();
      await runWebOfficerScrape();
      
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
    }
    
    console.log('[Sub-Agent] Daily scrape window complete.');
    scheduleDailyOfficerScrape(hourUTC, durationMs);
  }, delay);

  console.log(`[Sub-Agent] Daily scrape scheduled for ${next.toISOString()} (in ${(delay/1000/60).toFixed(2)} minutes).`);
}

function scheduleOfficerSearch(targetTime?: string): void {
  const timeStr = (targetTime || process.env.SUBAGENT_OFFICER_SEARCH_UTC_TIME || '02:30').trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr);
  let hours = 2, minutes = 30;
  if (match) {
    hours = Math.min(23, parseInt(match[1],10));
    minutes = Math.min(59, parseInt(match[2],10));
  } else {
    console.warn(`[Sub-Agent] Invalid SUBAGENT_OFFICER_SEARCH_UTC_TIME "${timeStr}", falling back to 02:30.`);
  }

  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hours,
    minutes,
    0,
    0
  ));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next.getTime() - now.getTime();

  if (officerSearchTimeout) clearTimeout(officerSearchTimeout);

  officerSearchTimeout = setTimeout(async () => {
    console.log(`[Sub-Agent] Running scheduled officer search at ${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')} UTC...`);
    await performOfficerSearch();
    scheduleOfficerSearch(timeStr);
  }, delay);

  console.log(`[Sub-Agent] Officer search scheduled for ${next.toISOString()} (in ${(delay/1000/60).toFixed(2)} minutes).`);
}

export async function processSubAgentCommand(opts: {
  command: string;
  category?: string;
  userId?: number;
  [key: string]: any;
}) {
  await ensureDataDir();
  await loadState();
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    return { success:false, response:'Rate limit exceeded. Please wait.', packagesToInstall:[], fixedCount:0 };
  }
  await appendLog({ type:'processCommand', command: opts.command, category: opts.category || 'general', userId: opts.userId });
  const command = opts.command || '';
  const intent = await interpretAdminCommand(command);
  let response='', packagesToInstall:string[]=[], fixedCount=0, data:any=null;
  try {
    switch (intent.action) {
      case 'search':
        if (intent.target === 'officer') {
          const q = intent.parameters?.query || command;
          const dbResult = await queryDatabase(
            `SELECT * FROM officers WHERE name ILIKE $1 OR badge_number ILIKE $1 OR department ILIKE $1 LIMIT 20`,
            [`%${q}%`]
          );
          if (dbResult.success) {
            data = dbResult.data?.rows || [];
            response = `Found ${data.length} officer(s) matching "${q}"`;
          } else {
            const webResult = await webSearch(`law enforcement officer ${q}`, 10);
            data = webResult;
            response = `Web search completed, found ${webResult.length} results`;
          }
        } else {
          const webResult = await webSearch(command, 10);
          data = webResult;
          response = `Search completed, found ${webResult.length} results`;
        }
        break;
      case 'install': {
        const pkg = intent.parameters?.package;
        if (pkg) {
          packagesToInstall = [pkg];
          const installResult = await installPackages([pkg]);
          response = installResult.success ? `Successfully installed ${pkg}` : `Failed to install ${pkg}: ${installResult.failed.join(', ')}`;
          data = installResult;
        } else {
          const detectResult = await detectAndInstallMissingPackages();
          packagesToInstall = detectResult.installed;
          response = `Analyzed ${detectResult.analyzed} dependencies, installed ${detectResult.installed.length} missing packages`;
          data = detectResult;
        }
        break;
      }
      case 'fix': {
        const fixPrompt = `
Analyze and provide code fixes:
Issue: ${intent.parameters?.description || command}
Context: Node.js/TypeScript, PostgreSQL/Supabase, Express backend, React frontend, Stripe, Gemini AI.
Return root cause, specific patch, and verification steps.
`;
        const fixResult = await callGeminiAPI(fixPrompt, { maxTokens:4096 });
        if (fixResult.success) { response = fixResult.response || 'Analysis complete'; fixedCount = 1; }
        else response = `Could not analyze: ${fixResult.error}`;
        break;
      }
      case 'execute': {
        const shellCmd = intent.parameters?.command;
        if (shellCmd) {
          try {
            const execResult = await smartExecuteShell(shellCmd);
            response = execResult.stdout || 'Command executed successfully';
            data = { stdout: execResult.stdout, stderr: execResult.stderr };
          } catch (e: any) {
            response = `Execution failed: ${e.message}`;
          }
        }
        break;
      }
      case 'query': {
        const queryResult = await queryDatabase(intent.parameters?.query || command);
        if (queryResult.success) { data = queryResult.data; response = `Query executed. ${queryResult.data?.rows?.length || 0} rows.`; }
        else response = `Query failed: ${queryResult.error}`;
        break;
      }
      case 'analyze': {
        const diagnostic = await runComprehensiveDiagnostic();
        data = diagnostic;
        response = `Diagnostic complete. Status: ${diagnostic.status}. ${diagnostic.checks.length} checks.`;
        break;
      }
      case 'report': {
        const reportPrompt = `
Generate system status:
1. DB health
2. AI services
3. Recent errors
4. Performance
5. Recommendations
Be specific.
`;
        const reportResult = await callGeminiAPI(reportPrompt);
        response = reportResult.success ? reportResult.response || 'Report generated' : `Report failed: ${reportResult.error}`;
        break;
      }
      default: {
        const helpResult = await callGeminiAPI(`
Admin command: "${command}"
Explain intent or ask for clarification. Be concise.
`);
        response = helpResult.success ? helpResult.response || 'Command processed' : 'Command logged. Provide clearer action.';
      }
    }
  } catch (e:any) {
    response = `Error processing command: ${e.message}`;
    await appendLog({ type:'commandError', command, error:e.message });
  }
  const change = { timestamp:new Date().toISOString(), command, action:intent.action, result:{ response: response.substring(0,500), success:true } };
  const history = await safeReadJson<any[]>(CHANGE_HISTORY, []);
  history.push(change);
  if (history.length > 100) history.splice(0, history.length - 100);
  await atomicWriteJson(CHANGE_HISTORY, history);
  return { success:true, response, packagesToInstall, fixedCount, action:intent.action, data };
}

export async function executeAdvancedReasoning(prompt: string, includePlan=false) {
  await appendLog({ type:'advancedReasoning', prompt:String(prompt).slice(0,2000) });
  const systemPrompt = `
You are an expert system architect.
${prompt}
${includePlan ? 'Provide numbered steps, risks, dependencies, confidence (0-1).' : ''}
Be thorough yet concise.
`;
  const result = await callGeminiAPI(systemPrompt, { maxTokens:8192, temperature:0.3 });
  if (!result.success) {
    return {
      analysis:`Advanced reasoning unavailable: ${result.error}.`,
      plan: includePlan ? { strategicPlan:{ steps:['Manual review required'], confidence:0.3 } } : undefined
    };
  }
  const analysis = result.response || '';
  let plan:any = undefined;
  if (includePlan) {
    try {
      const planMatch = analysis.match(/(?:plan|steps?):\s*\n([\s\S]*?)(?:\n\n|$)/i);
      if (planMatch) {
        const steps = planMatch[1].split('\n').filter((s: string)=>s.trim()).map((s: string)=>s.replace(/^\d+\.\s*/,''));
        plan = { strategicPlan:{ steps, confidence:0.75 } };
      } else {
        plan = { strategicPlan:{ steps:['Analyze state','Apply changes','Verify'], confidence:0.6 } };
      }
    } catch {
      plan = { strategicPlan:{ steps:['Review analysis'], confidence:0.5 } };
    }
  }
  return { analysis, plan };
}

export async function trackUsage(event: { action: string; tokens?: number; provider?: string; [k:string]: any }) {
  await ensureDataDir();
  const usage = await safeReadJson<any[]>(USAGE_LOG, []);
  usage.push({ timestamp:new Date().toISOString(), ...event });
  if (usage.length > 10000) usage.splice(0, usage.length - 10000);
  await atomicWriteJson(USAGE_LOG, usage);
}

export async function runComprehensiveDiagnostic() {
  await appendLog({ type:'runComprehensiveDiagnostic' });
  const checks:any[] = [];
  try {
    await ensureDataDir();
    const testFile = path.join(SUBAGENT_DATA_DIR,'.diagtest');
    await fs.writeFile(testFile,'ok','utf-8'); await fs.unlink(testFile);
    checks.push({ name:'dataDir', status:'ok', message:'Data directory writable' });
  } catch (e:any) {
    checks.push({ name:'dataDir', status:'fail', error:e?.message });
  }
  const envChecks = [
    { key:'GEMINI_API_KEY', required:true },
    { key:'GROQ_API_KEY', required:false },
    { key:'DATABASE_URL', required:true },
    { key:'STRIPE_SECRET_KEY', required:true },
    { key:'SESSION_SECRET', required:true }
  ];
  for (const { key, required } of envChecks) {
    const configured = !!process.env[key];
    checks.push({ name:key, status: configured ? 'configured' : required ? 'missing' : 'optional', required });
  }
  try {
    const dbResult = await queryDatabase('SELECT 1 as test');
    checks.push({ name:'database', status: dbResult.success ? 'ok' : 'fail', message: dbResult.success ? 'Database connected' : dbResult.error });
  } catch (e:any) { checks.push({ name:'database', status:'fail', error:e?.message }); }
  try {
    const geminiTest = await callGeminiAPI('Respond with just "OK" if you receive this.');
    checks.push({ name:'gemini_api', status: geminiTest.success ? 'ok' : 'fail', model:getConfiguredGeminiModel(), message: geminiTest.success ? 'Gemini API operational' : geminiTest.error });
  } catch (e:any) { checks.push({ name:'gemini_api', status:'fail', error:e?.message }); }
  try {
    const shellTest = await executeShellCommand('echo "test"');
    checks.push({ name:'shell', status: shellTest.success ? 'ok' : 'fail', message: shellTest.success ? 'Shell execution available' : shellTest.error });
  } catch (e:any) { checks.push({ name:'shell', status:'fail', error:e?.message }); }
  checks.push({
    name:'package_management',
    status: process.env.ALLOW_WORKER_INSTALL === 'true' ? 'enabled' : 'disabled',
    message: process.env.ALLOW_WORKER_INSTALL === 'true' ? 'Auto-install enabled' : 'Set ALLOW_WORKER_INSTALL=true to enable'
  });
  await loadState();
  checks.push({ name:'autonomous_execution', status: autonomousExecutionEnabled ? 'enabled' : 'disabled' });
  const mem = process.memoryUsage();
  checks.push({ name:'memory', status:'ok', heapUsedMB: Math.round(mem.heapUsed/1024/1024), heapTotalMB: Math.round(mem.heapTotal/1024/1024) });
  const failed = checks.filter(c => c.status === 'fail' || c.status === 'missing');
  return { status: failed.length === 0 ? 'healthy' : 'degraded', checks, timestamp:new Date().toISOString() };
}

export async function undoLastSubAgentChange() {
  await ensureDataDir();
  const history = await safeReadJson<any[]>(CHANGE_HISTORY, []);
  if (!history.length) return null;
  const last = history.pop();
  await atomicWriteJson(CHANGE_HISTORY, history);
  await appendLog({ type:'undoLastSubAgentChange', undone:last });
  return last;
}

export async function getLastSubAgentChange() {
  const history = await safeReadJson<any[]>(CHANGE_HISTORY, []);
  return history.length ? history[history.length - 1] : null;
}

export async function setAutonomousExecution(enabled: boolean) {
  await loadState();
  autonomousExecutionEnabled = !!enabled;
  await saveState();
  await appendLog({ type:'setAutonomousExecution', enabled:autonomousExecutionEnabled });
  console.log(`[Sub-Agent] Autonomous execution ${enabled ? 'ENABLED' : 'DISABLED'}`);
}

export async function getAutonomousExecutionStatus() {
  await loadState();
  return { enabled: autonomousExecutionEnabled };
}

export async function resetRateLimiter(reason?: string) {
  commandTimestamps = [];
  await appendLog({ type:'resetRateLimiter', reason:reason || 'Manual reset' });
  return true;
}

export async function applyTrainingToSubAgent(trainingPayload: any) {
  try {
    await ensureDataDir();
    const queue = await safeReadJson<any[]>(TRAINING_QUEUE, []);
    queue.push({ receivedAt:new Date().toISOString(), payload:trainingPayload });
    if (queue.length > 500) queue.splice(0, queue.length - 500);
    await atomicWriteJson(TRAINING_QUEUE, queue);
    await appendLog({ type:'trainingQueued', payloadSize: JSON.stringify(trainingPayload).length });
    const learning = await safeReadJson<any[]>(LEARNING_DATA, []);
    learning.push({ timestamp:new Date().toISOString(), type:'training', data:trainingPayload });
    if (learning.length > 1000) learning.splice(0, learning.length - 1000);
    await atomicWriteJson(LEARNING_DATA, learning);
    return true;
  } catch (e:any) {
    await appendLog({ type:'trainingFailed', error:e.message });
    return false;
  }
}

/**
 * Initialize automated systems - call on app start
 */
export function initializeAutomatedSystems(): void {
  try {
    if (process.env.SUBAGENT_ENABLE_DAILY_SCRAPE === 'true') {
      scheduleDailyOfficerScrape(DAILY_SCRAPE_HOUR_UTC, DAILY_SCRAPE_DURATION_MS);
      console.log('[AI Sub-Agent] Daily scrape window scheduled');
    }
    console.log('[AI Sub-Agent] Automated systems initialized');
  } catch (error) {
    console.error('[AI Sub-Agent] Failed to initialize automated systems:', (error as any)?.message || error);
  }
}

(async () => {
  try {
    await ensureDataDir();
    await loadState();
    if (process.env.SUBAGENT_ENABLE_OFFICER_SEARCH === 'true') {
      scheduleOfficerSearch();
    } else {
      console.log('[Sub-Agent] Officer search disabled (SUBAGENT_ENABLE_OFFICER_SEARCH not true).');
    }

    const cleanup = () => {
      if (officerSearchTimeout) clearTimeout(officerSearchTimeout);
      if (dailyScrapeTimeout) clearTimeout(dailyScrapeTimeout);
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  } catch (e:any) {
    console.error('[Sub-Agent] Initialization error:', e.message);
    await appendLog({ type:'initError', error:e.message });
  }
})();

if (process.env.NODE_ENV !== 'test') {
  initializeAutomatedSystems();
}

export async function executeStructuredCommand(command: {
  type: string;
  searchParams?: Record<string, any>;
  limit?: number;
  includeHistory?: boolean;
  timestamp?: Date;
  confidence?: number;
}): Promise<{
  success: boolean;
  result?: any;
  response?: any;
  errorMessage?: string;
  metadata?: Record<string, any>;
}> {
  try {
    let textCommand = '';
    if (command.type === 'search_officers') {
      const p = command.searchParams || {};
      textCommand = `search officer "${p.name || ''}" state=${p.state || ''} city=${p.city || ''} county=${p.county || ''} badge=${p.badgeNumber || ''} type=${p.officerType || ''} limit=${command.limit ?? 10}`;
    } else {
      textCommand = `execute ${JSON.stringify(command)}`;
    }

    const result = await processSubAgentCommand({ command: textCommand, category: command.type });
    const normalized = {
      success: !!result?.success,
      result: result?.data || result,
      response: result?.response,
      metadata: {
        action: result?.action,
        packagesToInstall: result?.packagesToInstall,
        fixedCount: result?.fixedCount,
      },
    };

    return normalized;
  } catch (e: any) {
    return {
      success: false,
      errorMessage: e?.message || 'executeStructuredCommand failed',
      metadata: { exception: true },
    };
  }
}

export async function learnFromLegalConsultation(
  text: string,
  context?: { state?: string; category?: string; [k: string]: any }
): Promise<boolean> {
  try {
    await trackUsage({
      action: 'learning_event',
      provider: 'internal',
      tokens: Math.round((text?.length || 0) / 4),
      category: context?.category || 'general',
      state: context?.state || 'UNKNOWN',
    });

    await applyTrainingToSubAgent({
      type: 'legal_consultation',
      context: context || {},
      content: (text || '').slice(0, 10000),
    });

    return true;
  } catch (e: any) {
    await trackUsage({ action: 'learning_event_failed', provider: 'internal', error: e?.message });
    return false;
  }
}
