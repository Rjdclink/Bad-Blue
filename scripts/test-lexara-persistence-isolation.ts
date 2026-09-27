import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  lexaraConversations,
} from '../shared/schema';
import {
  createLexaraConversationDatabase,
  getLexaraConversationPersistenceDb,
} from '../server/services/lexara/LexaraConversationPersistenceDatabase';
import { getCryptoCrawlerManualPowerPhase, setCryptoCrawlerManualPowerPhase } from '../server/services/cryptocrawl/runtime/manual-power-state';

async function main(): Promise<void> {
  delete process.env.SUPABASE_DATABASE_URL_OVERFLOW;
  setCryptoCrawlerManualPowerPhase('OFF');
  assert.equal(getCryptoCrawlerManualPowerPhase(), 'OFF');
  const { pool: cryptoCrawlerRuntimePool } = await import('../server/services/cryptocrawl/runtime/cryptocrawl-runtime-database');

  assert.throws(
    () => getLexaraConversationPersistenceDb(),
    /SUPABASE_DATABASE_URL_OVERFLOW is required/,
    'the Lexara client must fail closed when its dedicated Overflow authority is absent',
  );
  process.env.SUPABASE_DATABASE_URL_OVERFLOW = 'https://example.invalid';
  assert.throws(
    () => getLexaraConversationPersistenceDb(),
    /PostgreSQL URL/,
    'an HTTPS project URL must never be treated as a PostgreSQL database connection',
  );
  delete process.env.SUPABASE_DATABASE_URL_OVERFLOW;

  await assert.rejects(
    cryptoCrawlerRuntimePool.query('SELECT 1'),
    /CRYPTOCRAWLER_MASTER_POWER_OFF/,
    'the original CryptoCrawler runtime query guard remains active with Master Power OFF',
  );
  await assert.rejects(
    cryptoCrawlerRuntimePool.connect(),
    /CRYPTOCRAWLER_MASTER_POWER_OFF/,
    'the original CryptoCrawler runtime connection guard remains active with Master Power OFF',
  );

  const statements: Array<{ text: string; values?: unknown[] }> = [];
  const fakePool = {
    query: (text: unknown, values?: unknown[], callback?: (error: Error | null, result?: unknown) => void) => {
      const statementText = typeof text === 'string'
        ? text
        : String((text as { text?: unknown })?.text || '');
      statements.push({ text: statementText, values });
      const result = { rows: [], rowCount: 0 };
      if (callback) {
        queueMicrotask(() => callback(null, result));
        return {};
      }
      return Promise.resolve(result);
    },
    end: async () => undefined,
  };
  const fakeDatabase = {
    insert(table: unknown) {
      assert.equal(table, lexaraConversations);
      return {
        values(values: unknown) {
          return {
            returning: async () => {
              statements.push({ text: 'INSERT INTO lexara_conversations', values: [values] });
              return [];
            },
          };
        },
      };
    },
    select() {
      const builder: any = {
        from(table: unknown) {
          assert.equal(table, lexaraConversations);
          return builder;
        },
        where(predicate: unknown) {
          builder.predicate = predicate;
          return builder;
        },
        orderBy(_order: unknown) {
          return builder;
        },
        async limit(limit: number) {
          statements.push({
            text: 'SELECT FROM lexara_conversations',
            values: [builder.predicate, limit],
          });
          return [];
        },
      };
      return builder;
    },
  };
  let poolOptions: {
    connectionString?: string;
    max?: number;
    application_name?: string;
  } | undefined;
  const client = createLexaraConversationDatabase(
    'postgresql://fixture-user:fixture-password@aws-0-test.pooler.supabase.com:6543/overflow',
    {
      createPool: options => {
        poolOptions = options;
        return fakePool;
      },
      createDatabase: () => fakeDatabase,
    },
  );

  assert.equal(poolOptions?.max, 1, 'the Lexara-only pool is deliberately bounded');
  assert.equal(poolOptions?.application_name, 'lexara-overflow-persistence');
  assert.equal(new URL(String(poolOptions?.connectionString)).port, '5432',
    'transaction-mode Supabase URLs are normalized to the existing session-capable Overflow port');

  const record = {
    id: 'fixture-lexara-conversation',
    userId: 'fixture-user',
    sessionId: 'fixture-session',
    userPrompt: 'fixture prompt',
    lexaraResponse: 'fixture response',
    audioGenerated: false,
    audioUrl: null,
    audioBase64: null,
    audioDurationMs: null,
    model: 'fixture',
    context: null,
    createdAt: new Date(0),
  };
  const db = client.db;
  await db.insert(lexaraConversations).values(record).returning();
  await db.select().from(lexaraConversations)
    .where({ field: 'id', value: record.id }).limit(1);
  await db.select().from(lexaraConversations)
    .where({ field: 'user_id', value: record.userId })
    .orderBy({ field: 'created_at', direction: 'desc' }).limit(50);
  await db.select().from(lexaraConversations)
    .where({ field: 'session_id', value: record.sessionId })
    .orderBy({ field: 'created_at', direction: 'asc' }).limit(100);

  assert.equal(statements.length, 4, 'insert and all three history reads use the dedicated Lexara database client');
  assert(statements.every(statement => /lexara_conversations/.test(statement.text)));

  const storageSource = await readFile(new URL('../server/storage.ts', import.meta.url), 'utf8');
  for (const method of [
    'createLexaraConversation',
    'getLexaraConversation',
    'getUserLexaraConversations',
    'getLexaraConversationsBySession',
  ]) {
    const start = storageSource.indexOf(`async ${method}(`);
    assert(start >= 0, `storage method ${method} exists`);
    const next = storageSource.indexOf('\n  async ', start + 1);
    const body = storageSource.slice(start, next < 0 ? undefined : next);
    assert(body.includes('getLexaraConversationPersistenceDb()'),
      `${method} uses the dedicated Lexara Overflow database`);
    assert(!body.includes('overflowRuntimeDb'),
      `${method} does not use the CryptoCrawler-guarded database`);
  }
  assert.doesNotMatch(storageSource, /db as overflowRuntimeDb/,
    'storage no longer imports the CryptoCrawler runtime DB for Lexara persistence');

  const migration = await readFile(
    new URL('../server/migrations/060_lexara_overflow_conversation_history.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.lexara_conversations/);
  assert.doesNotMatch(migration.replace(/--.*$/gm, ''), /\b(?:FOREIGN KEY|REFERENCES)\b/i,
    'the canonical Overflow schema remains free of a cross-authority users foreign key');

  assert.equal(getCryptoCrawlerManualPowerPhase(), 'OFF');
  console.log('Lexara conversation persistence isolation passed (dedicated bounded Overflow client works offline; CryptoCrawler Master Power OFF guards remain intact; missing-key and no-FK checks passed).');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});