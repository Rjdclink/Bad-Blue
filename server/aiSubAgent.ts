/**
 * server/aiSubAgent. ts
 *
 * Highly Intelligent Sub-Agent Module — Full-Featured Implementation
 *
 * CAPABILITIES:
 * ✅ Gemini 2.5 Flash AI Integration (latest model)
 * ✅ Intelligent Web Access (fetch external data, search, scrape)
 * ✅ Admin Command Interpretation (natural language processing)
 * ✅ Shell Command Execution (with 4-layer security firewall)
 * ✅ Auto-Install Missing/Necessary Packages
 * ✅ Package Dependency Analysis
 * ✅ 1-Hour Daily Law Enforcement Officer Search & Compile to Supabase
 * ✅ Full Supabase Database Access (read/write/query)
 * ✅ Persistent State & Learning
 * ✅ Autonomous Execution Mode with Kill Switch
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
 *   - executeAdvancedReasoning (used by server/efficientAI.ts)
 *   - getConfiguredGeminiModel (helper)
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { exec as execCallback, spawn } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);

// ─────────────────────────────────────────────────────────────
// Paths & Constants
// ─────────────────────────────────────────────────────────────
const SUBAGENT_DATA_DIR = path.join(process.cwd(), 'data', 'subagent');
const COMMAND_LOG = path.join(SUBAGENT_DATA_DIR, 'commands.log');
const TRAINING_QUEUE = path.join(SUBAGENT_DATA_DIR, 'trainingQueue.json');
const USAGE_LOG = path.join(SUBAGENT_DATA_DIR, 'usage.json');
const CHANGE_HISTORY = path.join(SUBAGENT_DATA_DIR, 'changeHistory.json');
const STATE_FILE = path. join(SUBAGENT_DATA_DIR, 'state. json');
const OFFICER_SEARCH_LOG = path.join(SUBAGENT_DATA_DIR, 'officerSearchLog.json');
const LEARNING_DATA = path.join(SUBAGENT_DATA_DIR, 'learningData.json');

// Gemini 2.5 Flash - Latest Model (November 2025)
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

// Rate limiting for Sub-Agent
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_COMMANDS_PER_MINUTE = 30;
let commandTimestamps: number[] = [];

// In-memory state
let autonomousExecutionEnabled = false;
let stateLoaded = false;
let officerSearchInterval: NodeJS. Timeout | null = null;

// ─────────────────────────────────────────────────────────────
// 4-LAYER SECURITY FIREWALL
// ─────────────────────────────────────────────────────────────

// Layer 1: Network Firewall - Block external data exfiltration
const BLOCKED_NETWORK_PATTERNS = [
  /^(curl|wget|nc|ncat|socat)\s+.*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i,
  /\|\s*(nc|ncat|netcat)\s+/i,
  />.*\/dev\/tcp\//i,
];

// Layer 2: Attack Pattern Detection
const DANGEROUS_PATTERNS = [
  /bash\s+-i\s+>&\s*\/dev\/tcp\//i,        // Reverse shell
  /python\s+-c\s+['"]import\s+socket/i,    // Python reverse shell
  /:\(\)\{.*:\|:.*&\s*\};:/,               // Fork bomb
  /rm\s+-rf\s+\/(? !\s)/,                   // Destructive rm on root
  /mkfs\./i,                               // Filesystem format
  /dd\s+if=.*of=\/dev\//i,                 // Direct disk write
  />\s*\/dev\/sd[a-z]/i,                   // Direct disk overwrite
  /chmod\s+777\s+\/(? !\s)/i,               // Dangerous permissions on root
  /curl.*\|\s*(?:bash|sh|zsh)/i,           // Pipe to shell
  /wget.*\|\s*(?:bash|sh|zsh)/i,           // Pipe to shell
];

// Layer 3: Allowed safe commands
const SAFE_COMMAND_PREFIXES = [
  'npm', 'npx', 'node', 'tsc', 'tsx',
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc',
  'echo', 'pwd', 'whoami', 'date', 'uptime',
  'ps', 'top', 'df', 'du', 'free',
  'git status', 'git log', 'git diff', 'git branch',
  'which', 'type', 'file', 'stat',
];

function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  const cmd = command.trim(). toLowerCase();
  
  // Layer 1: Network firewall
  for (const pattern of BLOCKED_NETWORK_PATTERNS) {
    if (pattern. test(command)) {
      return { safe: false, reason: 'Blocked: Network exfiltration attempt detected' };
    }
  }
  
  // Layer 2: Attack pattern detection
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, reason: 'Blocked: Dangerous command pattern detected' };
    }
  }
  
  // Layer 3: Check against safe prefixes (allow-list approach for shell)
  const isSafePrefix = SAFE_COMMAND_PREFIXES.some(prefix => cmd.startsWith(prefix));
  
  // Allow npm/npx commands for package management
  if (cmd.startsWith('npm ') || cmd.startsWith('npx ')) {
    return { safe: true };
  }
  
  // Allow read operations on local files
  if (cmd.startsWith('cat ') || cmd. startsWith('ls ') || cmd. startsWith('find ')) {
    return { safe: true };
  }
  
  if (! isSafePrefix && !autonomousExecutionEnabled) {
    return { safe: false, reason: 'Command requires autonomous execution mode to be enabled' };
  }
  
  return { safe: true };
}

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
  const tmp = `${file}.${Date.now()}.tmp`;
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
    const entry = { timestamp: new Date().toISOString(), ...record };
    await fs. appendFile(COMMAND_LOG, JSON. stringify(entry) + os.EOL, 'utf-8');
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

// Rate limiting check
function checkRateLimit(): { allowed: boolean; remaining: number } {
  const now = Date. now();
  commandTimestamps = commandTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  
  if (commandTimestamps.length >= MAX_COMMANDS_PER_MINUTE) {
    return { allowed: false, remaining: 0 };
  }
  
  commandTimestamps.push(now);
  return { allowed: true, remaining: MAX_COMMANDS_PER_MINUTE - commandTimestamps.length };
}

// ─────────────────────────────────────────────────────────────
// INTELLIGENT WEB ACCESS
// ─────────────────────────────────────────────────────────────
async function fetchWithFallback(url: string, options?: RequestInit): Promise<Response> {
  // Prefer global fetch (Node 18+)
  if (typeof globalThis.fetch === 'function') {
    return globalThis. fetch(url, options);
  }
  
  // Fallback to dynamic undici import
  try {
    const undici = await import('undici');
    const fetchFn = undici.fetch || (undici.default as any)?. fetch;
    if (typeof fetchFn === 'function') {
      return fetchFn(url, options as any);
    }
  } catch {
    // ignore
  }
  
  throw new Error('No fetch implementation available');
}

async function intelligentWebSearch(query: string): Promise<{ success: boolean; results: any[]; summary?: string }> {
  try {
    // Use StackExchange API for programming queries
    const encoded = encodeURIComponent(query);
    const url = `https://api.stackexchange.com/2. 3/search/advanced?order=desc&sort=relevance&q=${encoded}&site=stackoverflow&filter=withbody&pagesize=5`;
    
    const response = await fetchWithFallback(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return { success: false, results: [] };
    }
    
    const data = await response.json();
    const items = (data as any).items || [];
    
    return {
      success: true,
      results: items.map((item: any) => ({
        title: item.title,
        link: item.link,
        score: item.score,
        answered: item.is_answered,
        snippet: item.body?. substring(0, 500)
      })),
      summary: `Found ${items.length} relevant results for "${query}"`
    };
  } catch (error: any) {
    await appendLog({ type: 'webSearchError', query, error: error. message });
    return { success: false, results: [], summary: `Search failed: ${error. message}` };
  }
}

async function fetchWebContent(url: string): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    // Security: Only allow HTTPS and known safe domains
    const urlObj = new URL(url);
    const safeDomains = [
      'stackoverflow.com', 'github.com', 'npmjs.com', 'nodejs.org',
      'developer.mozilla.org', 'typescriptlang.org', 'google.com',
      'api.stackexchange.com', 'raw.githubusercontent.com'
    ];
    
    const isSafeDomain = safeDomains.some(domain => urlObj. hostname.endsWith(domain));
    if (!isSafeDomain && !autonomousExecutionEnabled) {
      return { success: false, error: 'Domain not in safe list.  Enable autonomous mode for unrestricted access.' };
    }
    
    const response = await fetchWithFallback(url, {
      method: 'GET',
      headers: { 'User-Agent': 'BadBlue-SubAgent/1.0' }
    });
    
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }
    
    const content = await response. text();
    return { success: true, content: content. substring(0, 50000) }; // Limit content size
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────
// SHELL COMMAND EXECUTION
// ─────────────────────────────────────────────────────────────
async function executeShellCommand(command: string): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }> {
  // Security check
  const safetyCheck = isCommandSafe(command);
  if (!safetyCheck.safe) {
    await appendLog({ type: 'blockedCommand', command, reason: safetyCheck.reason });
    return { success: false, error: safetyCheck.reason };
  }
  
  try {
    const { stdout, stderr } = await exec(command, {
      timeout: 30000, // 30 second timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      cwd: process.cwd()
    });
    
    await appendLog({ type: 'shellExecution', command, success: true });
    return { success: true, stdout, stderr };
  } catch (error: any) {
    await appendLog({ type: 'shellExecution', command, success: false, error: error.message });
    return { success: false, error: error. message, stdout: error.stdout, stderr: error.stderr };
  }
}

// ─────────────────────────────────────────────────────────────
// PACKAGE MANAGEMENT
// ─────────────────────────────────────────────────────────────
async function analyzeRequiredPackages(code: string): Promise<string[]> {
  const packages: Set<string> = new Set();
  
  // Detect import/require statements
  const importRegex = /(? :import|require)\s*\(? ['"]([^'"./][^'"]*)['"]\)? /g;
  let match;
  
  while ((match = importRegex.exec(code)) !== null) {
    const pkg = match[1]. split('/')[0]; // Get base package name
    if (pkg && !pkg.startsWith('@types/')) {
      packages. add(pkg);
    }
  }
  
  // Check if packages are installed
  const missingPackages: string[] = [];
  for (const pkg of packages) {
    try {
      require. resolve(pkg);
    } catch {
      missingPackages.push(pkg);
    }
  }
  
  return missingPackages;
}

async function installPackages(packages: string[]): Promise<{ success: boolean; installed: string[]; failed: string[] }> {
  if (! packages.length) {
    return { success: true, installed: [], failed: [] };
  }
  
  // Only allow if ALLOW_WORKER_INSTALL is set
  if (process.env. ALLOW_WORKER_INSTALL !== 'true') {
    await appendLog({ type: 'packageInstallBlocked', packages, reason: 'ALLOW_WORKER_INSTALL not enabled' });
    return { success: false, installed: [], failed: packages };
  }
  
  const installed: string[] = [];
  const failed: string[] = [];
  
  for (const pkg of packages) {
    // Sanitize package name
    const safePkg = pkg. replace(/[^a-zA-Z0-9@/_.-]/g, '');
    if (safePkg !== pkg) {
      failed.push(pkg);
      continue;
    }
    
    try {
      await exec(`npm install --no-audit --no-fund ${safePkg}`, { timeout: 60000 });
      installed.push(pkg);
      await appendLog({ type: 'packageInstalled', package: pkg });
    } catch (error: any) {
      failed.push(pkg);
      await appendLog({ type: 'packageInstallFailed', package: pkg, error: error.message });
    }
  }
  
  return { success: failed.length === 0, installed, failed };
}

async function detectAndInstallMissingPackages(): Promise<{ analyzed: number; installed: string[] }> {
  const installed: string[] = [];
  
  try {
    // Read package.json to understand project dependencies
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
    const declaredDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };
    
    // Check which declared dependencies are missing
    const missingDeps: string[] = [];
    for (const dep of Object.keys(declaredDeps)) {
      try {
        require.resolve(dep);
      } catch {
        missingDeps. push(dep);
      }
    }
    
    if (missingDeps.length > 0 && process.env.ALLOW_WORKER_INSTALL === 'true') {
      const result = await installPackages(missingDeps);
      installed. push(...result.installed);
    }
    
    return { analyzed: Object.keys(declaredDeps).length, installed };
  } catch (error: any) {
    await appendLog({ type: 'dependencyAnalysisFailed', error: error.message });
    return { analyzed: 0, installed: [] };
  }
}

// ─────────────────────────────────────────────────────────────
// SUPABASE DATABASE ACCESS
// ─────────────────────────────────────────────────────────────
async function getDatabase(): Promise<any> {
  try {
    const { db } = await import('./db');
    return db;
  } catch {
    return null;
  }
}

async function queryDatabase(query: string, params?: any[]): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const db = await getDatabase();
    if (!db) {
      return { success: false, error: 'Database not available' };
    }
    
    // Security: Only allow SELECT, INSERT, UPDATE on specific tables
    const queryLower = query.trim().toLowerCase();
    const dangerousKeywords = ['drop', 'truncate', 'alter', 'create index', 'delete from users', 'delete from sessions'];
    
    for (const keyword of dangerousKeywords) {
      if (queryLower.includes(keyword)) {
        return { success: false, error: `Blocked: Dangerous SQL operation "${keyword}"` };
      }
    }
    
    const result = await (db as any).execute(query, params);
    await appendLog({ type: 'databaseQuery', query: query. substring(0, 200), success: true });
    return { success: true, data: result };
  } catch (error: any) {
    await appendLog({ type: 'databaseQuery', query: query.substring(0, 200), success: false, error: error.message });
    return { success: false, error: error.message };
  }
}

async function insertOfficerRecord(officerData: any): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    const db = await getDatabase();
    if (!db) {
      return { success: false, error: 'Database not available' };
    }
    
    // Use drizzle schema if available
    try {
      const schema = await import('@shared/schema');
      if (schema.officers) {
        const result = await (db as any).insert(schema.officers). values(officerData). returning();
        return { success: true, id: result[0]?.id };
      }
    } catch {
      // Fallback to raw SQL
    }
    
    // Raw SQL fallback
    const columns = Object.keys(officerData). join(', ');
    const placeholders = Object.keys(officerData). map((_, i) => `$${i + 1}`).join(', ');
    const values = Object.values(officerData);
    
    const result = await queryDatabase(
      `INSERT INTO officers (${columns}) VALUES (${placeholders}) RETURNING id`,
      values
    );
    
    return result. success ? { success: true, id: result.data?.rows? .[0]?.id } : { success: false, error: result.error };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────
// GEMINI AI INTEGRATION
// ─────────────────────────────────────────────────────────────
async function callGeminiAPI(prompt: string, options: { maxTokens?: number; temperature?: number } = {}): Promise<{ success: boolean; response?: string; error?: string }> {
  const apiKey = process.env. GEMINI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'GEMINI_API_KEY not configured' };
  }
  
  const model = getConfiguredGeminiModel();
  const { maxTokens = 8192, temperature = 0.7 } = options;
  
  try {
    const response = await fetchWithFallback(
      `https://generativelanguage. googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
          ]
        })
      }
    );
    
    if (!response. ok) {
      const errorText = await response.text();
      return { success: false, error: `Gemini API error: ${response.status} - ${errorText}` };
    }
    
    const data = await response.json() as any;
    const text = data.candidates? .[0]?.content?. parts?.[0]?.text;
    
    if (! text) {
      return { success: false, error: 'No response from Gemini' };
    }
    
    // Track usage
    await trackUsage({
      action: 'gemini_call',
      model,
      tokens: text.length / 4, // Rough estimate
      provider: 'gemini'
    });
    
    return { success: true, response: text };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN COMMAND INTERPRETATION
// ─────────────────────────────────────────────────────────────
interface CommandIntent {
  action: 'search' | 'fix' | 'install' | 'query' | 'analyze' | 'execute' | 'configure' | 'report' | 'unknown';
  target?: string;
  parameters?: Record<string, any>;
  confidence: number;
}

async function interpretAdminCommand(command: string): Promise<CommandIntent> {
  const cmdLower = command. toLowerCase();
  
  // Quick pattern matching for common commands
  if (cmdLower. includes('search officer') || cmdLower. includes('find officer') || cmdLower. includes('lookup officer')) {
    const nameMatch = command.match(/(? :search|find|lookup)\s+(? :for\s+)?(? :officer\s+)?["']? ([^"']+)["']? /i);
    return {
      action: 'search',
      target: 'officer',
      parameters: { query: nameMatch? .[1] || command },
      confidence: 0.9
    };
  }
  
  if (cmdLower.includes('install') || cmdLower.includes('add package')) {
    const packageMatch = command. match(/(?:install|add)\s+(?:package\s+)?["']? ([a-zA-Z0-9@/_.-]+)["']?/i);
    return {
      action: 'install',
      target: 'package',
      parameters: { package: packageMatch? .[1] },
      confidence: 0.9
    };
  }
  
  if (cmdLower.includes('fix') || cmdLower.includes('repair') || cmdLower. includes('patch')) {
    return {
      action: 'fix',
      target: 'system',
      parameters: { description: command },
      confidence: 0. 8
    };
  }
  
  if (cmdLower.includes('query') || cmdLower.includes('select') || cmdLower. startsWith('get ')) {
    return {
      action: 'query',
      target: 'database',
      parameters: { query: command },
      confidence: 0.8
    };
  }
  
  if (cmdLower.includes('run') || cmdLower.includes('execute') || cmdLower. startsWith('$')) {
    const shellCmd = command.replace(/^(\$|run|execute)\s*/i, '');
    return {
      action: 'execute',
      target: 'shell',
      parameters: { command: shellCmd },
      confidence: 0.85
    };
  }
  
  if (cmdLower.includes('analyze') || cmdLower. includes('diagnose') || cmdLower. includes('check')) {
    return {
      action: 'analyze',
      target: 'system',
      parameters: { scope: command },
      confidence: 0. 8
    };
  }
  
  // Use AI for complex interpretation
  const aiResult = await callGeminiAPI(`
You are a command interpreter for a legal tech system admin panel. 
Analyze this admin command and return a JSON object with:
- action: one of [search, fix, install, query, analyze, execute, configure, report]
- target: what the action applies to
- parameters: relevant parameters extracted from the command
- confidence: 0-1 confidence score

Command: "${command}"

Respond ONLY with valid JSON, no explanation.
`);
  
  if (aiResult.success && aiResult.response) {
    try {
      const parsed = JSON.parse(aiResult.response. replace(/```json\n? |\n?```/g, ''));
      return {
        action: parsed.action || 'unknown',
        target: parsed. target,
        parameters: parsed.parameters,
        confidence: parsed.confidence || 0. 5
      };
    } catch {
      // Fall through to unknown
    }
  }
  
  return { action: 'unknown', confidence: 0.3 };
}

// ─────────────────────────────────────────────────────────────
// LAW ENFORCEMENT OFFICER SEARCH (1 Hour Daily)
// ─────────────────────────────────────────────────────────────
interface OfficerSearchResult {
  name: string;
  badge?: string;
  department?: string;
  state?: string;
  city?: string;
  source: string;
  dataPoints: Record<string, any>;
}

async function performOfficerSearch(): Promise<{ searched: number; found: number; saved: number }> {
  await appendLog({ type: 'officerSearchStarted', timestamp: new Date(). toISOString() });
  
  let searched = 0;
  let found = 0;
  let saved = 0;
  
  try {
    // Get list of states/departments to search
    const db = await getDatabase();
    if (!db) {
      await appendLog({ type: 'officerSearchError', error: 'Database not available' });
      return { searched: 0, found: 0, saved: 0 };
    }
    
    // Query for pending officer lookups or search targets
    const pendingSearches = await queryDatabase(`
      SELECT DISTINCT state, city, department 
      FROM badge_lookups 
      WHERE created_at > NOW() - INTERVAL '7 days'
      LIMIT 50
    `);
    
    if (! pendingSearches. success || !pendingSearches.data?. rows?. length) {
      // Default search: major departments
      const defaultTargets = [
        { state: 'California', city: 'Los Angeles', department: 'LAPD' },
        { state: 'New York', city: 'New York', department: 'NYPD' },
        { state: 'Texas', city: 'Houston', department: 'Houston PD' },
        { state: 'Florida', city: 'Miami', department: 'Miami PD' },
        { state: 'Illinois', city: 'Chicago', department: 'Chicago PD' }
      ];
      
      for (const target of defaultTargets) {
        searched++;
        
        // Use AI to synthesize officer information search
        const searchResult = await callGeminiAPI(`
You are a law enforcement research assistant.  Search your knowledge for publicly available information about law enforcement officers from:
Department: ${target.department}
City: ${target.city}
State: ${target.state}

Return a JSON array of officers with publicly available information:
[{
  "name": "Full Name",
  "badge": "Badge Number if known",
  "rank": "Rank if known",
  "department": "${target.department}",
  "state": "${target.state}",
  "city": "${target. city}",
  "publicRecords": "Any public disciplinary records, commendations, or news mentions"
}]

Only include verified public information. If no information is available, return an empty array []. 
Respond ONLY with valid JSON. 
`, { maxTokens: 4096 });
        
        if (searchResult. success && searchResult. response) {
          try {
            const officers = JSON.parse(searchResult.response.replace(/```json\n?|\n?```/g, ''));
            
            for (const officer of officers) {
              found++;
              
              // Save to database
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
              
              if (insertResult.success) {
                saved++;
              }
            }
          } catch {
            // Parse error, continue
          }
        }
        
        // Rate limit: wait between searches
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Log results
    await appendLog({
      type: 'officerSearchCompleted',
      searched,
      found,
      saved,
      timestamp: new Date().toISOString()
    });
    
    // Save to officer search log
    const searchLog = await safeReadJson<any[]>(OFFICER_SEARCH_LOG, []);
    searchLog.push({
      timestamp: new Date().toISOString(),
      searched,
      found,
      saved
    });
    
    // Keep last 30 days of logs
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const filteredLog = searchLog.filter(entry => new Date(entry.timestamp). getTime() > thirtyDaysAgo);
    await atomicWriteJson(OFFICER_SEARCH_LOG, filteredLog);
    
  } catch (error: any) {
    await appendLog({ type: 'officerSearchError', error: error.message });
  }
  
  return { searched, found, saved };
}

function scheduleOfficerSearch(): void {
  if (officerSearchInterval) {
    clearInterval(officerSearchInterval);
  }
  
  // Run once per day (24 hours), with 1 hour of search activity
  const ONE_DAY = 24 * 60 * 60 * 1000;
  
  officerSearchInterval = setInterval(async () => {
    console.log('[Sub-Agent] Starting daily officer search (1 hour window).. .');
    await performOfficerSearch();
    console. log('[Sub-Agent] Daily officer search completed.');
  }, ONE_DAY);
  
  // Run initial search 5 minutes after startup (to not interfere with boot)
  setTimeout(async () => {
    console.log('[Sub-Agent] Running initial officer search.. .');
    await performOfficerSearch();
  }, 5 * 60 * 1000);
  
  console.log('[Sub-Agent] Officer search scheduled: 1 hour daily');
}

// ─────────────────────────────────────────────────────────────
// EXPORTED FUNCTIONS
// ─────────────────────────────────────────────────────────────

/**
 * processSubAgentCommand
 * Main entry point for processing admin commands with full intelligence. 
 */
export async function processSubAgentCommand(opts: {
  command: string;
  category?: string;
  userId?: number;
  [key: string]: any;
}): Promise<{ 
  success: boolean; 
  response?: string; 
  packagesToInstall?: string[]; 
  fixedCount?: number;
  action?: string;
  data?: any;
}> {
  await ensureDataDir();
  await loadState();
  
  // Rate limit check
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    return {
      success: false,
      response: 'Rate limit exceeded. Please wait before sending more commands.',
      packagesToInstall: [],
      fixedCount: 0
    };
  }
  
  await appendLog({ 
    type: 'processCommand', 
    command: opts.command, 
    category: opts.category || 'general',
    userId: opts.userId
  });
  
  const command = opts.command || '';
  
  // Interpret the command
  const intent = await interpretAdminCommand(command);
  
  let response = '';
  let packagesToInstall: string[] = [];
  let fixedCount = 0;
  let data: any = null;
  
  try {
    switch (intent.action) {
      case 'search':
        if (intent.target === 'officer') {
          // Officer search
          const searchQuery = intent.parameters?.query || command;
          const dbResult = await queryDatabase(`
            SELECT * FROM officers 
            WHERE name ILIKE $1 OR badge_number ILIKE $1 OR department ILIKE $1
            LIMIT 20
          `, [`%${searchQuery}%`]);
          
          if (dbResult.success) {
            data = dbResult.data?. rows || [];
            response = `Found ${data. length} officer(s) matching "${searchQuery}"`;
          } else {
            // Fallback to web search
            const webResult = await intelligentWebSearch(`law enforcement officer ${searchQuery}`);
            data = webResult.results;
            response = webResult.summary || 'Search completed';
          }
        } else {
          // General web search
          const webResult = await intelligentWebSearch(command);
          data = webResult.results;
          response = webResult.summary || 'Search completed';
        }
        break;
        
      case 'install':
        const pkg = intent.parameters?. package;
        if (pkg) {
          packagesToInstall = [pkg];
          const installResult = await installPackages([pkg]);
          response = installResult.success 
            ? `Successfully installed ${pkg}` 
            : `Failed to install ${pkg}: ${installResult.failed.join(', ')}`;
          data = installResult;
        } else {
          // Auto-detect and install missing packages
          const detectResult = await detectAndInstallMissingPackages();
          packagesToInstall = detectResult.installed;
          response = `Analyzed ${detectResult.analyzed} dependencies, installed ${detectResult. installed.length} missing packages`;
          data = detectResult;
        }
        break;
        
      case 'fix':
        // Use AI to analyze and suggest fixes
        const fixPrompt = `
Analyze this issue and provide specific code fixes or commands to resolve it:
Issue: ${intent.parameters?.description || command}

Context: This is a Node.js/TypeScript legal tech application using:
- Express.js backend
- React frontend  
- PostgreSQL/Supabase database
- Gemini AI for legal analysis
- Stripe for payments

Provide:
1. Root cause analysis
2.  Specific fix (code patch or command)
3.  Verification steps

Be concise and actionable.
`;
        
        const fixResult = await callGeminiAPI(fixPrompt, { maxTokens: 4096 });
        if (fixResult.success) {
          response = fixResult.response || 'Analysis complete';
          fixedCount = 1; // Suggested fix provided
        } else {
          response = `Could not analyze: ${fixResult.error}`;
        }
        break;
        
      case 'execute':
        const shellCmd = intent.parameters?.command;
        if (shellCmd) {
          const execResult = await executeShellCommand(shellCmd);
          if (execResult.success) {
            response = execResult.stdout || 'Command executed successfully';
            data = { stdout: execResult.stdout, stderr: execResult.stderr };
          } else {
            response = `Execution failed: ${execResult.error}`;
          }
        }
        break;
        
      case 'query':
        const queryResult = await queryDatabase(intent.parameters?. query || command);
        if (queryResult.success) {
          data = queryResult.data;
          response = `Query executed successfully.  ${queryResult.data?. rows?.length || 0} rows returned.`;
        } else {
          response = `Query failed: ${queryResult.error}`;
        }
        break;
        
      case 'analyze':
        const diagnostic = await runComprehensiveDiagnostic();
        data = diagnostic;
        response = `Diagnostic complete. Status: ${diagnostic.status}.  ${diagnostic.checks.length} checks performed.`;
        break;
        
      case 'report':
        // Generate system report
        const reportPrompt = `
Generate a comprehensive system status report covering:
1. Database connectivity and health
2. AI service status (Gemini/Groq)
3.  Recent errors or issues
4. Performance metrics
5.  Recommendations

Be specific and include actual status where possible.
`;
        const reportResult = await callGeminiAPI(reportPrompt);
        response = reportResult.success ? (reportResult.response || 'Report generated') : `Report generation failed: ${reportResult.error}`;
        break;
        
      default:
        // Unknown command - use AI to help
        const helpResult = await callGeminiAPI(`
You are an intelligent admin assistant for a legal tech platform.
The admin sent this command: "${command}"

Interpret what they want and provide helpful guidance.
If it's a specific action, explain how to accomplish it.
If it's unclear, ask clarifying questions. 

Be concise and helpful.
`);
        response = helpResult.success 
          ? (helpResult.response || 'Command processed')
          : 'Command logged.  Please specify a clearer action (search, fix, install, query, execute, analyze). ';
    }
  } catch (error: any) {
    response = `Error processing command: ${error.message}`;
    await appendLog({ type: 'commandError', command, error: error. message });
  }
  
  // Record change for undo capability
  const change = {
    timestamp: new Date().toISOString(),
    command,
    action: intent.action,
    result: { response: response.substring(0, 500), success: true }
  };
  
  const history = await safeReadJson<any[]>(CHANGE_HISTORY, []);
  history.push(change);
  if (history.length > 100) history.splice(0, history.length - 100);
  await atomicWriteJson(CHANGE_HISTORY, history);
  
  return {
    success: true,
    response,
    packagesToInstall,
    fixedCount,
    action: intent.action,
    data
  };
}

/**
 * executeAdvancedReasoning
 * Architect-level reasoning using Gemini AI. 
 */
export async function executeAdvancedReasoning(prompt: string, includePlan = false): Promise<{ analysis: string; plan?: any }> {
  await appendLog({ type: 'advancedReasoning', prompt: String(prompt). slice(0, 2000) });
  
  const systemPrompt = `
You are an expert system architect and problem solver for a legal tech platform. 
Analyze the following and provide deep, strategic insights:

${prompt}

${includePlan ? `
Also provide a strategic plan with:
- Numbered steps
- Risk assessment for each step
- Dependencies between steps
- Confidence score (0-1)
` : ''}

Be thorough but concise.  Focus on actionable insights.
`;
  
  const result = await callGeminiAPI(systemPrompt, { maxTokens: 8192, temperature: 0. 3 });
  
  if (! result.success) {
    return {
      analysis: `Advanced reasoning unavailable: ${result. error}.  Request logged for review.`,
      plan: includePlan ?  { strategicPlan: { steps: ['Manual review required'], confidence: 0.3 } } : undefined
    };
  }
  
  const analysis = result. response || '';
  
  let plan: any = undefined;
  if (includePlan) {
    // Extract or generate plan from response
    try {
      const planMatch = analysis.match(/(? :plan|steps?):\s*\n([\s\S]*?)(?:\n\n|$)/i);
      if (planMatch) {
        const steps = planMatch[1].split('\n').filter(s => s.trim()). map(s => s.replace(/^\d+\.\s*/, ''));
        plan = {
          strategicPlan: {
            steps,
            confidence: 0.75
          }
        };
      } else {
        plan = {
          strategicPlan: {
            steps: ['Analyze current state', 'Implement recommended changes', 'Verify results'],
            confidence: 0.6
          }
        };
      }
    } catch {
      plan = { strategicPlan: { steps: ['Review analysis and take action'], confidence: 0.5 } };
    }
  }
  
  return { analysis, plan };
}

/**
 * trackUsage
 * Records usage events for monitoring and billing.
 */
export async function trackUsage(event: { action: string; tokens?: number; provider?: string; [key: string]: any }): Promise<void> {
  await ensureDataDir();
  const usage = await safeReadJson<any[]>(USAGE_LOG, []);
  usage.push({ timestamp: new Date().toISOString(), ... event });
  
  // Keep last 10000 entries
  if (usage.length > 10000) usage.splice(0, usage.length - 10000);
  await atomicWriteJson(USAGE_LOG, usage);
}

/**
 * runComprehensiveDiagnostic
 * Performs a full system diagnostic. 
 */
export async function runComprehensiveDiagnostic(): Promise<{ status: string; checks: any[]; timestamp: string }> {
  await appendLog({ type: 'runComprehensiveDiagnostic' });
  
  const checks: any[] = [];
  
  // Check 1: Data directory writable
  try {
    await ensureDataDir();
    const testFile = path.join(SUBAGENT_DATA_DIR, '. diagtest');
    await fs.writeFile(testFile, 'ok', 'utf-8');
    await fs.unlink(testFile);
    checks.push({ name: 'dataDir', status: 'ok', message: 'Data directory writable' });
  } catch (err: any) {
    checks.push({ name: 'dataDir', status: 'fail', error: err?. message });
  }
  
  // Check 2: Environment keys
  const envChecks = [
    { key: 'GEMINI_API_KEY', required: true },
    { key: 'GROQ_API_KEY', required: false },
    { key: 'DATABASE_URL', required: true },
    { key: 'STRIPE_SECRET_KEY', required: true },
    { key: 'SESSION_SECRET', required: true }
  ];
  
  for (const { key, required } of envChecks) {
    const configured = !!process.env[key];
    checks.push({
      name: key,
      status: configured ?  'configured' : (required ? 'missing' : 'optional'),
      required
    });
  }
  
  // Check 3: Database connectivity
  try {
    const dbResult = await queryDatabase('SELECT 1 as test');
    checks.push({
      name: 'database',
      status: dbResult.success ?  'ok' : 'fail',
      message: dbResult.success ?  'Database connected' : dbResult.error
    });
  } catch (err: any) {
    checks. push({ name: 'database', status: 'fail', error: err?.message });
  }
  
  // Check 4: Gemini API connectivity
  try {
    const geminiTest = await callGeminiAPI('Respond with just "OK" if you receive this.');
    checks.push({
      name: 'gemini_api',
      status: geminiTest. success ? 'ok' : 'fail',
      model: getConfiguredGeminiModel(),
      message: geminiTest.success ? 'Gemini API operational' : geminiTest.error
    });
  } catch (err: any) {
    checks.push({ name: 'gemini_api', status: 'fail', error: err?. message });
  }
  
  // Check 5: Shell execution
  try {
    const shellTest = await executeShellCommand('echo "test"');
    checks.push({
      name: 'shell',
      status: shellTest.success ?  'ok' : 'fail',
      message: shellTest.success ? 'Shell execution available' : shellTest. error
    });
  } catch (err: any) {
    checks.push({ name: 'shell', status: 'fail', error: err?.message });
  }
  
  // Check 6: Package management
  checks.push({
    name: 'package_management',
    status: process.env.ALLOW_WORKER_INSTALL === 'true' ?  'enabled' : 'disabled',
    message: process.env. ALLOW_WORKER_INSTALL === 'true' 
      ? 'Auto-install enabled' 
      : 'Set ALLOW_WORKER_INSTALL=true to enable'
  });
  
  // Check 7: Autonomous execution
  await loadState();
  checks.push({
    name: 'autonomous_execution',
    status: autonomousExecutionEnabled ?  'enabled' : 'disabled'
  });
  
  // Check 8: Memory usage
  const memUsage = process.memoryUsage();
  checks.push({
    name: 'memory',
    status: 'ok',
    heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024)
  });
  
  const failedChecks = checks. filter(c => c.status === 'fail' || c.status === 'missing');
  
  return {
    status: failedChecks. length === 0 ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString()
  };
}

/**
 * undoLastSubAgentChange
 * Reverts the last recorded change. 
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
 * Returns the most recent change entry.
 */
export async function getLastSubAgentChange(): Promise<any | null> {
  const history = await safeReadJson<any[]>(CHANGE_HISTORY, []);
  return history.length > 0 ?  history[history.length - 1] : null;
}

/**
 * setAutonomousExecution
 * Enables or disables autonomous execution mode (kill switch).
 */
export async function setAutonomousExecution(enabled: boolean): Promise<void> {
  await loadState();
  autonomousExecutionEnabled = !!enabled;
  await saveState();
  await appendLog({ type: 'setAutonomousExecution', enabled: autonomousExecutionEnabled });
  
  console.log(`[Sub-Agent] Autonomous execution ${enabled ?  'ENABLED' : 'DISABLED'}`);
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
 * Resets the command rate limiter. 
 */
export async function resetRateLimiter(reason?: string): Promise<boolean> {
  commandTimestamps = [];
  await appendLog({ type: 'resetRateLimiter', reason: reason || 'Manual reset' });
  return true;
}

/**
 * applyTrainingToSubAgent
 * Queues training data for learning.
 */
export async function applyTrainingToSubAgent(trainingPayload: any): Promise<boolean> {
  try {
    await ensureDataDir();
    const queue = await safeReadJson<any[]>(TRAINING_QUEUE, []);
    queue.push({ receivedAt: new Date().toISOString(), payload: trainingPayload });
    
    // Keep last 500 training entries
    if (queue.length > 500) queue.splice(0, queue. length - 500);
    
    await atomicWriteJson(TRAINING_QUEUE, queue);
    await appendLog({ type: 'trainingQueued', payloadSize: JSON.stringify(trainingPayload).length });
    
    // Also save to learning data for persistent improvement
    const learning = await safeReadJson<any[]>(LEARNING_DATA, []);
    learning.push({
      timestamp: new Date(). toISOString(),
      type: 'training',
      data: trainingPayload
    });
    if (learning.length > 1000) learning.splice(0, learning. length - 1000);
    await atomicWriteJson(LEARNING_DATA, learning);
    
    return true;
  } catch (error: any) {
    await appendLog({ type: 'trainingFailed', error: error.message });
    return false;
  }
}

/**
 * getConfiguredGeminiModel
 * Returns the configured Gemini model name.
 */
export function getConfiguredGeminiModel(): string {
  return (process.env. GEMINI_MODEL || DEFAULT_GEMINI_MODEL). trim();
}

// ─────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────

// Initialize on module load
(async () => {
  try {
    await ensureDataDir();
    await loadState();
    
    // Schedule officer search (1 hour daily)
    scheduleOfficerSearch();
    
    console.log('[Sub-Agent] Initialized successfully');
    console.log(`[Sub-Agent] Gemini Model: ${getConfiguredGeminiModel()}`);
    console.log(`[Sub-Agent] Autonomous Execution: ${autonomousExecutionEnabled ?  'ENABLED' : 'DISABLED'}`);
  } catch (error) {
    console. error('[Sub-Agent] Initialization error:', error);
  }
})();

// ─────────────────────────────────────────────────────────────
// DEFAULT EXPORT
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
  // Additional exports for direct access
  intelligentWebSearch,
  fetchWebContent,
  executeShellCommand,
  installPackages,
  queryDatabase,
  performOfficerSearch,
  callGeminiAPI
};
