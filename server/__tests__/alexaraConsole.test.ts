/**
 * Tests for Alexara Console
 * 
 * Comprehensive tests for the primary interface to the 4JI brain system
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  AlexaraConsole,
  initializeAlexaraConsole,
  shutdownAlexaraConsole,
  COMMAND_TAGS,
  OUTPUT_SOURCES,
  ContextAnalysisModule,
  KnowledgeRetrievalModule,
  OutputAssemblyModule,
  ErrorProofingModule,
  OptimizationModule,
  CrawlerManager,
  AuthenticationManager
} from '../alexaraConsole';

describe('AlexaraConsole', () => {
  let console: AlexaraConsole;
  let sessionId: string;
  let token: string;

  beforeAll(async () => {
    console = await initializeAlexaraConsole({
      requireAuthentication: true,
      enableVoiceInput: false,
      enableVoiceOutput: false
    });
    
    // Connect brains
    console.connectBrains(true, true);
    
    // Authenticate
    const session = console.getAuthManager().authenticate('admin', 'admin123', ['crawler_access']);
    if (session) {
      sessionId = session.sessionId;
      token = session.token;
    }
  });

  afterAll(async () => {
    await shutdownAlexaraConsole();
  });

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      expect(console.isInitialized()).toBe(true);
    });
  });

  describe('Command Parsing', () => {
    it('should parse [QUERY] commands', () => {
      const result = console.parseInput('[QUERY] What is contract law?');
      expect(result).not.toBeNull();
      expect(result?.tag).toBe(COMMAND_TAGS.QUERY);
      expect(result?.content).toBe('What is contract law?');
    });

    it('should parse [ANALYZE] commands', () => {
      const result = console.parseInput('[ANALYZE] Case study of Smith v Jones');
      expect(result).not.toBeNull();
      expect(result?.tag).toBe(COMMAND_TAGS.ANALYZE);
      expect(result?.content).toBe('Case study of Smith v Jones');
    });

    it('should parse [CRAWL] commands', () => {
      const result = console.parseInput('[CRAWL] Search for recent case law');
      expect(result).not.toBeNull();
      expect(result?.tag).toBe(COMMAND_TAGS.CRAWL);
    });

    it('should parse [SIMULATE] commands', () => {
      const result = console.parseInput('[SIMULATE] Outcome of filing motion');
      expect(result).not.toBeNull();
      expect(result?.tag).toBe(COMMAND_TAGS.SIMULATE);
    });

    it('should parse [OPTIMIZE] commands', () => {
      const result = console.parseInput('[OPTIMIZE] Improve document clarity');
      expect(result).not.toBeNull();
      expect(result?.tag).toBe(COMMAND_TAGS.OPTIMIZE);
    });

    it('should default to [QUERY] for untagged input', () => {
      const result = console.parseInput('What is the meaning of life?');
      expect(result).not.toBeNull();
      expect(result?.tag).toBe(COMMAND_TAGS.QUERY);
    });
  });

  describe('Command Execution', () => {
    it('should execute [QUERY] command successfully', async () => {
      const output = await console.executeCommand(
        '[QUERY] Draft legal complaint against CHI Living Communities',
        sessionId
      );

      expect(output).toBeDefined();
      expect(output.content).toBeDefined();
      expect(output.content.length).toBeGreaterThan(0);
      expect(output.errorCheckStatus).toBe('passed');
      expect(output.optimizationApplied).toBe(true);
      expect(output.processingStages.length).toBeGreaterThan(0);
    });

    it('should execute [ANALYZE] command successfully', async () => {
      const output = await console.executeCommand(
        '[ANALYZE] Risk assessment for contract dispute',
        sessionId
      );

      expect(output).toBeDefined();
      expect(output.content.length).toBeGreaterThan(0);
      expect(output.processingStages).toContain('context_analysis');
      expect(output.processingStages).toContain('output_assembly');
    });

    it('should execute [SIMULATE] command successfully', async () => {
      const output = await console.executeCommand(
        '[SIMULATE] Outcome of filing injunction',
        sessionId
      );

      expect(output).toBeDefined();
      expect(output.content).toContain('Simulation');
    });

    it('should execute [OPTIMIZE] command successfully', async () => {
      const output = await console.executeCommand(
        '[OPTIMIZE] Enhance document precision',
        sessionId
      );

      expect(output).toBeDefined();
      expect(output.content).toContain('Enhancement');
    });

    it('should include timestamp in output', async () => {
      const output = await console.executeCommand(
        '[QUERY] Simple test query',
        sessionId
      );

      expect(output.timestamp).toBeGreaterThan(0);
    });

    it('should include processing time', async () => {
      const output = await console.executeCommand(
        '[QUERY] Another test query',
        sessionId
      );

      expect(output.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should track source (left/right/combined)', async () => {
      const output = await console.executeCommand(
        '[QUERY] Test for source tracking',
        sessionId
      );

      expect([
        OUTPUT_SOURCES.LEFT_BRAIN,
        OUTPUT_SOURCES.RIGHT_BRAIN,
        OUTPUT_SOURCES.COMBINED,
        OUTPUT_SOURCES.SYSTEM
      ]).toContain(output.source);
    });
  });

  describe('Authentication', () => {
    it('should reject commands without valid session', async () => {
      const output = await console.executeCommand(
        '[QUERY] Test without auth',
        'invalid-session-id'
      );

      expect(output.errors).toContain('Authentication required');
    });

    it('should accept commands with valid session', async () => {
      const output = await console.executeCommand(
        '[QUERY] Test with auth',
        sessionId
      );

      expect(output.errors).not.toContain('Authentication required');
    });
  });

  describe('Interaction Logging', () => {
    it('should log all interactions', async () => {
      const initialLogSize = console.getInteractionLog().length;
      
      await console.executeCommand('[QUERY] Log test 1', sessionId);
      await console.executeCommand('[QUERY] Log test 2', sessionId);
      
      const newLogSize = console.getInteractionLog().length;
      expect(newLogSize).toBeGreaterThanOrEqual(initialLogSize + 2);
    });

    it('should include command and output in log entries', () => {
      const log = console.getInteractionLog();
      const lastEntry = log[log.length - 1];
      
      expect(lastEntry.command).toBeDefined();
      expect(lastEntry.output).toBeDefined();
      expect(lastEntry.timestamp).toBeGreaterThan(0);
    });
  });
});

describe('ContextAnalysisModule', () => {
  const module = new ContextAnalysisModule();

  it('should analyze legal domain queries', () => {
    const result = module.analyze(
      'Draft legal complaint against defendant',
      COMMAND_TAGS.QUERY
    );

    expect(result.domain).toBe('legal');
    expect(result.intent).toBe('document_drafting');
  });

  it('should analyze crypto domain queries', () => {
    const result = module.analyze(
      'Analyze bitcoin market trends',
      COMMAND_TAGS.ANALYZE
    );

    expect(result.domain).toBe('crypto');
  });

  it('should extract entities', () => {
    const result = module.analyze(
      'File complaint against CHI Living Communities Inc',
      COMMAND_TAGS.QUERY
    );

    expect(result.entities.length).toBeGreaterThan(0);
  });

  it('should assess urgency', () => {
    const urgentResult = module.analyze(
      'Urgent: Need immediate response',
      COMMAND_TAGS.QUERY
    );
    expect(urgentResult.urgency).toBe('high');

    const normalResult = module.analyze(
      'General inquiry about procedures',
      COMMAND_TAGS.QUERY
    );
    expect(normalResult.urgency).toBe('low');
  });

  it('should assess complexity', () => {
    const simpleResult = module.analyze(
      'What is law?',
      COMMAND_TAGS.QUERY
    );
    expect(simpleResult.complexity).toBe('simple');

    const complexResult = module.analyze(
      'Analyze the multi-jurisdictional implications of cross-border transactions involving cryptocurrency exchanges, decentralized finance protocols, and traditional banking institutions under federal and state regulations',
      COMMAND_TAGS.ANALYZE
    );
    expect(complexResult.complexity).toBe('complex');
  });
});

describe('KnowledgeRetrievalModule', () => {
  const module = new KnowledgeRetrievalModule();

  it('should retrieve knowledge for legal domain', () => {
    const context = {
      intent: 'document_drafting',
      entities: [],
      constraints: [],
      domain: 'legal' as const,
      urgency: 'low' as const,
      complexity: 'simple' as const
    };

    const result = module.retrieve(context, 'legal complaint');

    expect(result.relevantKnowledge.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should suggest crawlers when knowledge is missing', () => {
    const context = {
      intent: 'obscure_topic',
      entities: [],
      constraints: [],
      domain: 'general' as const,
      urgency: 'low' as const,
      complexity: 'simple' as const
    };

    const result = module.retrieve(context, 'very obscure topic');

    expect(result.suggestedCrawlers.length).toBeGreaterThan(0);
  });

  it('should store and retrieve knowledge', () => {
    module.storeKnowledge('test:key', 'test content');
    expect(module.getKnowledgeBaseSize()).toBeGreaterThan(0);
  });
});

describe('OutputAssemblyModule', () => {
  const module = new OutputAssemblyModule();

  it('should combine left and right brain outputs', () => {
    const context = {
      intent: 'analysis',
      entities: [],
      constraints: [],
      domain: 'mixed' as const,
      urgency: 'low' as const,
      complexity: 'moderate' as const
    };

    const knowledge = {
      relevantKnowledge: [],
      suggestedCrawlers: [],
      knowledgeGaps: [],
      confidence: 0.8
    };

    const result = module.assemble(
      'Left brain analysis output',
      'Right brain pattern output',
      context,
      knowledge
    );

    expect(result.combinedOutput).toContain('Left brain');
    expect(result.combinedOutput).toContain('Right brain');
    expect(result.leftBrainContribution).toBe(0.5);
    expect(result.rightBrainContribution).toBe(0.5);
  });

  it('should weight legal domain toward left brain', () => {
    const context = {
      intent: 'analysis',
      entities: [],
      constraints: [],
      domain: 'legal' as const,
      urgency: 'low' as const,
      complexity: 'simple' as const
    };

    const result = module.assemble('Legal', 'Pattern', context, {
      relevantKnowledge: [],
      suggestedCrawlers: [],
      knowledgeGaps: [],
      confidence: 0.5
    });

    expect(result.leftBrainContribution).toBe(0.7);
    expect(result.rightBrainContribution).toBe(0.3);
  });
});

describe('ErrorProofingModule', () => {
  const module = new ErrorProofingModule();

  it('should detect syntax errors', () => {
    const context = {
      intent: 'test',
      entities: [],
      constraints: [],
      domain: 'general' as const,
      urgency: 'low' as const,
      complexity: 'simple' as const
    };

    const result = module.check('This has ((unbalanced brackets)', context);

    expect(result.syntaxErrors.length).toBeGreaterThan(0);
  });

  it('should correct double spaces', () => {
    const context = {
      intent: 'test',
      entities: [],
      constraints: [],
      domain: 'general' as const,
      urgency: 'low' as const,
      complexity: 'simple' as const
    };

    const result = module.check('This  has  double  spaces', context);

    expect(result.correctedOutput).not.toContain('  ');
  });

  it('should detect informal language in legal context', () => {
    const context = {
      intent: 'legal_drafting',
      entities: [],
      constraints: [],
      domain: 'legal' as const,
      urgency: 'low' as const,
      complexity: 'simple' as const
    };

    const result = module.check('We gonna file this lawsuit', context);

    expect(result.consistencyIssues.length).toBeGreaterThan(0);
  });
});

describe('OptimizationModule', () => {
  const module = new OptimizationModule();

  it('should remove redundancies', () => {
    const context = {
      intent: 'test',
      entities: [],
      constraints: [],
      domain: 'general' as const,
      urgency: 'low' as const,
      complexity: 'simple' as const
    };

    const result = module.optimize(
      'This is a test. This is a test. Something new.',
      context,
      []
    );

    expect(result.redundanciesRemoved).toBeGreaterThan(0);
  });

  it('should apply conciseness when constrained', () => {
    const context = {
      intent: 'test',
      entities: [],
      constraints: ['concise_output'],
      domain: 'general' as const,
      urgency: 'low' as const,
      complexity: 'simple' as const
    };

    const result = module.optimize(
      'This is basically a very really quite good test.',
      context,
      ['concise_output']
    );

    expect(result.enhancements).toContain('Applied conciseness optimization');
  });

  it('should calculate clarity score', () => {
    const context = {
      intent: 'test',
      entities: [],
      constraints: [],
      domain: 'general' as const,
      urgency: 'low' as const,
      complexity: 'simple' as const
    };

    const result = module.optimize('A clear and simple sentence.', context, []);

    expect(result.clarityScore).toBeGreaterThan(0);
    expect(result.clarityScore).toBeLessThanOrEqual(1);
  });
});

describe('CrawlerManager', () => {
  const manager = new CrawlerManager();

  it('should authorize users', () => {
    manager.authorizeUser('test-user', ['crawler_access']);
    expect(manager.isAuthorized('test-user')).toBe(true);
  });

  it('should reject unauthorized crawler requests', async () => {
    const response = await manager.executeCrawl({
      id: 'test-1',
      type: 'web',
      target: 'https://example.com',
      query: 'test',
      authorized: false,
      requestedBy: 'unauthorized-user',
      timestamp: Date.now()
    });

    expect(response.success).toBe(false);
    expect(response.errors).toContain('User not authorized for crawler access');
  });

  it('should execute authorized crawler requests', async () => {
    manager.authorizeUser('auth-user', ['crawler_access']);

    const response = await manager.executeCrawl({
      id: 'test-2',
      type: 'legal_database',
      target: 'case-law',
      query: 'contract dispute',
      authorized: true,
      requestedBy: 'auth-user',
      timestamp: Date.now()
    });

    expect(response.success).toBe(true);
    expect(response.sanitized).toBe(true);
    expect(response.storedInDatabase).toBe(true);
  });

  it('should track crawler history', async () => {
    const history = manager.getCrawlerHistory();
    expect(history.length).toBeGreaterThan(0);
  });
});

describe('AuthenticationManager', () => {
  const manager = new AuthenticationManager();

  it('should register and authenticate users', () => {
    manager.registerUser('testuser', 'password123');
    const session = manager.authenticate('testuser', 'password123', ['read']);

    expect(session).not.toBeNull();
    expect(session?.userId).toBe('testuser');
    expect(session?.active).toBe(true);
  });

  it('should reject invalid passwords', () => {
    manager.registerUser('user2', 'correct');
    const session = manager.authenticate('user2', 'wrong');

    expect(session).toBeNull();
  });

  it('should validate sessions', () => {
    manager.registerUser('user3', 'pass');
    const session = manager.authenticate('user3', 'pass');

    expect(session).not.toBeNull();
    if (session) {
      expect(manager.validateSession(session.sessionId, session.token)).toBe(true);
      expect(manager.validateSession(session.sessionId, 'wrong-token')).toBe(false);
    }
  });

  it('should check permissions', () => {
    manager.registerUser('user4', 'pass');
    const session = manager.authenticate('user4', 'pass', ['crawler_access', 'admin']);

    expect(session).not.toBeNull();
    if (session) {
      expect(manager.hasPermission(session.sessionId, 'crawler_access')).toBe(true);
      expect(manager.hasPermission(session.sessionId, 'admin')).toBe(true);
      expect(manager.hasPermission(session.sessionId, 'superuser')).toBe(false);
    }
  });

  it('should invalidate sessions', () => {
    manager.registerUser('user5', 'pass');
    const session = manager.authenticate('user5', 'pass');

    expect(session).not.toBeNull();
    if (session) {
      manager.invalidateSession(session.sessionId);
      expect(manager.validateSession(session.sessionId, session.token)).toBe(false);
    }
  });
});

describe('Command Tags', () => {
  it('should have all required command tags', () => {
    expect(COMMAND_TAGS.QUERY).toBe('[QUERY]');
    expect(COMMAND_TAGS.ANALYZE).toBe('[ANALYZE]');
    expect(COMMAND_TAGS.CRAWL).toBe('[CRAWL]');
    expect(COMMAND_TAGS.SIMULATE).toBe('[SIMULATE]');
    expect(COMMAND_TAGS.OPTIMIZE).toBe('[OPTIMIZE]');
  });
});

describe('Output Sources', () => {
  it('should have all output sources', () => {
    expect(OUTPUT_SOURCES.LEFT_BRAIN).toBe('left_brain');
    expect(OUTPUT_SOURCES.RIGHT_BRAIN).toBe('right_brain');
    expect(OUTPUT_SOURCES.COMBINED).toBe('combined');
    expect(OUTPUT_SOURCES.SYSTEM).toBe('system');
  });
});
