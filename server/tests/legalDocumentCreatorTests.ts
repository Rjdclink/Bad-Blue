/**
 * Legal Document Creator Test Suite
 * 
 * Tests for document type inference, session management, and model orchestration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('./aiProvider', () => ({
  generateUserText: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      documentType: 'demand_letter',
      confidence: 0.9,
      reasoning: 'Test reasoning',
      followUpQuestions: [],
    }),
    provider: 'gemini',
    tokensUsed: 100,
    latencyMs: 500,
  }),
  TaskPriority: {
    CRITICAL_USER: 100,
    HIGH_USER: 80,
    MEDIUM_BACKGROUND: 50,
    LOW_BACKGROUND: 30,
  },
  recordUsage: vi.fn(),
  AIProvider: {
    GEMINI: 'gemini',
    GROQ: 'groq',
  },
}));

vi.mock('./emailService', () => ({
  sendUserEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock('./platformConfig', () => ({
  getBaseURL: vi.fn().mockReturnValue('http://localhost:5000'),
}));

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: 'cs_test_123',
          url: 'https://checkout.stripe.com/test',
        }),
      },
    },
    webhooks: {
      constructEvent: vi.fn().mockImplementation(() => ({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            metadata: {
              type: 'legal_document_creator',
              sessionId: 'test-session-id',
            },
          },
        },
      })),
    },
  })),
}));

// Import after mocks
import {
  initLegalSession,
  continueLegalSession,
  generateDraft,
  finalizeDraft,
  getSession,
  getDraftPreview,
  __testing,
} from './legalDocumentCreator';

describe('Legal Document Creator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear session store
    __testing.sessions.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initLegalSession', () => {
    it('should create a new session with a unique ID', () => {
      const result = initLegalSession();
      
      expect(result.sessionId).toBeTruthy();
      expect(result.sessionId.length).toBe(32); // 16 bytes hex = 32 chars
      expect(result.questions.length).toBeGreaterThan(0);
      expect(result.message).toBeTruthy();
    });

    it('should return initial questionnaire questions', () => {
      const result = initLegalSession();
      
      // Should have the 5 initial questions
      expect(result.questions.length).toBe(5);
      expect(result.questions.map(q => q.id)).toContain('document_purpose');
      expect(result.questions.map(q => q.id)).toContain('parties_involved');
      expect(result.questions.map(q => q.id)).toContain('state');
      expect(result.questions.map(q => q.id)).toContain('key_facts');
      expect(result.questions.map(q => q.id)).toContain('desired_outcome');
    });

    it('should store the session in memory', () => {
      const result = initLegalSession('user-123');
      
      const session = __testing.sessions.get(result.sessionId);
      expect(session).toBeTruthy();
      expect(session?.userId).toBe('user-123');
      expect(session?.status).toBe('questionnaire');
    });
  });

  describe('continueLegalSession', () => {
    it('should throw error for non-existent session', async () => {
      await expect(continueLegalSession('non-existent', {})).rejects.toThrow('Session not found');
    });

    it('should store answers in the session', async () => {
      const { sessionId } = initLegalSession();
      
      await continueLegalSession(sessionId, {
        document_purpose: 'Request payment',
        parties_involved: 'John Doe, Jane Smith',
      });
      
      const session = __testing.sessions.get(sessionId);
      expect(session?.answers.document_purpose).toBe('Request payment');
      expect(session?.answers.parties_involved).toBe('John Doe, Jane Smith');
    });

    it('should return remaining required questions if not all answered', async () => {
      const { sessionId } = initLegalSession();
      
      const result = await continueLegalSession(sessionId, {
        document_purpose: 'Request payment',
        // Missing other required fields
      });
      
      expect(result.readyToDraft).toBe(false);
      expect(result.nextQuestions.length).toBeGreaterThan(0);
    });

    it('should set readyToDraft when all required fields are answered', async () => {
      const { sessionId } = initLegalSession();
      
      const result = await continueLegalSession(sessionId, {
        document_purpose: 'Request payment for unpaid invoices',
        parties_involved: 'John Doe (creditor), Jane Smith (debtor)',
        state: 'California',
        key_facts: 'Invoice #123 for $5000 is 60 days overdue',
        desired_outcome: 'Full payment within 30 days',
      });
      
      expect(result.readyToDraft).toBe(true);
      expect(result.inferredDocumentType).toBe('demand_letter');
    });
  });

  describe('generateDraft', () => {
    it('should throw error for non-existent session', async () => {
      await expect(generateDraft('non-existent')).rejects.toThrow('Session not found');
    });

    it('should generate a draft document', async () => {
      const { sessionId } = initLegalSession();
      
      // Set up the session with answers
      await continueLegalSession(sessionId, {
        document_purpose: 'Request payment',
        parties_involved: 'John Doe, Jane Smith',
        state: 'California',
        key_facts: 'Invoice overdue',
        desired_outcome: 'Get paid',
      });
      
      // Mock generateUserText to return a draft
      vi.mocked((await import('./aiProvider')).generateUserText).mockResolvedValueOnce({
        content: 'DEMAND LETTER\n\nDear Jane Smith...',
        provider: 'gemini' as any,
        tokensUsed: 500,
        latencyMs: 1000,
      });
      
      const result = await generateDraft(sessionId);
      
      expect(result.success).toBe(true);
      expect(result.previewId).toBe(sessionId);
      expect(result.documentPreview).toBeTruthy();
    });

    it('should update session status to preview after draft generation', async () => {
      const { sessionId } = initLegalSession();
      
      await continueLegalSession(sessionId, {
        document_purpose: 'Request payment',
        parties_involved: 'John Doe, Jane Smith',
        state: 'California',
        key_facts: 'Invoice overdue',
        desired_outcome: 'Get paid',
      });
      
      vi.mocked((await import('./aiProvider')).generateUserText).mockResolvedValue({
        content: 'DEMAND LETTER\n\nDear Jane Smith...',
        provider: 'gemini' as any,
        tokensUsed: 500,
        latencyMs: 1000,
      });
      
      await generateDraft(sessionId);
      
      const session = __testing.sessions.get(sessionId);
      expect(session?.status).toBe('preview');
    });
  });

  describe('finalizeDraft', () => {
    it('should throw error for non-existent session', () => {
      expect(() => finalizeDraft('non-existent')).toThrow('Session not found');
    });

    it('should copy draft to final document', async () => {
      const { sessionId } = initLegalSession();
      
      await continueLegalSession(sessionId, {
        document_purpose: 'Request payment',
        parties_involved: 'John Doe, Jane Smith',
        state: 'California',
        key_facts: 'Invoice overdue',
        desired_outcome: 'Get paid',
      });
      
      // Set session to preview state with a draft
      const session = __testing.sessions.get(sessionId);
      if (session) {
        session.status = 'preview';
        session.draftDocument = 'Test document content';
      }
      
      const result = finalizeDraft(sessionId);
      
      expect(result.previewId).toBe(sessionId);
      expect(result.status).toBe('ready_for_payment');
      expect(session?.finalDocument).toBe('Test document content');
    });
  });

  describe('getSession', () => {
    it('should return null for non-existent session', () => {
      const result = getSession('non-existent');
      expect(result).toBeNull();
    });

    it('should return the session object', () => {
      const { sessionId } = initLegalSession('test-user');
      
      const session = getSession(sessionId);
      expect(session).toBeTruthy();
      expect(session?.id).toBe(sessionId);
      expect(session?.userId).toBe('test-user');
    });
  });

  describe('getDraftPreview', () => {
    it('should return null for non-existent session', () => {
      const result = getDraftPreview('non-existent');
      expect(result).toBeNull();
    });

    it('should return draft with canCopy set to false', () => {
      const { sessionId } = initLegalSession();
      
      // Set up draft
      const session = __testing.sessions.get(sessionId);
      if (session) {
        session.draftDocument = 'Test document';
      }
      
      const result = getDraftPreview(sessionId);
      
      expect(result).toBeTruthy();
      expect(result?.document).toBe('Test document');
      expect(result?.canCopy).toBe(false);
    });
  });

  describe('Helper Functions', () => {
    describe('formatDocumentType', () => {
      it('should format document types correctly', () => {
        expect(__testing.formatDocumentType('demand_letter')).toBe('Demand Letter');
        expect(__testing.formatDocumentType('cease_and_desist')).toBe('Cease and Desist Letter');
        expect(__testing.formatDocumentType('power_of_attorney')).toBe('Power of Attorney');
        expect(__testing.formatDocumentType('unknown_type')).toBe('Unknown Type');
      });
    });

    describe('estimateTokens', () => {
      it('should estimate tokens from text length', () => {
        // ~4 chars per token
        expect(__testing.estimateTokens('Hello World!')).toBe(3); // 12 chars / 4 = 3
        expect(__testing.estimateTokens('This is a longer test string')).toBe(8); // 28 chars / 4 = 7
      });
    });
  });
});

describe('Document Type Inference', () => {
  it('should correctly identify demand letter requests', async () => {
    // The mock returns demand_letter by default
    const { sessionId } = initLegalSession();
    
    const result = await continueLegalSession(sessionId, {
      document_purpose: 'I need to request payment from someone who owes me money',
      parties_involved: 'Me (creditor), Debtor Company (owes $10,000)',
      state: 'New York',
      key_facts: 'Invoice dated 3 months ago, no payment received',
      desired_outcome: 'Full payment within 30 days',
    });
    
    expect(result.inferredDocumentType).toBe('demand_letter');
  });
});

describe('Integration Tests', () => {
  describe('Complete User Flow', () => {
    it('should handle the complete flow from init to preview', async () => {
      // 1. Initialize session
      const initResult = initLegalSession('user-456');
      expect(initResult.sessionId).toBeTruthy();
      expect(initResult.questions.length).toBe(5);
      
      // 2. Submit all required answers
      const continueResult = await continueLegalSession(initResult.sessionId, {
        document_purpose: 'Send cease and desist for harassment',
        parties_involved: 'John Doe (victim), Harassing Party (perpetrator)',
        state: 'Texas',
        key_facts: 'Multiple unwanted contacts over 2 months',
        desired_outcome: 'Stop all contact immediately',
      });
      
      expect(continueResult.readyToDraft).toBe(true);
      
      // 3. Verify session state
      const session = getSession(initResult.sessionId);
      expect(session?.answers.document_purpose).toBe('Send cease and desist for harassment');
      expect(session?.jurisdiction).toBe('Texas');
    });
  });
});
