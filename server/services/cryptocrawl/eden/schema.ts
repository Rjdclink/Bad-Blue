// Eden Database Schema
// Schema for storing swarm knowledge, lessons, and state in Supabase/PostgreSQL

import { sql } from 'drizzle-orm';
import { pgTable, varchar, text, integer, timestamp, jsonb, boolean, real, index } from 'drizzle-orm/pg-core';

// ============================================
// EDEN LESSONS TABLE
// ============================================
export const edenLessons = pgTable('eden_lessons', {
  id: varchar('id').primaryKey(),
  cainId: varchar('cain_id').notNull(),
  opportunitySignature: text('opportunity_signature').notNull(),
  outcome: varchar('outcome', { length: 20 }).notNull(), // success, failure, partial
  profitActual: real('profit_actual').notNull(),
  profitEstimated: real('profit_estimated').notNull(),
  latency: integer('latency').notNull(), // milliseconds
  gasUsed: integer('gas_used').notNull(),
  failureMode: text('failure_mode'),
  chain: varchar('chain', { length: 20 }).notNull(),
  timestamp: timestamp('timestamp').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_eden_lessons_cain').on(table.cainId),
  index('idx_eden_lessons_chain').on(table.chain),
  index('idx_eden_lessons_outcome').on(table.outcome),
  index('idx_eden_lessons_timestamp').on(table.timestamp),
]);

// ============================================
// EDEN STRATEGY TEMPLATES TABLE
// ============================================
export const edenStrategyTemplates = pgTable('eden_strategy_templates', {
  id: varchar('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  version: integer('version').notNull().default(1),
  profitabilityScore: real('profitability_score').notNull(),
  successRate: real('success_rate').notNull(),
  avgLatency: integer('avg_latency').notNull(),
  conditions: jsonb('conditions').notNull(),
  actions: jsonb('actions').notNull(),
  lastUpdated: timestamp('last_updated').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_eden_strategy_profitability').on(table.profitabilityScore),
  index('idx_eden_strategy_success_rate').on(table.successRate),
]);

// ============================================
// EDEN CAIN STATES TABLE
// ============================================
export const edenCainStates = pgTable('eden_cain_states', {
  id: varchar('id').primaryKey(),
  type: varchar('type', { length: 50 }).notNull(), // cataclysm_detection, probability_monitoring
  status: varchar('status', { length: 50 }).notNull(), // active, eden_return, genesis_cycle, doomsday, inactive
  cycleCount: integer('cycle_count').notNull().default(0),
  lessonsCollected: integer('lessons_collected').notNull().default(0),
  lastEdenReturn: timestamp('last_eden_return').notNull(),
  currentMission: text('current_mission'),
  replicas: jsonb('replicas').notNull().default(sql`'[]'`),
  knowledge: jsonb('knowledge').notNull().default(sql`'{}'`),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_eden_cain_type').on(table.type),
  index('idx_eden_cain_status').on(table.status),
]);

// ============================================
// EDEN MICRO CRAWLER STATES TABLE
// ============================================
export const edenMicroCrawlerStates = pgTable('eden_micro_crawler_states', {
  id: varchar('id').primaryKey(),
  parentCainId: varchar('parent_cain_id').notNull(),
  mode: varchar('mode', { length: 20 }).notNull(), // micro, full
  priority: real('priority').notNull(),
  target: varchar('target', { length: 100 }),
  chain: varchar('chain', { length: 20 }),
  status: varchar('status', { length: 50 }).notNull(), // idle, scanning, executing, shrinking, growing
  lastActivity: timestamp('last_activity').notNull(),
  profitGenerated: real('profit_generated').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_eden_micro_parent').on(table.parentCainId),
  index('idx_eden_micro_mode').on(table.mode),
  index('idx_eden_micro_status').on(table.status),
]);

// ============================================
// EDEN SNAPSHOTS TABLE
// ============================================
export const edenSnapshots = pgTable('eden_snapshots', {
  id: varchar('id').primaryKey(),
  timestamp: timestamp('timestamp').notNull(),
  cainStates: jsonb('cain_states').notNull(),
  strategyTemplates: jsonb('strategy_templates').notNull(),
  globalMetrics: jsonb('global_metrics').notNull(),
  lessonsLearned: jsonb('lessons_learned').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_eden_snapshots_timestamp').on(table.timestamp),
]);

// ============================================
// EDEN CATACLYSM EVENTS TABLE
// ============================================
export const edenCataclysms = pgTable('eden_cataclysms', {
  id: varchar('id').primaryKey(),
  type: varchar('type', { length: 50 }).notNull(),
  severity: varchar('severity', { length: 20 }).notNull(),
  chain: varchar('chain', { length: 20 }),
  timestamp: timestamp('timestamp').notNull(),
  description: text('description').notNull(),
  recoveryActions: jsonb('recovery_actions').notNull(),
  status: varchar('status', { length: 20 }).notNull(), // detected, recovering, resolved
  createdAt: timestamp('created_at').defaultNow(),
  resolvedAt: timestamp('resolved_at'),
}, (table) => [
  index('idx_eden_cataclysm_type').on(table.type),
  index('idx_eden_cataclysm_severity').on(table.severity),
  index('idx_eden_cataclysm_status').on(table.status),
]);

// ============================================
// EDEN OPPORTUNITY EVENTS TABLE
// ============================================
export const edenOpportunities = pgTable('eden_opportunities', {
  id: varchar('id').primaryKey(),
  type: varchar('type', { length: 50 }).notNull(),
  chain: varchar('chain', { length: 20 }).notNull(),
  priority: real('priority').notNull(),
  profitEstimate: real('profit_estimate').notNull(),
  confidenceScore: real('confidence_score').notNull(),
  timestamp: timestamp('timestamp').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  metadata: jsonb('metadata').notNull(),
  claimedBy: varchar('claimed_by'),
  status: varchar('status', { length: 20 }).notNull().default('open'), // open, claimed, executed, expired
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_eden_opp_type').on(table.type),
  index('idx_eden_opp_chain').on(table.chain),
  index('idx_eden_opp_priority').on(table.priority),
  index('idx_eden_opp_status').on(table.status),
  index('idx_eden_opp_expires').on(table.expiresAt),
]);

// ============================================
// EDEN AUDIT LOG TABLE
// ============================================
export const edenAuditLog = pgTable('eden_audit_log', {
  id: varchar('id').primaryKey(),
  agentId: varchar('agent_id').notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  details: jsonb('details'),
  ethicalGuardChecks: jsonb('ethical_guard_checks'),
  timestamp: timestamp('timestamp').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_eden_audit_agent').on(table.agentId),
  index('idx_eden_audit_action').on(table.action),
  index('idx_eden_audit_timestamp').on(table.timestamp),
]);

export type EdenLesson = typeof edenLessons.$inferSelect;
export type InsertEdenLesson = typeof edenLessons.$inferInsert;

export type EdenStrategyTemplate = typeof edenStrategyTemplates.$inferSelect;
export type InsertEdenStrategyTemplate = typeof edenStrategyTemplates.$inferInsert;

export type EdenCainState = typeof edenCainStates.$inferSelect;
export type InsertEdenCainState = typeof edenCainStates.$inferInsert;

export type EdenMicroCrawlerState = typeof edenMicroCrawlerStates.$inferSelect;
export type InsertEdenMicroCrawlerState = typeof edenMicroCrawlerStates.$inferInsert;

export type EdenSnapshot = typeof edenSnapshots.$inferSelect;
export type InsertEdenSnapshot = typeof edenSnapshots.$inferInsert;

export type EdenCataclysm = typeof edenCataclysms.$inferSelect;
export type InsertEdenCataclysm = typeof edenCataclysms.$inferInsert;

export type EdenOpportunity = typeof edenOpportunities.$inferSelect;
export type InsertEdenOpportunity = typeof edenOpportunities.$inferInsert;

export type EdenAuditLog = typeof edenAuditLog.$inferSelect;
export type InsertEdenAuditLog = typeof edenAuditLog.$inferInsert;
