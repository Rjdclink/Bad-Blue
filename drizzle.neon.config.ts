import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.NEON_DIRECT_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("NEON_DIRECT_DATABASE_URL is required for the isolated Neon schema target");
}

if (!databaseUrl.startsWith("postgres://") && !databaseUrl.startsWith("postgresql://")) {
  throw new Error("NEON_DIRECT_DATABASE_URL must be a PostgreSQL connection string");
}

// This config is intentionally isolated from runtime database resolution.
// It exists only to prepare/verify the Neon failover schema and must never
// replace the canonical primary database setting or become the application's implicit authority.
export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  driver: "pg",
  dbCredentials: {
    connectionString: databaseUrl,
  },
});
