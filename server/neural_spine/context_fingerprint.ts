/**
 * Neural Spine - Context Fingerprint Module
 * 
 * Creates binary synapse identifiers by fingerprinting context.
 * This fingerprint becomes the from_node, to_node, input_fingerprint, output_fingerprint
 * in the neural synapse system.
 * 
 * "Binary Synapse ID" - A unique hash representing a concept or context.
 */

import crypto from 'crypto';

// Common stopwords to remove during normalization
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'can', 'will', 'should', 'now', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does',
  'did', 'doing', 'would', 'could', 'might', 'must', 'shall', 'it', 'its'
]);

export interface FingerprintEvent {
  prompt: string;
  params?: Record<string, unknown>;
  result?: unknown;
  domain?: string;
  tools?: string[];
  agent?: string;
  tags?: string[];
}

export interface FingerprintOptions {
  algorithm?: 'sha256' | 'sha512' | 'md5';
  includeParams?: boolean;
  includeResult?: boolean;
  maxTokens?: number;
}

const DEFAULT_OPTIONS: FingerprintOptions = {
  algorithm: 'sha256',
  includeParams: true,
  includeResult: true,
  maxTokens: 100
};

/**
 * Normalize text by lowercasing and removing stopwords
 */
function normalizeText(text: string): string {
  if (!text) return '';
  
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOPWORDS.has(word))
    .join(' ')
    .trim();
}

/**
 * Extract key tokens from text (simple keyword extraction)
 */
function extractKeyTokens(text: string, maxTokens: number = 100): string[] {
  const normalized = normalizeText(text);
  const words = normalized.split(/\s+/).filter(w => w.length > 0);
  
  // Count word frequency
  const frequency = new Map<string, number>();
  for (const word of words) {
    frequency.set(word, (frequency.get(word) || 0) + 1);
  }
  
  // Sort by frequency (descending) and take top N
  const sorted = Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTokens)
    .map(([word]) => word);
  
  return sorted;
}

/**
 * Serialize a value to a stable string representation
 */
function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  
  try {
    // Sort object keys for consistent serialization
    return JSON.stringify(value, Object.keys(value as object).sort());
  } catch {
    return String(value);
  }
}

/**
 * Create a binary synapse fingerprint from an event
 * 
 * This fingerprint uniquely identifies a concept or context and serves
 * as the binary node identifier in the neural synapse system.
 */
export function makeFingerprint(
  event: FingerprintEvent,
  options: FingerprintOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Build the content to hash
  const parts: string[] = [];
  
  // Always include the prompt (normalized)
  if (event.prompt) {
    const tokens = extractKeyTokens(event.prompt, opts.maxTokens);
    parts.push(`prompt:${tokens.join(',')}`);
  }
  
  // Include domain if present
  if (event.domain) {
    parts.push(`domain:${normalizeText(event.domain)}`);
  }
  
  // Include agent if present
  if (event.agent) {
    parts.push(`agent:${normalizeText(event.agent)}`);
  }
  
  // Include tools used
  if (event.tools && event.tools.length > 0) {
    const sortedTools = [...event.tools].sort().join(',');
    parts.push(`tools:${sortedTools}`);
  }
  
  // Include tags
  if (event.tags && event.tags.length > 0) {
    const sortedTags = [...event.tags].sort().join(',');
    parts.push(`tags:${sortedTags}`);
  }
  
  // Optionally include params
  if (opts.includeParams && event.params) {
    const paramsStr = serializeValue(event.params);
    if (paramsStr) {
      const paramTokens = extractKeyTokens(paramsStr, Math.floor(opts.maxTokens! / 2));
      parts.push(`params:${paramTokens.join(',')}`);
    }
  }
  
  // Optionally include result
  if (opts.includeResult && event.result) {
    const resultStr = serializeValue(event.result);
    if (resultStr) {
      const resultTokens = extractKeyTokens(resultStr, Math.floor(opts.maxTokens! / 2));
      parts.push(`result:${resultTokens.join(',')}`);
    }
  }
  
  // Join all parts and create hash
  const content = parts.join('|');
  
  const hash = crypto
    .createHash(opts.algorithm!)
    .update(content)
    .digest('hex');
  
  return hash;
}

/**
 * Create an input fingerprint (from_node) - focuses on the input context
 */
export function makeInputFingerprint(
  prompt: string,
  domain?: string,
  agent?: string,
  params?: Record<string, unknown>
): string {
  return makeFingerprint({
    prompt,
    domain,
    agent,
    params
  }, {
    includeResult: false
  });
}

/**
 * Create an output fingerprint (to_node) - focuses on the output/result
 */
export function makeOutputFingerprint(
  prompt: string,
  result: unknown,
  domain?: string,
  agent?: string
): string {
  return makeFingerprint({
    prompt,
    result,
    domain,
    agent
  }, {
    includeParams: false
  });
}

/**
 * Create a context hash - combines input and output for synaptic linkage
 */
export function makeContextHash(
  prompt: string,
  params: Record<string, unknown>,
  result: unknown,
  metadata?: { domain?: string; agent?: string; tags?: string[] }
): string {
  return makeFingerprint({
    prompt,
    params,
    result,
    ...metadata
  });
}

/**
 * Compute similarity score between two fingerprints
 * Returns a value between 0 (completely different) and 1 (identical)
 */
export function fingerprintSimilarity(fp1: string, fp2: string): number {
  if (fp1 === fp2) return 1.0;
  if (!fp1 || !fp2) return 0.0;
  
  // Use Hamming-like distance on hex strings
  const len = Math.min(fp1.length, fp2.length);
  let matches = 0;
  
  for (let i = 0; i < len; i++) {
    if (fp1[i] === fp2[i]) matches++;
  }
  
  return matches / Math.max(fp1.length, fp2.length);
}

/**
 * Check if two fingerprints are similar enough to be considered "related"
 */
export function areFingerprintsSimilar(
  fp1: string,
  fp2: string,
  threshold: number = 0.7
): boolean {
  return fingerprintSimilarity(fp1, fp2) >= threshold;
}

export default {
  makeFingerprint,
  makeInputFingerprint,
  makeOutputFingerprint,
  makeContextHash,
  fingerprintSimilarity,
  areFingerprintsSimilar
};
