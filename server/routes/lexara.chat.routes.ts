import { runClaudeUsageScope, createClaudeUsageReporter } from '../claudeUsage';
/**
 * LEXARA API Routes
 * Conversational legal analysis + voice/persona endpoints.
 */

import express, { Request, Response } from 'express';
import { createLogger } from '../logger';
import { LEXARA_PERSONA } from '../../shared/lexaraVoicePersona';
import { LEXARA_KERNEL, mergePersonaWithKernel } from '../lexara/personaKernel';
import {
  generateLexaraConversationResponse,
  getLexaraImmediateAcknowledgement,
  type LexaraConversationMessage,
} from '../lexara/LexaraConversationOrchestrator';
import { MASTER_USER_ID } from '../masterPassword';
import { isAuthenticated } from '../auth';
import { getConfiguredHarmonyParticipants } from '../aiHarmonyModelRegistry';
import { inferLegalDocumentNeed, isBlankLegalDocumentRequest, resolveLegalDocumentType } from '../lexara/legalDocumentRegistry';
import { resolveBestLocationEstimate, type BrowserLocationSignal } from '../lexara/LexaraJurisdictionResolver';
import {
  advanceRepresentationMatter,
  findReferencedMatter,
  sanitizeRepresentationMatter,
  shouldEnrichRepresentationMatter,
  summarizeMatter,
  type RepresentationMatterState,
  type SavedMatterSummary,
} from '../lexara/LexaraRepresentationEngine';
import { readMatterBuffer } from '../lexara/LexaraMatterStorage';
import { buildDeadlineCalendar, calculateLegalDeadline, LEGAL_DEADLINE_RULES, type LegalDeadlineRuleId } from '../lexara/LegalDeadlineEngine';
import { isLexaraGenericLegalIntake, isLexaraDocumentIntakeQuestion } from '../lexara/LexaraResearchIntentRouter';

const router = express.Router();
router.use(isAuthenticated);
router.use(['/chat', '/chat/stream'], (_req, res, next) => runClaudeUsageScope(() => {
  res.once('finish', createClaudeUsageReporter());
  next();
}));
const log = createLogger('LEXARARoutes');

const MAX_CHAT_PROMPT_CHARACTERS = 8_000;
const MAX_HISTORY_MESSAGES = 16;
const MAX_HISTORY_MESSAGE_CHARACTERS = 2_500;
const MAX_CONTEXT_FIELD_CHARACTERS = 128;

function canUseClaudeOpus(req: Request): boolean {
  const accessState = String((req.user as any)?.accessState || '').trim().toLowerCase();
  return accessState === 'paid' || accessState === 'master';
}

function hasPersistentMatterAccess(req: Request): boolean {
  return String((req.user as any)?.accessState || '').trim().toLowerCase() === 'paid';
}

function authenticatedUserId(req: Request): string | undefined {
  const user = (req as any).user;
  const id = user?.id || user?.claims?.sub;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

function mergeMatterEnrichmentBase(
  currentValue: unknown,
  completedValue: unknown,
): RepresentationMatterState | null {
  const current = sanitizeRepresentationMatter(currentValue);
  const completed = sanitizeRepresentationMatter(completedValue);
  if (!current) return completed;
  if (!completed) return current;

  const mergeStrings = (older: string[], newer: string[], max: number) => {
    const seen = new Set<string>();
    return [...older, ...newer].filter(value => {
      const key = String(value || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, max);
  };
  const mergeByKey = <T>(older: T[], newer: T[], keyFor: (value: T) => string, max: number) => {
    const merged = new Map<string, T>();
    for (const value of [...older, ...newer]) {
      const key = keyFor(value);
      if (key) merged.set(key, value);
    }
    return [...merged.values()].slice(0, max);
  };

  return {
    ...completed,
    ...current,
    knownFacts: mergeStrings(completed.knownFacts, current.knownFacts, 60),
    legalIssues: mergeStrings(completed.legalIssues, current.legalIssues, 40),
    defensesAndRisks: mergeStrings(completed.defensesAndRisks, current.defensesAndRisks, 40),
    missingInformation: mergeStrings(completed.missingInformation, current.missingInformation, 40),
    evidenceNeeds: mergeStrings(completed.evidenceNeeds, current.evidenceNeeds, 40),
    parties: mergeStrings(completed.parties, current.parties, 30),
    historySummary: completed.historySummary || current.historySummary,
    courtOrAgency: current.courtOrAgency || completed.courtOrAgency,
    artifacts: mergeByKey(completed.artifacts, current.artifacts, artifact => artifact.id, 100),
    scheduleItems: mergeByKey(
      completed.scheduleItems,
      current.scheduleItems,
      item => [item.label, item.date, item.time, item.when].filter(Boolean).join('|').toLowerCase(),
      60,
    ),
    deadlines: mergeByKey(
      completed.deadlines,
      current.deadlines,
      deadline => [deadline.label, deadline.date].filter(Boolean).join('|').toLowerCase(),
      60,
    ),
    nextSteps: mergeStrings(completed.nextSteps, current.nextSteps, 20),
  };
}

let matterEnrichmentDrainPromise: Promise<void> | null = null;

async function drainDurableMatterEnrichmentJobs(): Promise<void> {
  if (matterEnrichmentDrainPromise) return matterEnrichmentDrainPromise;
  matterEnrichmentDrainPromise = (async () => {
    const { storage } = await import('../storage');
    for (let processed = 0; processed < 4; processed += 1) {
      const job = await storage.claimNextLexaraMatterEnrichmentJob();
      if (!job) break;

      const attempts = Number(job?.context?.matterEnrichmentJob?.attempts || 1);
      try {
        const userId = String(job?.userId || '').trim();
        const sessionId = String(job?.sessionId || '').trim();
        const prompt = String(job?.userPrompt || '').trim();
        const response = String(job?.lexaraResponse || '').trim();
        if (!userId || !sessionId || !prompt || !response) {
          await storage.clearLexaraMatterEnrichmentJob(String(job?.id || ''));
          continue;
        }

        const latestCompleted = await storage.getLatestCompletedLexaraMatterEnrichmentState(userId, sessionId);
        const prior = mergeMatterEnrichmentBase(job?.context?.representationMatter, latestCompleted);
        if (!shouldEnrichRepresentationMatter(prompt, response, prior)) {
          await storage.clearLexaraMatterEnrichmentJob(job.id);
          continue;
        }

        const enriched = await advanceRepresentationMatter({
          prompt,
          response,
          sessionId,
          lawType: cleanOptionalString(job?.context?.lawType),
          jurisdiction: cleanOptionalString(job?.context?.jurisdiction, 80) || prior?.jurisdiction,
          prior,
          allowClaudeOpus: false,
          skipPacketPlanning: true,
        });
        if (enriched) {
          await storage.completeLexaraMatterEnrichmentJob(job.id, enriched);
        } else {
          await storage.clearLexaraMatterEnrichmentJob(job.id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await storage.retryLexaraMatterEnrichmentJob(String(job?.id || ''), message, attempts).catch(() => undefined);
        log.warn('[LEXARA] Durable post-response matter enrichment unavailable', {
          error: message,
          sessionId: job?.sessionId || null,
          attempts,
        });
      }
    }
  })().finally(() => {
    matterEnrichmentDrainPromise = null;
  });
  return matterEnrichmentDrainPromise;
}

function scheduleMatterEnrichmentDrain(): void {
  setImmediate(() => {
    void drainDurableMatterEnrichmentJobs().catch(error => {
      log.warn('[LEXARA] Durable matter-enrichment drain failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

const matterEnrichmentRecoveryTimer = setInterval(scheduleMatterEnrichmentDrain, 60_000);
matterEnrichmentRecoveryTimer.unref?.();
const initialMatterEnrichmentRecovery = setTimeout(scheduleMatterEnrichmentDrain, 15_000);
initialMatterEnrichmentRecovery.unref?.();

async function loadRepresentationContext(
  req: Request,
  prompt: string,
  requestedSessionId: string | undefined,
  clientMatter: unknown,
): Promise<{
  persistent: boolean;
  activeMatter: RepresentationMatterState | null;
  activeSessionId: string | undefined;
  savedMatters: SavedMatterSummary[];
}> {
  if (!hasPersistentMatterAccess(req)) {
    // Trial/non-paid turns may use the live conversation, but the browser is not
    // a trusted authority for a prior matter record and no durable matter state
    // is restored for them.
    return {
      persistent: false,
      activeMatter: null,
      activeSessionId: requestedSessionId,
      savedMatters: [],
    };
  }

  const userId = authenticatedUserId(req);
  if (!userId) return { persistent: false, activeMatter: null, activeSessionId: requestedSessionId, savedMatters: [] };

  const { storage } = await import('../storage');
  const rows = await storage.getUserLexaraRestorableMatterStates(userId, 200);
  const matters = rows.flatMap((row: any) => {
    const state = sanitizeRepresentationMatter(row?.matter);
    return state ? [{ state, summary: summarizeMatter(state) }] : [];
  });
  const current = requestedSessionId
    ? matters.find((entry: any) => entry.state.sessionId === requestedSessionId)?.state || null
    : null;
  const referenced = findReferencedMatter(prompt, matters);
  const activeMatter = referenced || current || null;
  return {
    persistent: true,
    activeMatter,
    activeSessionId: activeMatter?.sessionId || requestedSessionId,
    savedMatters: matters.map((entry: any) => entry.summary),
  };
}

function cleanOptionalString(value: unknown, maxLength = MAX_CONTEXT_FIELD_CHARACTERS): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function cleanDeviceLocation(value: unknown): BrowserLocationSignal | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as any;
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const accuracyMeters = Number(input.accuracyMeters);
  const observedAt = Number(input.observedAt);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return undefined;
  if (Number.isFinite(observedAt) && Date.now() - observedAt > 30 * 60_000) return undefined;
  return {
    latitude,
    longitude,
    accuracyMeters: Number.isFinite(accuracyMeters) && accuracyMeters >= 0 ? accuracyMeters : undefined,
  };
}

function detectDocumentIntent(prompt: string, previousMessages: LexaraConversationMessage[] = []): {
  requested: boolean;
  explicit: boolean;
  inferred: boolean;
  documentType: string;
  templateMode: boolean;
  packetItem?: boolean;
} {
  const p = prompt.toLowerCase();
  if (isLexaraDocumentIntakeQuestion(prompt)) return {
    requested: false, explicit: false, inferred: false, documentType: 'Custom Document', templateMode: false,
  };
  const genericDocumentRequest = /^(?:please\s+)?(?:i\s+(?:need|want)|(?:give|provide|make|prepare|draft|create|generate|write|download|export)\b)/i.test(prompt.trim())
    && /\b(?:documents?|forms?|paperwork)\b/.test(p)
    && !/\b(?:want|need)\s+to\s+(?:know|understand|learn)\b/.test(p);
  const explicit = genericDocumentRequest || /\b(draft|prepare|create|generate|write|download|downloadable|export|pdf|docx|word document)\b/.test(p);
  const currentType = resolveLegalDocumentType(prompt);
  const candidateInference = explicit ? null : inferLegalDocumentNeed(prompt);
  const inferredType = !currentType || (candidateInference === 'Answer' && currentType === 'Complaint') ? candidateInference : null;
  const currentAction = /\b(need|want|make|give|provide|prepare|draft|create|generate|write|download|export|file|filing|submit|serve|send)\b/.test(p);
  const referentialFollowup = /\b(it|that|one|document|form|template|blank|pdf|docx)\b/.test(p);

  // Current-turn document language is authoritative. If the user refers back
  // to "that demand/document/one", resolve the referent from the complete
  // conversational history, including a document LEXARA itself just offered.
  let historyType = null as ReturnType<typeof resolveLegalDocumentType>;
  if (!currentType) {
    for (const message of [...previousMessages].reverse()) {
      historyType = resolveLegalDocumentType(message.content);
      if (historyType) break;
    }
  }

  const negated = /\b(?:do not|don't|dont|never|no longer|not trying to)\s+(?:want|need|plan|intend|file|prepare|draft|create)\b/i.test(prompt);
  const requested = !negated && (explicit || Boolean(inferredType)
    || Boolean(currentType && currentAction)
    || Boolean(!currentType && historyType && referentialFollowup
      && (currentAction || /\b(?:document|form|template|blank|pdf|docx)\b/.test(p))));

  return {
    requested,
    explicit,
    inferred: Boolean(inferredType),
    documentType: inferredType || currentType || historyType || 'Custom Document',
    templateMode: isBlankLegalDocumentRequest(prompt),
  };
}

function selectPacketDocumentIntent(prompt: string, matter: RepresentationMatterState | null | undefined): {
  requested: boolean;
  explicit: boolean;
  documentType: string;
  templateMode: boolean;
  inferred: false;
  packetItem: true;
} | null {
  if (isLexaraDocumentIntakeQuestion(prompt)
    || /\b(?:do not|don't|dont|never)\s+(?:draft|prepare|create|generate|write)\b/i.test(prompt)) return null;
  const packet = matter?.packet;
  if (!packet?.items?.length) return null;
  const text = String(prompt || '').trim().toLowerCase();
  const action = /\b(?:prepare|create|generate|complete|fill(?:\s+out)?|file|start|continue|next|make|give\s+me|provide)\b/i.test(text);
  if (!action) return null;

  const candidates = packet.items.filter(item =>
    item.status !== 'complete'
    && item.status !== 'not-applicable'
    && ['official-form', 'custom-draft', 'service-document'].includes(item.documentKind)
  );
  if (!candidates.length) return null;

  const specific = candidates.find(item => {
    const formNumber = String(item.formNumber || '').trim().toLowerCase();
    if (formNumber && text.includes(formNumber)) return true;
    const title = item.title.toLowerCase();
    if (title.length >= 6 && text.includes(title)) return true;
    const tokens = title.split(/[^a-z0-9]+/).filter(token => token.length >= 5);
    return tokens.length >= 2 && tokens.filter(token => text.includes(token)).length >= Math.min(3, tokens.length);
  });

  const packetLanguage = /\b(?:packet|paperwork|forms?|next\s+(?:form|document)|all\s+(?:the\s+)?forms?)\b/i.test(text);
  const filingObjective = /\b(?:file|start|continue)\b/i.test(text)
    && /\b(?:divorc|custod|lawsuit|case|appeal|petition|claim|probate|bankrupt|evict|hearing|proceeding)\b/i.test(text);
  const selected = specific
    || ((packetLanguage || filingObjective)
      ? candidates.find(item => item.requirement === 'mandatory') || candidates[0]
      : null);
  if (!selected) return null;

  return {
    requested: true,
    explicit: true,
    documentType: selected.title,
    templateMode: false,
    inferred: false,
    packetItem: true,
  };
}

function selectSavedArtifactRequest(
  prompt: string,
  matter: RepresentationMatterState | null | undefined,
): { id: string; title: string; fileName: string; mimeType: string; downloadUrl: string } | null {
  if (!matter?.artifacts?.length) return null;
  const normalized = String(prompt || '').toLowerCase();
  if (!/\b(?:open|download|retrieve|pull\s+up|show\s+me|get\s+me|give\s+me)\b/i.test(normalized)) return null;

  const candidates = matter.artifacts
    .filter(artifact => Boolean(artifact.storageRef))
    .map(artifact => {
      const title = String(artifact.title || '').toLowerCase();
      const fileName = String(artifact.fileName || '').toLowerCase();
      const mimeType = String(artifact.mimeType || '').toLowerCase();
      const tokens = `${title} ${fileName}`.split(/[^a-z0-9]+/).filter(token => token.length >= 4);
      let score = tokens.filter(token => normalized.includes(token)).length;
      let exact = false;
      if (title && normalized.includes(title)) {
        score += 5;
        exact = true;
      }
      if (fileName && normalized.includes(fileName)) {
        score += 8;
        exact = true;
      }
      if (/\bpdf\b/i.test(normalized) && (mimeType.includes('pdf') || fileName.endsWith('.pdf'))) score += 4;
      if (/\b(?:docx|word)\b/i.test(normalized) && (mimeType.includes('wordprocessingml') || fileName.endsWith('.docx'))) score += 4;
      return { artifact, score, exact };
    })
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score <= 0) return null;
  const tied = candidates.filter(candidate => candidate.score === best.score);
  if (tied.length > 1 && !best.exact) return null;
  if (tied.length > 1 && best.exact) {
    const exactFileMatches = tied.filter(candidate => {
      const fileName = String(candidate.artifact.fileName || '').toLowerCase();
      return fileName && normalized.includes(fileName);
    });
    if (exactFileMatches.length !== 1) return null;
    best.artifact = exactFileMatches[0].artifact;
  }

  const artifact = best.artifact;
  return {
    id: artifact.id,
    title: artifact.title,
    fileName: artifact.fileName || artifact.title,
    mimeType: artifact.mimeType || 'application/octet-stream',
    downloadUrl: `/api/lexara/matters/artifacts/${encodeURIComponent(artifact.id)}`,
  };
}

function detectFullReportRequest(prompt: string): boolean {
  return /\b(?:full|complete|comprehensive|entire)\s+(?:background\s+)?(?:report|check|investigation)\b|\b(?:run|do|generate|prepare)\s+(?:a\s+)?background\s+(?:report|check)\b/i.test(prompt);
}

function sanitizePreviousMessages(value: unknown): LexaraConversationMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-MAX_HISTORY_MESSAGES)
    .flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const role = (item as any).role;
      const content = (item as any).content;
      if (role !== 'user' && role !== 'lexara' && role !== 'assistant') return [];
      if (typeof content !== 'string' || !content.trim()) return [];
      return [{
        role,
        content: content.trim().slice(0, MAX_HISTORY_MESSAGE_CHARACTERS),
      } satisfies LexaraConversationMessage];
    });
}

async function persistConversationTurn(
  req: Request,
  data: {
    prompt: string;
    response: string;
    sessionId?: string;
    lawType?: string;
    jurisdiction?: string;
    mappedLawType?: string | null;
    backgroundDocumentContext?: string;
    behaviorMode: string;
    audioBase64?: string;
    representationMatter?: RepresentationMatterState | null;
    matterEnrichmentPending?: boolean;
  },
): Promise<{ conversationId: string | null; persistenceSuccess: boolean | null; persistenceStatus: 'saved' | 'master-ephemeral' | 'trial-ephemeral' }> {
  const user = (req as any).user;
  const userId = user?.id || user?.claims?.sub;
  const accessState = String(user?.accessState || '').trim().toLowerCase();
  if (accessState === 'trial_active') {
    return { conversationId: null, persistenceSuccess: null, persistenceStatus: 'trial-ephemeral' };
  }
  if (user?.isMasterBypass || userId === MASTER_USER_ID) {
    return { conversationId: null, persistenceSuccess: null, persistenceStatus: 'master-ephemeral' };
  }
  if (!userId) throw new Error('Authenticated Lexara user has no ID');

  const { storage } = await import('../storage');
  const conversation = await storage.createLexaraConversation({
    userId,
    sessionId: data.sessionId,
    userPrompt: data.prompt,
    lexaraResponse: data.response,
    audioGenerated: !!data.audioBase64,
    audioBase64: data.audioBase64,
    model: 'lexara-legal-orchestrator',
    context: {
      lawType: data.lawType || null,
      jurisdiction: data.jurisdiction || null,
      mappedLawType: data.mappedLawType || null,
      backgroundDocumentContext: data.backgroundDocumentContext?.slice(0, 9_000) || null,
      behaviorMode: data.behaviorMode,
      representationMatter: data.representationMatter || null,
      ...(data.matterEnrichmentPending ? {
        matterEnrichmentJob: {
          status: 'pending',
          attempts: 0,
          enqueuedAt: new Date().toISOString(),
        },
      } : {}),
    },
  });
  return { conversationId: conversation.id, persistenceSuccess: true, persistenceStatus: 'saved' };
}

/**
 * GET /api/lexara/deadlines/calendar
 * Generates a local .ics reminder for a deadline already calculated by the
 * deterministic rule engine. No external calendar account or API is required.
 */
router.get('/deadlines/calendar', (req: Request, res: Response) => {
  const ruleId = String(req.query.ruleId || '') as LegalDeadlineRuleId;
  const triggerDate = String(req.query.triggerDate || '').trim();
  if (!Object.prototype.hasOwnProperty.call(LEGAL_DEADLINE_RULES, ruleId)) {
    return res.status(400).json({ success: false, error: 'Unknown deadline rule' });
  }
  const calculation = calculateLegalDeadline(ruleId, triggerDate);
  if (!calculation) {
    return res.status(400).json({ success: false, error: 'A valid trigger date is required' });
  }
  const ics = buildDeadlineCalendar(calculation);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="legalwhat-deadline-${calculation.dueDate}.ics"`);
  return res.send(ics);
});

/**
 * GET /api/lexara/conversations/latest
 * No caller-supplied user or session ID is accepted; all reads are owner-scoped.
 */
router.get('/conversations/latest', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const user = (req as any).user;
  const userId = user?.id || user?.claims?.sub;
  if (user?.isMasterBypass || userId === MASTER_USER_ID) {
    return res.json({ success: true, conversation: null, hasSavedMatters: false });
  }
  if (!userId) return res.status(401).json({ success: false, error: 'Sign in to restore a conversation' });
  if (!hasPersistentMatterAccess(req)) {
    return res.json({ success: true, conversation: null, hasSavedMatters: false });
  }

  try {
    const lawType = cleanOptionalString(req.query.lawType);
    const { storage } = await import('../storage');
    const [conversation, matterRows] = await Promise.all([
      storage.getLatestUserLexaraSession(userId, lawType),
      storage.getUserLexaraMatterStates(userId, 200),
    ]);
    return res.json({ success: true, conversation, hasSavedMatters: matterRows.length > 0 });
  } catch (error) {
    log.error('[LEXARA] Failed to restore conversation', { error });
    return res.status(503).json({ success: false, error: 'LEXARA could not restore your last conversation' });
  }
});

/**
 * GET /api/lexara/matters/artifacts/:artifactId
 * Paid users can retrieve only artifacts referenced by their own saved matter state.
 */
router.get('/matters/artifacts/:artifactId', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!hasPersistentMatterAccess(req)) {
    return res.status(404).json({ success: false, error: 'Saved legal-matter storage is available with paid access' });
  }
  const userId = authenticatedUserId(req);
  if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

  try {
    const artifactId = String(req.params.artifactId || '').trim().slice(0, 180);
    const { storage } = await import('../storage');
    const rows = await storage.getUserLexaraMatterStates(userId, 200);
    let artifact: any = null;
    for (const row of rows) {
      const matter = sanitizeRepresentationMatter(row?.matter);
      artifact = matter?.artifacts.find(candidate => candidate.id === artifactId && candidate.storageRef) || null;
      if (artifact) break;
    }
    if (!artifact?.storageRef) {
      return res.status(404).json({ success: false, error: 'Saved matter artifact not found' });
    }

    const bytes = await readMatterBuffer(artifact.storageRef);
    const fileName = String(artifact.fileName || artifact.title || 'legalwhat-file')
      .replace(/[\r\n"]/g, '')
      .replace(/[^a-zA-Z0-9._ -]+/g, '-')
      .slice(0, 180) || 'legalwhat-file';
    res.setHeader('Content-Type', artifact.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(bytes);
  } catch (error) {
    log.error('[LEXARA] Saved matter artifact retrieval failed', { error, userId });
    return res.status(503).json({ success: false, error: 'LEXARA could not retrieve that saved file' });
  }
});

/**
 * POST /api/lexara/acknowledge
 * Sub-LLM conversational lane. Returns immediately so LEXARA can speak a
 * context-aware acknowledgement while deeper legal/Harmony analysis runs.
 */
router.post('/acknowledge', express.json(), (req: Request, res: Response) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    return res.status(400).json({ success: false, error: 'Prompt is required' });
  }
  if (prompt.length > MAX_CHAT_PROMPT_CHARACTERS) {
    return res.status(400).json({
      success: false,
      error: `Prompt must be ${MAX_CHAT_PROMPT_CHARACTERS} characters or fewer`,
    });
  }

  const analysisActive = req.body?.context?.analysisActive === true;
  const pendingAction = cleanOptionalString(req.body?.context?.pendingAction, 160);
  const acknowledgement = getLexaraImmediateAcknowledgement(prompt, { analysisActive, pendingAction });
  return res.json({
    success: true,
    acknowledgement: acknowledgement.text,
    terminal: acknowledgement.terminal,
    kind: acknowledgement.kind,
  });
});

/**
 * Full court-packet discovery can entail recursive official-form retrieval.
 * Run that ahead of the answer only when the user explicitly requests the
 * packet or all required/local forms. Ordinary conversations still create the
 * matter record immediately; durable packet planning follows after the reply.
 */
function shouldPreflightFilingPacket(prompt: string): boolean {
  if (isLexaraDocumentIntakeQuestion(prompt)
    || /\b(?:do not|don't|dont|never)\s+(?:draft|prepare|create|generate|write)\b/i.test(prompt)) return false;
  return /\b(?:complete|full|entire|all|required|mandatory|local)\b.{0,55}\b(?:forms?|packet|paperwork|filing)\b|\b(?:forms?|packet|paperwork|filing)\b.{0,55}\b(?:complete|full|entire|all|required|mandatory|local)\b/i.test(prompt);
}

/**
 * Non-persistent matter enrichment is advisory. An optional secondary provider
 * must never delay or cancel the already-completed legal answer. Persistent
 * users continue to get the existing durable post-response enrichment queue.
 */
async function recoverEphemeralMatter(
  input: Parameters<typeof advanceRepresentationMatter>[0],
  fallback: RepresentationMatterState | null,
  parentSignal: AbortSignal,
): Promise<RepresentationMatterState | null> {
  if (parentSignal.aborted) return fallback;
  const controller = new AbortController();
  const relay = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener('abort', relay, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      advanceRepresentationMatter({ ...input, skipPacketPlanning: true, signal: controller.signal })
        .catch(error => {
          log.warn('[LEXARA] Optional live matter update failed; preserving completed answer', {
            message: error instanceof Error ? error.message : String(error),
          });
          return fallback;
        }),
      new Promise<RepresentationMatterState | null>(resolve => {
        timer = setTimeout(() => {
          controller.abort(new Error('Optional live matter update exceeded time budget'));
          resolve(fallback);
        }, 1_500);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal.removeEventListener('abort', relay);
  }
}

/**
 * POST /api/lexara/chat/stream
 * Server-Sent Events transport for progressive Lexara research.
 */
router.post('/chat/stream', express.json(), async (req: Request, res: Response) => {
  const body = req.body || {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > MAX_CHAT_PROMPT_CHARACTERS) {
    return res.status(400).json({ success: false, error: 'Valid prompt is required' });
  }
  const rawContext = body.context && typeof body.context === 'object' ? body.context : {};
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': keepalive\n\n');
  }, 15_000);
  req.once('aborted', () => controller.abort());
  res.once('close', () => controller.abort());
  try {
    send('started', { status: 'researching' });
    const previousMessages = sanitizePreviousMessages((rawContext as any).previousMessages);
    let documentIntent = detectDocumentIntent(prompt, previousMessages);
    const requestedSessionId = cleanOptionalString((rawContext as any).sessionId, 128);
    const genericLegalIntake = isLexaraGenericLegalIntake(prompt);
    const representationContext = genericLegalIntake
      ? {
          persistent: hasPersistentMatterAccess(req),
          activeMatter: null,
          activeSessionId: requestedSessionId,
          savedMatters: [] as SavedMatterSummary[],
        }
      : await loadRepresentationContext(
          req,
          prompt,
          requestedSessionId,
          (rawContext as any).representationMatter,
        );
    const activeSessionId = representationContext.activeSessionId || requestedSessionId || `lexara-${Date.now()}`;
    const effectivePreviousMessages = representationContext.activeMatter
      && requestedSessionId
      && activeSessionId !== requestedSessionId
      ? []
      : previousMessages;
    documentIntent = detectDocumentIntent(prompt, effectivePreviousMessages);
    const explicitJurisdiction = cleanOptionalString((rawContext as any).jurisdiction, 80);
    const locationState = genericLegalIntake || explicitJurisdiction ? null : await resolveBestLocationEstimate(
      String(req.headers['x-real-ip'] || req.headers['cf-connecting-ip'] || req.ip || ''),
      cleanDeviceLocation((rawContext as any).deviceLocation),
    );
    const preRepresentationMatter = genericLegalIntake
      ? representationContext.activeMatter
      : await advanceRepresentationMatter({
          prompt,
          response: '',
          sessionId: activeSessionId,
          lawType: cleanOptionalString((rawContext as any).lawType),
          jurisdiction: explicitJurisdiction || representationContext.activeMatter?.jurisdiction,
          prior: representationContext.activeMatter,
          allowClaudeOpus: canUseClaudeOpus(req),
          skipPacketPlanning: !shouldPreflightFilingPacket(prompt),
          signal: controller.signal,
        }).catch(error => {
          log.warn('[LEXARA] Matter preflight unavailable; continuing legal answer', {
            message: error instanceof Error ? error.message : String(error),
          });
          return representationContext.activeMatter;
        });
    const savedArtifact = selectSavedArtifactRequest(prompt, preRepresentationMatter || representationContext.activeMatter);
    const packetDocumentIntent = savedArtifact ? null : selectPacketDocumentIntent(prompt, preRepresentationMatter);
    if (savedArtifact) {
      documentIntent = { requested: false, explicit: true, inferred: false, documentType: 'Custom Document', templateMode: false };
    } else if (packetDocumentIntent) {
      documentIntent = packetDocumentIntent;
    }
    const result = await generateLexaraConversationResponse(prompt, {
      previousMessages: effectivePreviousMessages,
      lawType: cleanOptionalString((rawContext as any).lawType),
      lawTypeName: cleanOptionalString((rawContext as any).lawTypeName, 160),
      jurisdiction: explicitJurisdiction,
      backgroundJurisdiction: locationState?.state,
      backgroundLocality: locationState?.locality,
      backgroundArea: locationState?.area,
      backgroundLocationConfidence: locationState?.confidence,
      backgroundLocationSource: locationState?.provider,
      behaviorMode: (rawContext as any).behaviorMode === 'personable' ? 'personable' : 'professional',
      sessionId: activeSessionId,
      representationMatter: preRepresentationMatter || representationContext.activeMatter,
      savedMatters: representationContext.savedMatters,
      allowClaudeOpus: canUseClaudeOpus(req),
      signal: controller.signal,
      onResearchProgress: event => send('research', {
        type: event.type,
        pass: event.pass,
        ...(event.type === 'endpoint' ? { endpoint: event.endpoint } : {}),
      }),
      onTextDelta: delta => send('answer-delta', { delta }),
      // A document turn must never enter realtime TTS. Flux can emit audio as
      // soon as Speak text arrives, so gate speech before the first chunk.
      onSpeechChunk: documentIntent.requested && !documentIntent.inferred
        ? undefined
        : chunk => send('speech-chunk', { chunk }),
    });

    const reasoningDocumentIntent = detectDocumentIntent(result.text, [
      ...effectivePreviousMessages,
      { role: 'user', content: prompt },
    ]);
    if (documentIntent.requested && documentIntent.documentType === 'Custom Document' && reasoningDocumentIntent.requested && reasoningDocumentIntent.documentType !== 'Custom Document') {
      documentIntent.documentType = reasoningDocumentIntent.documentType;
    }
    if (!savedArtifact && !documentIntent.requested && !isLexaraDocumentIntakeQuestion(prompt) && !/\b(?:do not|don't|dont|never)\s+(?:draft|prepare|create|generate|write)\b/i.test(prompt) && reasoningDocumentIntent.requested && reasoningDocumentIntent.explicit && reasoningDocumentIntent.documentType !== 'Custom Document') {
      documentIntent.requested = true;
      if (documentIntent.documentType === 'Custom Document') {
        documentIntent.documentType = reasoningDocumentIntent.documentType;
      }
    }
    const response = result.text;
    const baseRepresentationMatter = preRepresentationMatter || representationContext.activeMatter;
    const durableEnrichmentNeeded = Boolean(
      representationContext.persistent
      && !isLexaraDocumentIntakeQuestion(prompt)
      && baseRepresentationMatter
      && result.backgroundOnly !== true
      && shouldEnrichRepresentationMatter(prompt, response, baseRepresentationMatter)
    );
    const representationMatter = !representationContext.persistent && !genericLegalIntake && !isLexaraDocumentIntakeQuestion(prompt) && result.backgroundOnly !== true
      ? await recoverEphemeralMatter({
          prompt,
          response,
          sessionId: activeSessionId,
          lawType: cleanOptionalString((rawContext as any).lawType),
          jurisdiction: result.jurisdiction || explicitJurisdiction,
          prior: baseRepresentationMatter,
          allowClaudeOpus: canUseClaudeOpus(req),
          signal: controller.signal,
        }, baseRepresentationMatter, controller.signal)
      : baseRepresentationMatter;
    let persistence: Awaited<ReturnType<typeof persistConversationTurn>> | { conversationId: null; persistenceSuccess: false; persistenceStatus: 'save-failed' };
    try {
      persistence = await persistConversationTurn(req, {
        prompt,
        response,
        sessionId: activeSessionId,
        lawType: cleanOptionalString((rawContext as any).lawType),
        jurisdiction: result.jurisdiction || cleanOptionalString((rawContext as any).jurisdiction, 80),
        mappedLawType: result.mappedLawType,
        backgroundDocumentContext: result.backgroundDocumentContext,
        behaviorMode: (rawContext as any).behaviorMode === 'personable' ? 'personable' : 'professional',
        representationMatter,
        matterEnrichmentPending: durableEnrichmentNeeded,
      });
    } catch (dbError) {
      log.error('[LEXARA] Legal answer complete but conversation save failed', {
        message: dbError instanceof Error ? dbError.message : String(dbError),
      });
      persistence = { conversationId: null, persistenceSuccess: false, persistenceStatus: 'save-failed' };
    }
    if (durableEnrichmentNeeded && persistence.persistenceStatus === 'saved') {
      res.once('finish', scheduleMatterEnrichmentDrain);
    }
    send('complete', {
      success: true,
      response,
      ...persistence,
      jurisdiction: result.jurisdiction,
      mappedLawType: result.mappedLawType,
      backgroundDocumentContext: result.backgroundDocumentContext,
      documentIntent,
      representationMatter,
      matterSessionId: activeSessionId,
      savedMatters: representationContext.savedMatters,
      savedArtifact,
      deadline: result.deadline,
      deadlineCalendarUrl: result.deadline
        ? `/api/lexara/deadlines/calendar?ruleId=${encodeURIComponent(result.deadline.rule.id)}&triggerDate=${encodeURIComponent(result.deadline.triggerDate)}`
        : undefined,
    });
  } catch (error) {
    log.error('[LEXARA] Stream turn failed', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (!controller.signal.aborted) send('error', {
      success: false, jobCompleted: false, jobStatus: 'failed',
      error: error instanceof Error ? error.message : 'LEXARA research failed',
    });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

/**
 * POST /api/lexara/chat
 * Canonical conversational endpoint for LEXARA Live.
 *
 * The server owns the legal/system prompt. Client-provided system prompts are
 * intentionally ignored so an untrusted browser cannot replace legal accuracy,
 * citation, or persona constraints.
 */
router.post('/chat', express.json(), async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const rawContext = body.context && typeof body.context === 'object' ? body.context : {};
    const includeAudio = typeof body.includeAudio === 'boolean' ? body.includeAudio : true;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required',
      });
    }

    if (prompt.length > MAX_CHAT_PROMPT_CHARACTERS) {
      return res.status(400).json({
        success: false,
        error: `Prompt must be ${MAX_CHAT_PROMPT_CHARACTERS} characters or fewer`,
      });
    }

    const previousMessages = sanitizePreviousMessages((rawContext as any).previousMessages);
    const lawType = cleanOptionalString((rawContext as any).lawType);
    const lawTypeName = cleanOptionalString((rawContext as any).lawTypeName, 160);
    const genericLegalIntake = isLexaraGenericLegalIntake(prompt);
    const explicitJurisdiction = cleanOptionalString((rawContext as any).jurisdiction, 80);
    const locationState = genericLegalIntake || explicitJurisdiction ? null : await resolveBestLocationEstimate(
      String(req.headers['x-real-ip'] || req.headers['cf-connecting-ip'] || req.ip || ''),
      cleanDeviceLocation((rawContext as any).deviceLocation),
    );
    const jurisdiction = explicitJurisdiction;
    const behaviorMode = (rawContext as any).behaviorMode === 'personable' ? 'personable' : 'professional';
    const requestedSessionId = cleanOptionalString((rawContext as any).sessionId, 128);
    const representationContext = genericLegalIntake
      ? {
          persistent: hasPersistentMatterAccess(req),
          activeMatter: null,
          activeSessionId: requestedSessionId,
          savedMatters: [] as SavedMatterSummary[],
        }
      : await loadRepresentationContext(
          req,
          prompt,
          requestedSessionId,
          (rawContext as any).representationMatter,
        );
    const sessionId = representationContext.activeSessionId || requestedSessionId || `lexara-${Date.now()}`;
    const effectivePreviousMessages = representationContext.activeMatter
      && requestedSessionId
      && sessionId !== requestedSessionId
      ? []
      : previousMessages;
    const preRepresentationMatter = genericLegalIntake
      ? representationContext.activeMatter
      : await advanceRepresentationMatter({
          prompt,
          response: '',
          sessionId,
          lawType,
          jurisdiction: explicitJurisdiction || representationContext.activeMatter?.jurisdiction,
          prior: representationContext.activeMatter,
          allowClaudeOpus: canUseClaudeOpus(req),
          skipPacketPlanning: !shouldPreflightFilingPacket(prompt),
        });
    let documentIntent = detectDocumentIntent(prompt, effectivePreviousMessages);
    const savedArtifact = selectSavedArtifactRequest(prompt, preRepresentationMatter || representationContext.activeMatter);
    const packetDocumentIntent = savedArtifact ? null : selectPacketDocumentIntent(prompt, preRepresentationMatter);
    if (savedArtifact) {
      documentIntent = { requested: false, explicit: true, inferred: false, documentType: 'Custom Document', templateMode: false };
    } else if (packetDocumentIntent) {
      documentIntent = packetDocumentIntent;
    }

    log.info('[LEXARA] Conversational legal turn received', {
      promptLength: prompt.length,
      previousMessages: previousMessages.length,
      lawType,
      jurisdiction,
      includeAudio,
    });

    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    const abortIfDisconnected = () => {
      if (!res.writableEnded) requestController.abort();
    };
    req.once('aborted', abortRequest);
    res.once('close', abortIfDisconnected);

    let conversationResult: Awaited<ReturnType<typeof generateLexaraConversationResponse>>;
    try {
      conversationResult = await generateLexaraConversationResponse(prompt, {
        previousMessages: effectivePreviousMessages,
        lawType,
        lawTypeName,
        jurisdiction: explicitJurisdiction,
        backgroundJurisdiction: locationState?.state,
        backgroundLocality: locationState?.locality,
        backgroundArea: locationState?.area,
        backgroundLocationConfidence: locationState?.confidence,
        backgroundLocationSource: locationState?.provider,
        behaviorMode,
        sessionId,
        representationMatter: preRepresentationMatter || representationContext.activeMatter,
        savedMatters: representationContext.savedMatters,
        allowClaudeOpus: canUseClaudeOpus(req),
        signal: requestController.signal,
      });
    } finally {
      req.off('aborted', abortRequest);
      res.off('close', abortIfDisconnected);
    }


    const responseText = conversationResult.text;
    const representationMatter = genericLegalIntake || isLexaraDocumentIntakeQuestion(prompt) || conversationResult.backgroundOnly === true
      ? preRepresentationMatter || representationContext.activeMatter
      : await recoverEphemeralMatter({
          prompt,
          response: responseText,
          sessionId,
          lawType,
          jurisdiction: conversationResult.jurisdiction || jurisdiction,
          prior: preRepresentationMatter || representationContext.activeMatter,
          allowClaudeOpus: canUseClaudeOpus(req),
          signal: requestController.signal,
        }, preRepresentationMatter || representationContext.activeMatter, requestController.signal);
    const model = 'lexara-legal-orchestrator';

    // Preserve the deterministic explicit-request fast path, but let LEXARA's
    // completed legal reasoning bridge an implicit document need into the
    // existing document workflow. This does not add another model call.
    const reasoningDocumentIntent = detectDocumentIntent(responseText, [
      ...effectivePreviousMessages,
      { role: 'user', content: prompt },
    ]);
    if (documentIntent.requested && documentIntent.documentType === 'Custom Document' && reasoningDocumentIntent.requested && reasoningDocumentIntent.documentType !== 'Custom Document') {
      documentIntent.documentType = reasoningDocumentIntent.documentType;
    }
    if (!savedArtifact && !documentIntent.requested && !isLexaraDocumentIntakeQuestion(prompt) && !/\b(?:do not|don't|dont|never)\s+(?:draft|prepare|create|generate|write)\b/i.test(prompt) && reasoningDocumentIntent.requested && reasoningDocumentIntent.explicit && reasoningDocumentIntent.documentType !== 'Custom Document') {
      documentIntent.requested = true;
      if (documentIntent.documentType === 'Custom Document') {
        documentIntent.documentType = reasoningDocumentIntent.documentType;
      }
    }

    log.info('[LEXARA] Conversational legal response generated', {
      responseLength: responseText.length,
      jurisdiction: conversationResult.jurisdiction,
      mappedLawType: conversationResult.mappedLawType,
    });

    let audioData: {
      audioUrl?: string;
      audioBase64?: string;
      mimeType?: string;
      durationMs?: number;
      provider?: string;
      model?: string;
      voiceId?: string | null;
    } | null = null;

    // Backward-compatible path for callers that still request bundled audio.
    // LEXARA Live sends includeAudio:false and starts TTS immediately after text
    // arrives, which avoids serializing legal reasoning behind audio generation.
    if (includeAudio) {
      try {
        const { synthesizeLexaraSpeechWithFailover } = await import('../lexara/LexaraTTSMesh');
        const ttsResult = await synthesizeLexaraSpeechWithFailover(responseText);

        audioData = {
          audioBase64: ttsResult.audioData.toString('base64'),
          mimeType: ttsResult.mimeType,
          provider: ttsResult.provider,
          model: ttsResult.model,
          voiceId: ttsResult.voiceId,
        };
      } catch (ttsError) {
        log.warn('[LEXARA] Bundled adaptive TTS unavailable; returning text', {
          error: ttsError instanceof Error ? ttsError.message : 'Unknown error',
        });
      }
    }

    // A successful reply remains usable even if storage is temporarily unavailable.
    let persistence: Awaited<ReturnType<typeof persistConversationTurn>> | { conversationId: null; persistenceSuccess: false; persistenceStatus: 'save-failed' };
    try {
      persistence = await persistConversationTurn(req, {
        prompt,
        response: responseText,
        sessionId,
        lawType,
        jurisdiction: conversationResult.jurisdiction || jurisdiction,
        mappedLawType: conversationResult.mappedLawType,
        backgroundDocumentContext: conversationResult.backgroundDocumentContext,
        behaviorMode,
        audioBase64: audioData?.audioBase64,
        representationMatter,
      });
    } catch (dbError) {
      log.error('[LEXARA] Conversational answer complete but save failed', { message: dbError instanceof Error ? dbError.message : String(dbError) });
      persistence = { conversationId: null, persistenceSuccess: false, persistenceStatus: 'save-failed' };
    }

    return res.json({
      success: true,
      response: responseText,
      model,
      audio: audioData,
      jurisdiction: conversationResult.jurisdiction,
      mappedLawType: conversationResult.mappedLawType,
      backgroundDocumentContext: conversationResult.backgroundDocumentContext,
      ...persistence,
      documentIntent,
      representationMatter,
      matterSessionId: sessionId,
      savedMatters: representationContext.savedMatters,
      savedArtifact,
      deadline: conversationResult.deadline,
      deadlineCalendarUrl: conversationResult.deadline
        ? `/api/lexara/deadlines/calendar?ruleId=${encodeURIComponent(conversationResult.deadline.rule.id)}&triggerDate=${encodeURIComponent(conversationResult.deadline.triggerDate)}`
        : undefined,
    });
  } catch (error) {
    log.error('[LEXARA] Chat endpoint error', { error });
    return res.status(500).json({
      success: false,
      error: 'LEXARA could not complete the legal analysis for this turn',
      jobCompleted: false,
      jobStatus: 'failed',
    });
  }
});

router.get('/status', (_req: Request, res: Response) => {
  const configuredHarmonyParticipants = getConfiguredHarmonyParticipants().length;
  res.json({
    success: true,
    status: 'active',
    harmony: {
      configuredParticipants: configuredHarmonyParticipants,
      expectedParticipants: 17,
      fullHarmonyConfigured: configuredHarmonyParticipants === 17,
      routing: 'capability-first',
    },
    kernel: {
      name: LEXARA_KERNEL.identity.name,
      age: LEXARA_KERNEL.identity.age,
      style: LEXARA_KERNEL.identity.style,
      speech: LEXARA_KERNEL.speech,
    },
    persona: {
      name: LEXARA_PERSONA.name,
      traits: LEXARA_PERSONA.traits,
    },
    capabilities: {
      voice: true,
      video: true,
      adaptiveBehavior: true,
      conversationalLegalOrchestrator: true,
      modes: ['personable', 'professional'],
      personaLocked: true,
    },
  });
});

router.post('/voice', express.json(), async (req: Request, res: Response) => {
  try {
    const { text, context, emotionalState } = req.body;
    req.body.persona = mergePersonaWithKernel(req.body.persona);

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Text is required for voice synthesis',
      });
    }

    log.info('[LEXARA] Voice synthesis request', {
      textLength: text.length,
      context,
      emotionalState,
      personaTimbre: LEXARA_KERNEL.speech.timbre,
    });

    return res.json({
      success: true,
      text,
      voiceConfig: {
        timbre: LEXARA_KERNEL.speech.timbre,
        texture: LEXARA_KERNEL.speech.texture,
        pacing: LEXARA_KERNEL.speech.pacing,
        intonation: LEXARA_KERNEL.speech.intonation,
      },
      persona: LEXARA_KERNEL,
      emotionalState: emotionalState || 'neutral',
    });
  } catch (error) {
    log.error('[LEXARA] Voice synthesis error', { error });
    return res.status(500).json({
      success: false,
      error: 'Voice synthesis failed',
    });
  }
});

router.post('/analyze-signals', express.json(), async (req: Request, res: Response) => {
  try {
    const { text, voiceMetrics, bodyLanguage } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Text is required',
      });
    }

    const { analyzeUserSignals } = await import('../../shared/lexaraVoicePersona');
    const analysis = analyzeUserSignals(text, voiceMetrics, bodyLanguage);

    return res.json({
      success: true,
      analysis,
    });
  } catch (error) {
    log.error('[LEXARA] Signal analysis error', { error });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
