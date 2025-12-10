/**
 * Procedural Law Domain Sub-Agent
 * 
 * Handles Procedural Law consultations including:
 * - Court procedures, filings, motions, legal process
 */

import { promises as fs } from 'fs';
import path from 'path';

const DOMAIN_ID = 'procedural-law';
const DOMAIN_NAME = 'Procedural Law';
const KNOWLEDGE_BASE_PATH = path.join(__dirname, 'knowledge_base.json');

export interface ConsultationRequest {
  userId: string;
  query: string;
  context?: Record<string, any>;
  sessionId?: string;
}

export interface ConsultationResponse {
  domainId: string;
  response: string;
  citations: string[];
  templates: string[];
  confidence: number;
  suggestedActions: string[];
}

export interface KnowledgeBase {
  domain: string;
  name: string;
  version: string;
  lastUpdated: string;
  cases: Array<{
    id: string;
    name: string;
    citation: string;
    summary: string;
    relevance: string;
  }>;
  statutes: Array<{
    id: string;
    name: string;
    citation: string;
    summary: string;
  }>;
  templates: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  heuristics: Record<string, string>;
}

let knowledgeBase: KnowledgeBase | null = null;

/**
 * Load the domain-specific knowledge base
 */
export async function loadKnowledgeBase(): Promise<KnowledgeBase> {
  if (knowledgeBase) {
    return knowledgeBase;
  }

  try {
    const content = await fs.readFile(KNOWLEDGE_BASE_PATH, 'utf-8');
    knowledgeBase = JSON.parse(content);
    console.log(`[${DOMAIN_ID}] Knowledge base loaded: ${knowledgeBase?.cases.length} cases, ${knowledgeBase?.statutes.length} statutes`);
    return knowledgeBase!;
  } catch (error: any) {
    console.error(`[${DOMAIN_ID}] Failed to load knowledge base:`, error.message);
    knowledgeBase = {
      domain: DOMAIN_ID,
      name: DOMAIN_NAME,
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      cases: [],
      statutes: [],
      templates: [],
      heuristics: {}
    };
    return knowledgeBase;
  }
}

/**
 * Search knowledge base for relevant cases
 */
export async function searchCases(query: string): Promise<Array<{ id: string; name: string; citation: string; relevance: number }>> {
  const kb = await loadKnowledgeBase();
  const queryLower = query.toLowerCase();
  
  return kb.cases
    .map(c => ({
      id: c.id,
      name: c.name,
      citation: c.citation,
      relevance: calculateRelevance(queryLower, `${c.name} ${c.summary} ${c.relevance}`)
    }))
    .filter(c => c.relevance > 0.1)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5);
}

/**
 * Search knowledge base for relevant statutes
 */
export async function searchStatutes(query: string): Promise<Array<{ id: string; name: string; citation: string; relevance: number }>> {
  const kb = await loadKnowledgeBase();
  const queryLower = query.toLowerCase();
  
  return kb.statutes
    .map(s => ({
      id: s.id,
      name: s.name,
      citation: s.citation,
      relevance: calculateRelevance(queryLower, `${s.name} ${s.summary}`)
    }))
    .filter(s => s.relevance > 0.1)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5);
}

/**
 * Get applicable templates for consultation
 */
export async function getTemplates(): Promise<Array<{ id: string; name: string; description: string }>> {
  const kb = await loadKnowledgeBase();
  return kb.templates;
}

/**
 * Get domain-specific heuristics
 */
export async function getHeuristics(): Promise<Record<string, string>> {
  const kb = await loadKnowledgeBase();
  return kb.heuristics;
}

/**
 * Calculate text relevance score
 */
function calculateRelevance(query: string, text: string): number {
  const queryTerms = query.split(/\s+/).filter(t => t.length > 2);
  const textLower = text.toLowerCase();
  
  if (queryTerms.length === 0) return 0;
  
  const matches = queryTerms.filter(term => textLower.includes(term));
  return matches.length / queryTerms.length;
}

/**
 * Process a consultation request using domain-specific knowledge
 */
export async function processConsultation(request: ConsultationRequest): Promise<ConsultationResponse> {
  // Ensure knowledge base is loaded (cached after first load)
  await loadKnowledgeBase();
  
  const relevantCases = await searchCases(request.query);
  const relevantStatutes = await searchStatutes(request.query);
  const templates = await getTemplates();
  const heuristics = await getHeuristics();
  
  const citations = [
    ...relevantCases.map(c => c.citation),
    ...relevantStatutes.map(s => s.citation)
  ];
  
  const suggestedActions: string[] = [];
  for (const [key, value] of Object.entries(heuristics)) {
    suggestedActions.push(value);
  }
  
  const confidence = Math.min(
    0.3 + (relevantCases.length * 0.1) + (relevantStatutes.length * 0.1),
    0.95
  );
  
  return {
    domainId: DOMAIN_ID,
    response: `Based on ${DOMAIN_NAME} analysis: Found ${relevantCases.length} relevant cases and ${relevantStatutes.length} applicable statutes.`,
    citations,
    templates: templates.map(t => t.id),
    confidence,
    suggestedActions: suggestedActions.length > 0 ? suggestedActions : [`Consult with a qualified ${DOMAIN_NAME} attorney`]
  };
}

/**
 * Update knowledge base with new information from crawler
 */
export async function updateKnowledgeBase(updates: Partial<KnowledgeBase>): Promise<void> {
  const kb = await loadKnowledgeBase();
  
  if (updates.cases) {
    const existingIds = new Set(kb.cases.map(c => c.id));
    const newCases = updates.cases.filter(c => !existingIds.has(c.id));
    kb.cases.push(...newCases);
  }
  
  if (updates.statutes) {
    const existingIds = new Set(kb.statutes.map(s => s.id));
    const newStatutes = updates.statutes.filter(s => !existingIds.has(s.id));
    kb.statutes.push(...newStatutes);
  }
  
  if (updates.templates) {
    const existingIds = new Set(kb.templates.map(t => t.id));
    const newTemplates = updates.templates.filter(t => !existingIds.has(t.id));
    kb.templates.push(...newTemplates);
  }
  
  if (updates.heuristics) {
    kb.heuristics = { ...kb.heuristics, ...updates.heuristics };
  }
  
  kb.lastUpdated = new Date().toISOString();
  
  await fs.writeFile(KNOWLEDGE_BASE_PATH, JSON.stringify(kb, null, 2));
  knowledgeBase = kb;
  
  console.log(`[${DOMAIN_ID}] Knowledge base updated`);
}

/**
 * Get domain metadata
 */
export function getDomainInfo() {
  return {
    id: DOMAIN_ID,
    name: DOMAIN_NAME,
    description: 'Court procedures, filings, motions, legal process',
    icon: 'FileStack'
  };
}

export default {
  loadKnowledgeBase,
  searchCases,
  searchStatutes,
  getTemplates,
  getHeuristics,
  processConsultation,
  updateKnowledgeBase,
  getDomainInfo
};
