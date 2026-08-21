import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("SUPABASE_DATABASE_URL or SUPABASE_DB_URL is required for Drizzle");
}

if (databaseUrl.startsWith('http://') || databaseUrl.startsWith('https://')) {
  throw new Error("Drizzle requires a Postgres connection string, not a Supabase project URL");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
