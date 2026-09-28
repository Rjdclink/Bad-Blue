import pg, { type PoolConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { lexaraConversations } from '@shared/schema';

const { Pool } = pg;
const LEXARA_POOL_MAX = 1;
const LEXARA_CONNECTION_TIMEOUT_MS = 8_000;
const LEXARA_QUERY_TIMEOUT_MS = 15_000;
const LEXARA_IDLE_TIMEOUT_MS = 15_000;

type PoolLike = {
  end?: () => Promise<void>;
};

export interface LexaraConversationDatabase {
  db: any;
  pool: PoolLike;
}

export interface LexaraConversationDatabaseFactories {
  createPool?: (config: PoolConfig) => PoolLike;
  createDatabase?: (pool: PoolLike) => any;
}

function validatedSessionConnectionString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('LEXARA Overflow persistence is not configured; SUPABASE_DATABASE_URL_OVERFLOW is required');
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('LEXARA Overflow persistence requires a valid PostgreSQL connection URL');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !url.hostname
    || !url.pathname
    || url.pathname === '/') {
    throw new Error('LEXARA Overflow persistence requires a PostgreSQL URL with a database name');
  }

  // The shared Supabase transaction-mode pool cannot provide the session
  // semantics expected by the existing Overflow persistence authority.
  if (/(^|\.)pooler\.supabase\.com$/i.test(url.hostname)) {
    if (url.port === '6543') url.port = '5432';
    else if (url.port && url.port !== '5432') {
      throw new Error('LEXARA Overflow persistence requires a session-capable Supabase pooler URL');
    }
  }

  return url.toString();
}

function createPoolConfig(connectionString: string): PoolConfig {
  const ssl = process.env.PGSSLMODE !== 'disable'
    ? {
        rejectUnauthorized: false,
        ...(process.env.DATABASE_SSL_CERT ? { ca: process.env.DATABASE_SSL_CERT } : {}),
      }
    : false;

  return {
    connectionString,
    max: LEXARA_POOL_MAX,
    min: 0,
    idleTimeoutMillis: LEXARA_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: LEXARA_CONNECTION_TIMEOUT_MS,
    query_timeout: LEXARA_QUERY_TIMEOUT_MS,
    statement_timeout: LEXARA_QUERY_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    ssl,
    application_name: 'lexara-overflow-persistence',
  };
}

/**
 * Create a narrowly scoped, bounded client for the existing Lexara Overflow
 * table. This is intentionally independent of the guarded CryptoCrawler runtime
 * pool so normal Lexara persistence works while CryptoCrawler Master Power is
 * OFF. No Primary/Neon fallback is allowed.
 */
export function createLexaraConversationDatabase(
  connectionString: string,
  factories: LexaraConversationDatabaseFactories = {},
): LexaraConversationDatabase {
  const validatedUrl = validatedSessionConnectionString(connectionString);
  const config = createPoolConfig(validatedUrl);
  const pool = factories.createPool
    ? factories.createPool(config)
    : new Pool(config);
  const db = factories.createDatabase
    ? factories.createDatabase(pool)
    : drizzle(pool as InstanceType<typeof Pool>, {
        schema: { lexaraConversations },
      });

  return { db, pool };
}

let cachedConnectionString: string | undefined;
let cachedDatabase: LexaraConversationDatabase | undefined;

export function getLexaraConversationPersistenceDb(): any {
  const connectionString = process.env.SUPABASE_DATABASE_URL_OVERFLOW;
  const validatedUrl = validatedSessionConnectionString(connectionString);

  if (cachedDatabase) {
    if (cachedConnectionString !== validatedUrl) {
      throw new Error('LEXARA Overflow database configuration changed; restart the application to reconnect safely');
    }
    return cachedDatabase.db;
  }

  cachedDatabase = createLexaraConversationDatabase(validatedUrl);
  cachedConnectionString = validatedUrl;
  return cachedDatabase.db;
}