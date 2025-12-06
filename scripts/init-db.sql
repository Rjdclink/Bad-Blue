-- PANTHEON Database Initialization

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET max_connections = '100';

DO $$
BEGIN
    RAISE NOTICE 'PANTHEON database initialized';
END $$;
