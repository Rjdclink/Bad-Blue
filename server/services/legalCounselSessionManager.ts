/**
 * Legal Counsel Session Manager
 * Manages conversation sessions with context persistence
 * Phase 1A: Backend infrastructure for intelligent legal consultation
 */

import { db } from '../db';
import { 
  legalCounselSessions, 
  legalCounselMessages, 
  legalCounselSuggestions,
  type LegalCounselSession,
  type LegalCounselMessage,
  type LegalCounselSuggestion,
  type InsertLegalCounselSession,
  type InsertLegalCounselMessage,
  type InsertLegalCounselSuggestion
} from '../../shared/schema';
import { eq, desc, and } from 'drizzle-orm';

/**
 * Create a new legal counsel session
 */
export async function createSession(
  userId: string,
  lawType: string,
  state: string,
  initialContext?: Record<string, any>
): Promise<LegalCounselSession> {
  const [session] = await db.insert(legalCounselSessions).values({
    userId,
    lawType,
    state,
    context: initialContext || {}
  }).returning();

  return session;
}

/**
 * Get session by ID
 */
export async function getSession(sessionId: string): Promise<LegalCounselSession | null> {
  const [session] = await db
    .select()
    .from(legalCounselSessions)
    .where(eq(legalCounselSessions.id, sessionId))
    .limit(1);

  return session || null;
}

/**
 * Get all sessions for a user
 */
export async function getUserSessions(
  userId: string,
  limit: number = 10
): Promise<LegalCounselSession[]> {
  return db
    .select()
    .from(legalCounselSessions)
    .where(eq(legalCounselSessions.userId, userId))
    .orderBy(desc(legalCounselSessions.updatedAt))
    .limit(limit);
}

/**
 * Update session context
 */
export async function updateSessionContext(
  sessionId: string,
  context: Record<string, any>
): Promise<LegalCounselSession | null> {
  const [updated] = await db
    .update(legalCounselSessions)
    .set({
      context,
      updatedAt: new Date()
    })
    .where(eq(legalCounselSessions.id, sessionId))
    .returning();

  return updated || null;
}

/**
 * Merge new context into existing session context
 */
export async function mergeSessionContext(
  sessionId: string,
  newContext: Record<string, any>
): Promise<LegalCounselSession | null> {
  const session = await getSession(sessionId);
  if (!session) return null;

  const mergedContext = {
    ...(session.context as Record<string, any>),
    ...newContext
  };

  return updateSessionContext(sessionId, mergedContext);
}

/**
 * Add a message to a session
 */
export async function addMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  options?: {
    verified?: boolean;
    verificationScore?: number;
    citations?: any[];
  }
): Promise<LegalCounselMessage> {
  const [message] = await db.insert(legalCounselMessages).values({
    sessionId,
    role,
    content,
    verified: options?.verified || false,
    verificationScore: options?.verificationScore || null,
    citations: options?.citations || []
  }).returning();

  // Update session timestamp
  await db
    .update(legalCounselSessions)
    .set({ updatedAt: new Date() })
    .where(eq(legalCounselSessions.id, sessionId));

  return message;
}

/**
 * Get messages for a session
 */
export async function getSessionMessages(
  sessionId: string,
  limit?: number
): Promise<LegalCounselMessage[]> {
  const query = db
    .select()
    .from(legalCounselMessages)
    .where(eq(legalCounselMessages.sessionId, sessionId))
    .orderBy(legalCounselMessages.timestamp);

  if (limit) {
    return query.limit(limit);
  }

  return query;
}

/**
 * Update message verification status
 */
export async function updateMessageVerification(
  messageId: string,
  verified: boolean,
  verificationScore: number,
  citations?: any[]
): Promise<LegalCounselMessage | null> {
  const [updated] = await db
    .update(legalCounselMessages)
    .set({
      verified,
      verificationScore,
      ...(citations && { citations })
    })
    .where(eq(legalCounselMessages.id, messageId))
    .returning();

  return updated || null;
}

/**
 * Add a suggestion to a session
 */
export async function addSuggestion(
  sessionId: string,
  type: 'document' | 'people-search' | 'evidence-upload' | 'next-step',
  priority: 'high' | 'medium' | 'low',
  data: Record<string, any>
): Promise<LegalCounselSuggestion> {
  const [suggestion] = await db.insert(legalCounselSuggestions).values({
    sessionId,
    type,
    priority,
    data,
    status: 'pending'
  }).returning();

  return suggestion;
}

/**
 * Get suggestions for a session
 */
export async function getSessionSuggestions(
  sessionId: string,
  status?: 'pending' | 'accepted' | 'dismissed'
): Promise<LegalCounselSuggestion[]> {
  const conditions = [eq(legalCounselSuggestions.sessionId, sessionId)];
  
  if (status) {
    conditions.push(eq(legalCounselSuggestions.status, status));
  }

  return db
    .select()
    .from(legalCounselSuggestions)
    .where(and(...conditions))
    .orderBy(desc(legalCounselSuggestions.createdAt));
}

/**
 * Update suggestion status
 */
export async function updateSuggestionStatus(
  suggestionId: string,
  status: 'pending' | 'accepted' | 'dismissed'
): Promise<LegalCounselSuggestion | null> {
  const [updated] = await db
    .update(legalCounselSuggestions)
    .set({ status })
    .where(eq(legalCounselSuggestions.id, suggestionId))
    .returning();

  return updated || null;
}

/**
 * Get full session with messages and suggestions
 */
export async function getFullSession(sessionId: string): Promise<{
  session: LegalCounselSession;
  messages: LegalCounselMessage[];
  suggestions: LegalCounselSuggestion[];
} | null> {
  const session = await getSession(sessionId);
  if (!session) return null;

  const [messages, suggestions] = await Promise.all([
    getSessionMessages(sessionId),
    getSessionSuggestions(sessionId)
  ]);

  return {
    session,
    messages,
    suggestions
  };
}

/**
 * Delete a session and all associated data
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const result = await db
    .delete(legalCounselSessions)
    .where(eq(legalCounselSessions.id, sessionId));

  return true; // Cascade delete handles messages and suggestions
}

/**
 * Get session statistics
 */
export async function getSessionStats(sessionId: string): Promise<{
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  verifiedMessageCount: number;
  suggestionCount: number;
  pendingSuggestions: number;
}> {
  const messages = await getSessionMessages(sessionId);
  const suggestions = await getSessionSuggestions(sessionId);

  return {
    messageCount: messages.length,
    userMessageCount: messages.filter(m => m.role === 'user').length,
    assistantMessageCount: messages.filter(m => m.role === 'assistant').length,
    verifiedMessageCount: messages.filter(m => m.verified).length,
    suggestionCount: suggestions.length,
    pendingSuggestions: suggestions.filter(s => s.status === 'pending').length
  };
}
